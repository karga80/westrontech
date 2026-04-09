use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlertRuleInput {
    pub alert_type: String,
    pub wallet_address: String,
    pub collection_slug: Option<String>,
    pub threshold_eth: f64,
    pub condition: String,
    pub discord_webhook: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlertRule {
    pub id: String,
    pub alert_type: String,
    pub wallet_address: String,
    pub collection_slug: Option<String>,
    pub threshold_eth: f64,
    pub condition: String,
    pub discord_webhook: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub last_triggered_at: Option<String>,
}
