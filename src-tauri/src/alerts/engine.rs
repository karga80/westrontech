use std::path::PathBuf;
use reqwest::Client;
use tauri::{AppHandle, Emitter};

use super::db;
use super::types::AlertRule;

pub struct AlertEngine {
    pub db_path: PathBuf,
}

impl AlertEngine {
    pub fn new(db_path: PathBuf) -> Self {
        AlertEngine { db_path }
    }

    pub fn check_portfolio_value_alerts(
        &self,
        wallet: &str,
        eth_balance: f64,
    ) -> Result<Vec<(AlertRule, String)>, String> {
        let rules = db::list_active_alerts_for_wallet(&self.db_path, wallet, "portfolio_value")?;
        let mut triggered = Vec::new();
        for rule in rules {
            let fires = match rule.condition.as_str() {
                "above" => eth_balance > rule.threshold_eth,
                "below" => eth_balance < rule.threshold_eth,
                _ => false,
            };
            if fires {
                let message = format!(
                    "Portfolio alert: wallet {} ETH balance {:.4} is {} {:.4} ETH",
                    rule.wallet_address, eth_balance, rule.condition, rule.threshold_eth
                );
                triggered.push((rule, message));
            }
        }
        Ok(triggered)
    }

    #[allow(dead_code)]
    pub fn check_floor_price_alerts(
        &self,
        collection_slug: &str,
        floor_eth: f64,
    ) -> Result<Vec<(AlertRule, String)>, String> {
        let rules = db::list_active_floor_alerts(&self.db_path, collection_slug)?;
        let mut triggered = Vec::new();
        for rule in rules {
            let fires = match rule.condition.as_str() {
                "above" => floor_eth > rule.threshold_eth,
                "below" => floor_eth < rule.threshold_eth,
                _ => false,
            };
            if fires {
                let message = format!(
                    "Floor price alert: {} floor {:.4} ETH is {} {:.4} ETH",
                    collection_slug, floor_eth, rule.condition, rule.threshold_eth
                );
                triggered.push((rule, message));
            }
        }
        Ok(triggered)
    }

    pub async fn fire_alert(
        &self,
        rule: &AlertRule,
        message: &str,
        app: &AppHandle,
    ) -> Result<(), String> {
        // Emit Tauri event to frontend (frontend can show macOS notification)
        app.emit("alert-fired", serde_json::json!({
            "rule_id": rule.id,
            "message": message,
            "alert_type": rule.alert_type,
            "wallet_address": rule.wallet_address,
        }))
        .map_err(|e| e.to_string())?;

        // Send Discord webhook if configured
        if let Some(ref webhook_url) = rule.discord_webhook {
            let client = Client::new();
            let _resp = client
                .post(webhook_url)
                .json(&serde_json::json!({ "content": message }))
                .send()
                .await
                .map_err(|e: reqwest::Error| e.to_string())?;
        }

        // Update last_triggered_at in DB
        db::update_last_triggered(&self.db_path, &rule.id)?;

        Ok(())
    }
}
