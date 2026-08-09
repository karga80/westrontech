use std::path::PathBuf;
use std::sync::Arc;
use serde::Serialize;
use tauri::Emitter;

use crate::envelope::engine::EnvelopeEngine;
use crate::envelope::types::TransactionRequest;
use crate::rpc::client::AlchemyClient;
use super::db;
use super::types::{SnipeRule, SnipeResult};

pub struct SnipingEngine {
    pub db_path: PathBuf,
}

/// A rule is expired when its `expires_at` (RFC3339) is in the past.
/// An empty or unparseable timestamp is treated as "not expired" so a corrupt
/// row never silently kills a rule — the DB migration backfills empty values.
pub fn rule_is_expired(rule: &SnipeRule) -> bool {
    if rule.expires_at.trim().is_empty() {
        return false;
    }
    match chrono::DateTime::parse_from_rfc3339(&rule.expires_at) {
        Ok(ts) => ts.with_timezone(&chrono::Utc) <= chrono::Utc::now(),
        Err(_) => false,
    }
}

/// Projected (simulated) spend for one full trigger of `rule` at `floor_price`.
fn projected_spend_eth(rule: &SnipeRule, floor_price: f64) -> f64 {
    floor_price * rule.max_quantity as f64
}

/// Guardrail: would triggering this rule now push it past its own spend cap?
/// Returns `Some(reason)` when the trigger must be refused.
fn spend_cap_block(rule: &SnipeRule, floor_price: f64) -> Option<String> {
    let cap = rule.max_total_spend_eth?;
    let projected = projected_spend_eth(rule, floor_price);
    if rule.spent_eth + projected > cap {
        Some(format!(
            "spend cap reached: {:.4} spent + {:.4} projected > {:.4} ETH cap",
            rule.spent_eth, projected, cap
        ))
    } else {
        None
    }
}

/// Payload emitted to the frontend when a snipe is triggered
#[derive(Debug, Clone, Serialize)]
struct SnipeTriggeredPayload {
    rule_id: String,
    collection_slug: String,
    floor_price_eth: f64,
    target_price_eth: f64,
    tx_hash: String,
}

impl SnipingEngine {
    pub fn new(db_path: PathBuf) -> Self {
        SnipingEngine { db_path }
    }

    /// Check all active rules; fetch floor price for each and execute snipe if triggered.
    pub async fn check_snipe_rules(
        &self,
        api_key: &str,
        envelope_engine: &Arc<EnvelopeEngine>,
        app: &tauri::AppHandle,
    ) -> Result<Vec<SnipeResult>, String> {
        let active_rules = db::list_active_rules(&self.db_path)?;
        let client = AlchemyClient::new(api_key);
        let mut results = Vec::new();

        for rule in &active_rules {
            // Guardrail: skip and deactivate rules past their expiry.
            if rule_is_expired(rule) {
                let _ = db::deactivate_with_reason(&self.db_path, &rule.id, db::DEACTIVATED_EXPIRED);
                results.push(SnipeResult {
                    rule_id: rule.id.clone(),
                    collection_slug: rule.collection_slug.clone(),
                    floor_price_eth: 0.0,
                    triggered: false,
                    tx_hash: None,
                    error: Some(format!("rule expired at {} — deactivated", rule.expires_at)),
                    deactivated_reason: Some(db::DEACTIVATED_EXPIRED.to_string()),
                });
                continue;
            }

            // Fetch floor price using the collection_slug as the contract address identifier.
            // The existing get_floor_price API takes a contract address; collection_slug is
            // used here as the lookup key (caller should pass a contract address as slug for v1).
            let floor_result = client.get_floor_price(&rule.collection_slug).await;

            match floor_result {
                Err(e) => {
                    results.push(SnipeResult {
                        rule_id: rule.id.clone(),
                        collection_slug: rule.collection_slug.clone(),
                        floor_price_eth: 0.0,
                        triggered: false,
                        tx_hash: None,
                        error: Some(format!("floor price fetch failed: {}", e)),
                        deactivated_reason: None,
                    });
                }
                Ok(floor_data) => {
                    let floor_price = match floor_data.floor_price {
                        Some(p) => p,
                        None => {
                            results.push(SnipeResult {
                                rule_id: rule.id.clone(),
                                collection_slug: rule.collection_slug.clone(),
                                floor_price_eth: 0.0,
                                triggered: false,
                                tx_hash: None,
                                error: Some("floor price unavailable".to_string()),
                                deactivated_reason: None,
                            });
                            continue;
                        }
                    };

                    if floor_price < rule.target_price_eth {
                        let snipe_result = self
                            .execute_snipe(rule, floor_price, envelope_engine, app)
                            .await;
                        results.push(snipe_result);
                    } else {
                        results.push(SnipeResult {
                            rule_id: rule.id.clone(),
                            collection_slug: rule.collection_slug.clone(),
                            floor_price_eth: floor_price,
                            triggered: false,
                            tx_hash: None,
                            error: None,
                            deactivated_reason: None,
                        });
                    }
                }
            }
        }

        Ok(results)
    }

    /// Execute a single snipe rule: check Envelope authorization, emit event, simulate tx.
    async fn execute_snipe(
        &self,
        rule: &SnipeRule,
        floor_price: f64,
        envelope_engine: &Arc<EnvelopeEngine>,
        app: &tauri::AppHandle,
    ) -> SnipeResult {
        // Guardrail: per-rule total spend ceiling. Checked before the envelope so
        // that a rule that has exhausted its own budget never even reaches it.
        // The rule is also switched off: it can never trigger again, so leaving it
        // active would burn a floor lookup every cycle for nothing.
        if let Some(reason) = spend_cap_block(rule, floor_price) {
            let _ = db::deactivate_with_reason(&self.db_path, &rule.id, db::DEACTIVATED_SPEND_CAP);
            return SnipeResult {
                rule_id: rule.id.clone(),
                collection_slug: rule.collection_slug.clone(),
                floor_price_eth: floor_price,
                triggered: false,
                tx_hash: None,
                error: Some(format!("{reason} — rule deactivated")),
                deactivated_reason: Some(db::DEACTIVATED_SPEND_CAP.to_string()),
            };
        }

        // Estimate value for the full sweep (floor * max_quantity), denominated in wei
        let projected_eth = projected_spend_eth(rule, floor_price);
        let value_wei = (projected_eth * 1e18) as u128;

        // Build a synthetic transaction request for Envelope authorization.
        // The "to" address is set to the wallet address itself as a placeholder;
        // real Seaport contract address will be used in Phase 3.
        let tx_request = TransactionRequest {
            to: rule.wallet_address.clone(),
            value_wei,
            calldata: format!(
                "snipe:{}:qty:{}",
                rule.collection_slug, rule.max_quantity
            ),
        };

        match envelope_engine.check_and_authorize(&tx_request) {
            Err(envelope_err) => {
                SnipeResult {
                    rule_id: rule.id.clone(),
                    collection_slug: rule.collection_slug.clone(),
                    floor_price_eth: floor_price,
                    triggered: false,
                    tx_hash: None,
                    error: Some(format!("envelope blocked: {:?}", envelope_err)),
                    deactivated_reason: None,
                }
            }
            Ok(()) => {
                // Envelope authorized — emit event to frontend
                let tx_hash = format!(
                    "0xSIMULATED_snipe_{}_{}",
                    &rule.id[..8],
                    chrono::Utc::now().timestamp()
                );

                let payload = SnipeTriggeredPayload {
                    rule_id: rule.id.clone(),
                    collection_slug: rule.collection_slug.clone(),
                    floor_price_eth: floor_price,
                    target_price_eth: rule.target_price_eth,
                    tx_hash: tx_hash.clone(),
                };
                app.emit("snipe-triggered", payload).ok();

                // Update DB: trigger count + accumulated (simulated) spend, so the
                // per-rule cap keeps shrinking across cycles.
                let _ = db::increment_triggered(&self.db_path, &rule.id);
                let _ = db::add_spent(&self.db_path, &rule.id, projected_eth);

                SnipeResult {
                    rule_id: rule.id.clone(),
                    collection_slug: rule.collection_slug.clone(),
                    floor_price_eth: floor_price,
                    triggered: true,
                    tx_hash: Some(tx_hash),
                    error: None,
                    deactivated_reason: None,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(expires_at: &str, cap: Option<f64>, spent: f64, qty: u32) -> SnipeRule {
        SnipeRule {
            id: "11111111-2222-3333-4444-555555555555".to_string(),
            collection_slug: "0xcontract".to_string(),
            target_price_eth: 1.0,
            max_quantity: qty,
            wallet_address: "0xwallet".to_string(),
            active: true,
            created_at: chrono::Utc::now().to_rfc3339(),
            triggered_count: 0,
            expires_at: expires_at.to_string(),
            max_total_spend_eth: cap,
            spent_eth: spent,
            deactivated_reason: None,
        }
    }

    #[test]
    fn expired_rule_is_detected() {
        let past = (chrono::Utc::now() - chrono::Duration::hours(1)).to_rfc3339();
        assert!(rule_is_expired(&rule(&past, None, 0.0, 1)));
    }

    #[test]
    fn future_and_malformed_expiry_are_not_expired() {
        let future = (chrono::Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        assert!(!rule_is_expired(&rule(&future, None, 0.0, 1)));
        assert!(!rule_is_expired(&rule("", None, 0.0, 1)));
        assert!(!rule_is_expired(&rule("not-a-timestamp", None, 0.0, 1)));
    }

    #[test]
    fn spend_cap_blocks_only_when_projection_exceeds_it() {
        // cap 1.0 ETH, nothing spent, 2 x 0.4 = 0.8 -> allowed
        assert!(spend_cap_block(&rule("", Some(1.0), 0.0, 2), 0.4).is_none());
        // same cap, 0.5 already spent -> 0.5 + 0.8 = 1.3 > 1.0 -> blocked
        assert!(spend_cap_block(&rule("", Some(1.0), 0.5, 2), 0.4).is_some());
        // no cap configured -> never blocked
        assert!(spend_cap_block(&rule("", None, 100.0, 10), 5.0).is_none());
    }
}
