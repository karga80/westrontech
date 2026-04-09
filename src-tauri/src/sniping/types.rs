use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnipeRule {
    pub id: String,
    pub collection_slug: String,
    pub target_price_eth: f64,
    pub max_quantity: u32,
    pub wallet_address: String,
    pub active: bool,
    pub created_at: String,
    pub triggered_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnipeRuleInput {
    pub collection_slug: String,
    pub target_price_eth: f64,
    pub max_quantity: u32,
    pub wallet_address: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnipeResult {
    pub rule_id: String,
    pub collection_slug: String,
    pub floor_price_eth: f64,
    pub triggered: bool,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
}
