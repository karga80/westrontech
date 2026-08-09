pub mod types;
pub mod audit;
pub mod engine;

/// Maximum envelope time-to-live (7 days).
pub const MAX_TTL_HOURS: u64 = 168;

/// Build an `Envelope` from the ETH-denominated inputs the UI and the control
/// server both use, applying the TTL ceiling. Shared so the Tauri command and
/// the HTTP handler cannot drift apart.
pub fn build_envelope(
    per_tx_ceiling_eth: f64,
    hard_cap_eth: f64,
    scope_addresses: Vec<String>,
    ttl_hours: u64,
) -> types::Envelope {
    let eth_to_wei = |eth: f64| -> u128 { (eth * 1e18) as u128 };
    let now = chrono::Utc::now().timestamp();
    let ttl = ttl_hours.min(MAX_TTL_HOURS);
    types::Envelope {
        id: uuid::Uuid::new_v4(),
        created_at: now,
        expires_at: now + (ttl as i64 * 3600),
        per_tx_ceiling_wei: eth_to_wei(per_tx_ceiling_eth),
        hard_cap_wei: eth_to_wei(hard_cap_eth),
        spent_wei: 0,
        scope: scope_addresses,
        kill_switch_active: false,
    }
}
