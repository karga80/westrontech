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
        // Estimate value for the full sweep (floor * max_quantity), denominated in wei
        let value_wei = (floor_price * rule.max_quantity as f64 * 1e18) as u128;

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

                // Update DB
                let _ = db::increment_triggered(&self.db_path, &rule.id);

                SnipeResult {
                    rule_id: rule.id.clone(),
                    collection_slug: rule.collection_slug.clone(),
                    floor_price_eth: floor_price,
                    triggered: true,
                    tx_hash: Some(tx_hash),
                    error: None,
                }
            }
        }
    }
}
