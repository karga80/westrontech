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
    /// RFC3339 timestamp after which the rule is auto-deactivated (guardrail).
    pub expires_at: String,
    /// Optional per-rule spend ceiling in ETH. When set, the engine refuses to
    /// trigger once `spent_eth + floor * max_quantity` would exceed it.
    pub max_total_spend_eth: Option<f64>,
    /// Accumulated (simulated) spend for this rule in ETH.
    pub spent_eth: f64,
    /// Why the *engine* switched this rule off: `"expired"`, `"spend_cap_reached"`,
    /// or `None`. A rule the user paused by hand keeps `None`, so a user pause is
    /// always distinguishable from a guardrail deactivation.
    pub deactivated_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnipeRuleInput {
    pub collection_slug: String,
    pub target_price_eth: f64,
    pub max_quantity: u32,
    pub wallet_address: String,
    /// Time-to-live in hours. Defaults to 48, capped at 168 (7 days).
    #[serde(default)]
    pub ttl_hours: Option<u64>,
    /// Optional per-rule total spend cap in ETH.
    #[serde(default)]
    pub max_total_spend_eth: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnipeResult {
    pub rule_id: String,
    pub collection_slug: String,
    pub floor_price_eth: f64,
    pub triggered: bool,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
    /// Set when this cycle deactivated the rule as a guardrail: `"expired"` or
    /// `"spend_cap_reached"`. Mirrors `SnipeRule::deactivated_reason`.
    #[serde(default)]
    pub deactivated_reason: Option<String>,
}
