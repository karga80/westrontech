use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Emitter;

use super::db;
use super::types::{SnipeResult, SnipeRule};
use crate::envelope::engine::EnvelopeEngine;
use crate::envelope::types::TransactionRequest;
use crate::rpc::client::AlchemyClient;

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

/// Arm-at-creation gate: a rule may only fire while its wallet is armed — the
/// key lives in memory for the window the user approved with Touch ID, and
/// quitting the app ends it.
///
/// The rule is deliberately NOT deactivated (`deactivated_reason` stays `None`):
/// being disarmed is recoverable in one click, and switching the rule off would
/// make a temporary state look permanent.
///
/// `is_armed` is taken as a closure so the gate is testable without a Keychain,
/// and so the caller cannot accidentally reach for `key_for` — answering a
/// yes/no question with a copy of the raw private key, once per rule per
/// scheduler tick, for the whole armed window.
fn disarmed_block(
    rule: &SnipeRule,
    floor_price: f64,
    is_armed: impl Fn(&str) -> bool,
) -> Option<SnipeResult> {
    if is_armed(&rule.wallet_address) {
        return None;
    }
    Some(SnipeResult {
        rule_id: rule.id.clone(),
        collection_slug: rule.collection_slug.clone(),
        floor_price_eth: floor_price,
        triggered: false,
        tx_hash: None,
        error: Some(
            "wallet is disarmed — re-arm it with Touch ID for this rule to fire".to_string(),
        ),
        deactivated_reason: None,
    })
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
                let _ =
                    db::deactivate_with_reason(&self.db_path, &rule.id, db::DEACTIVATED_EXPIRED);
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
        if let Some(blocked) = disarmed_block(rule, floor_price, |addr| {
            crate::wallet::armed::is_armed(addr)
        }) {
            return blocked;
        }

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
        // Kapı-2: NaN/inf/negatif floor (zehirli ya da bozuk fiyat okuması)
        // value_wei'yi sessizce 0'a çevirip envelope'u anlamsız kılmasın —
        // aralık dışıysa u128::MAX ver, envelope kesin reddetsin (fail-closed).
        let value_wei: u128 = if projected_eth.is_finite() && projected_eth >= 0.0 {
            (projected_eth * 1e18) as u128
        } else {
            u128::MAX
        };

        // Synthetic envelope request. NOTE (Kapı-2): `to` is a PLACEHOLDER — the
        // wallet's own address — because this path is still SIMULATED and the
        // real Seaport fulfillment target is a Phase-3 blocker. Two consequences
        // are enforced right here:
        //   1) We call `preview` (READ-ONLY), never `check_and_authorize`, so a
        //      simulated fire cannot consume the real shared envelope budget or
        //      trip the persisted kill switch (audit HIGH-1). The per-rule
        //      simulated spend is still tracked separately via `db::add_spent`.
        //   2) Before this path may BROADCAST for real, `to` MUST become the real
        //      fulfillment contract AND be run through the autonomy contract
        //      allowlist. The debug_assert below is a tripwire against wiring
        //      real broadcast while the placeholder is still in place.
        let tx_request = TransactionRequest {
            to: rule.wallet_address.clone(),
            value_wei,
            calldata: format!("snipe:{}:qty:{}", rule.collection_slug, rule.max_quantity),
        };
        debug_assert!(
            tx_request.to == rule.wallet_address,
            "sniping still uses the placeholder envelope destination — do not enable real \
             broadcast until `to` is the real Seaport target and the autonomy allowlist is checked"
        );

        // preview() runs the identical guards as check_and_authorize but mutates
        // nothing — correct for a simulated fire.
        let auth: Result<(), String> = {
            let p = envelope_engine.preview(&tx_request);
            if p.authorized {
                Ok(())
            } else {
                Err(p.reject_reason.unwrap_or_else(|| "not authorized".to_string()))
            }
        };

        match auth {
            Err(envelope_err) => SnipeResult {
                rule_id: rule.id.clone(),
                collection_slug: rule.collection_slug.clone(),
                floor_price_eth: floor_price,
                triggered: false,
                tx_hash: None,
                error: Some(format!("envelope blocked: {}", envelope_err)),
                deactivated_reason: None,
            },
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
    fn a_disarmed_wallet_blocks_the_trigger_without_deactivating_the_rule() {
        let r = rule("", None, 0.0, 1);
        let blocked = disarmed_block(&r, 0.4, |_| false).expect("disarmed must block");

        assert!(!blocked.triggered);
        assert!(blocked.tx_hash.is_none(), "a blocked trigger has no hash");
        assert!(blocked.error.as_deref().unwrap().contains("disarmed"));
        // The whole point: disarmed is a temporary state the user can undo, so
        // the rule must survive it. If this ever starts carrying a reason, a
        // Touch ID window lapsing overnight would silently kill the rule.
        assert!(blocked.deactivated_reason.is_none());
        assert_eq!(blocked.rule_id, r.id);
        assert_eq!(blocked.floor_price_eth, 0.4);
    }

    #[test]
    fn an_armed_wallet_does_not_block() {
        assert!(disarmed_block(&rule("", None, 0.0, 1), 0.4, |_| true).is_none());
    }

    #[test]
    fn the_gate_asks_about_the_rules_own_wallet() {
        let r = rule("", None, 0.0, 1);
        let asked = std::cell::RefCell::new(None);
        disarmed_block(&r, 0.4, |addr| {
            *asked.borrow_mut() = Some(addr.to_string());
            true
        });
        assert_eq!(
            asked.into_inner().as_deref(),
            Some(r.wallet_address.as_str())
        );
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
