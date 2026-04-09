mod alerts;
mod analytics;
mod envelope;
mod marketplace;
mod stream;
mod wallet;
mod rpc;
mod signing;
mod sniping;

use envelope::engine::EnvelopeEngine;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use chrono::Utc;
use uuid::Uuid;

static POLLING_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn activate_kill_switch(engine: tauri::State<Arc<EnvelopeEngine>>) -> bool {
    engine.activate_kill_switch();
    true
}

#[tauri::command]
fn get_envelope_status(engine: tauri::State<Arc<EnvelopeEngine>>) -> Option<envelope::engine::EnvelopeStatus> {
    engine.get_status()
}

#[tauri::command]
fn create_envelope(
    per_tx_ceiling_eth: f64,
    hard_cap_eth: f64,
    scope_addresses: Vec<String>,
    ttl_hours: u64,
    engine: tauri::State<Arc<EnvelopeEngine>>,
) -> Result<serde_json::Value, String> {
    let eth_to_wei = |eth: f64| -> u128 { (eth * 1e18) as u128 };
    let now = Utc::now().timestamp();
    let max_ttl_hours: u64 = 168; // 7 gün
    let ttl = ttl_hours.min(max_ttl_hours);

    let env = envelope::types::Envelope {
        id: Uuid::new_v4(),
        created_at: now,
        expires_at: now + (ttl as i64 * 3600),
        per_tx_ceiling_wei: eth_to_wei(per_tx_ceiling_eth),
        hard_cap_wei: eth_to_wei(hard_cap_eth),
        spent_wei: 0,
        scope: scope_addresses,
        kill_switch_active: false,
    };
    let envelope_id = env.id.to_string();
    let expires_at = env.expires_at;
    engine.create_envelope(env);
    Ok(serde_json::json!({
        "envelope_id": envelope_id,
        "expires_at": expires_at
    }))
}

#[tauri::command]
fn revoke_envelope(engine: tauri::State<Arc<EnvelopeEngine>>) -> bool {
    engine.revoke();
    true
}

#[tauri::command]
fn check_transaction(
    to: String,
    value_eth: f64,
    calldata: String,
    engine: tauri::State<Arc<EnvelopeEngine>>,
) -> serde_json::Value {
    let value_wei = (value_eth * 1e18) as u128;
    let request = envelope::types::TransactionRequest {
        to,
        value_wei,
        calldata,
    };
    match engine.check_and_authorize(&request) {
        Ok(()) => serde_json::json!({ "authorized": true }),
        Err(e) => serde_json::json!({ "authorized": false, "reject_reason": format!("{:?}", e) }),
    }
}

#[tauri::command]
fn deactivate_kill_switch(engine: tauri::State<Arc<EnvelopeEngine>>) -> bool {
    engine.deactivate_kill_switch();
    true
}

#[tauri::command]
fn import_wallet(
    address: String,
    private_key_hex: String,
) -> Result<String, String> {
    wallet::keychain::store_key(&address, &private_key_hex)?;
    Ok(address)
}

#[tauri::command]
async fn get_eth_balance(
    address: String,
    api_key: String,
) -> Result<rpc::types::EthBalance, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_eth_balance(&address).await
}

#[tauri::command]
async fn get_token_balances(
    address: String,
    api_key: String,
) -> Result<Vec<rpc::types::TokenBalance>, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_token_balances(&address).await
}

#[tauri::command]
async fn get_asset_transfers(
    address: String,
    api_key: String,
    from_block: String,
) -> Result<Vec<rpc::types::AssetTransfer>, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_asset_transfers(&address, &from_block).await
}

#[tauri::command]
async fn get_token_metadata(
    contract_address: String,
    api_key: String,
) -> Result<rpc::types::TokenMetadata, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_token_metadata(&contract_address).await
}

#[tauri::command]
async fn get_eth_price_usd(api_key: String) -> Result<f64, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_eth_price_usd().await
}

#[tauri::command]
async fn get_nfts_for_owner(
    owner_address: String,
    api_key: String,
    page_key: Option<String>,
) -> Result<rpc::types::NftsForOwnerResponse, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_nfts_for_owner(&owner_address, page_key.as_deref()).await
}

#[tauri::command]
async fn get_floor_price(
    contract_address: String,
    api_key: String,
) -> Result<rpc::types::NftFloorPrice, String> {
    let client = rpc::client::AlchemyClient::new(&api_key);
    client.get_floor_price(&contract_address).await
}

#[tauri::command]
fn save_alchemy_key(api_key: String) -> Result<(), String> {
    wallet::keychain::store_alchemy_key(&api_key)
}

#[tauri::command]
fn load_alchemy_key() -> Result<String, String> {
    wallet::keychain::fetch_alchemy_key()
}

#[tauri::command]
fn delete_alchemy_key_cmd() -> Result<(), String> {
    wallet::keychain::delete_alchemy_key()
}

#[tauri::command]
async fn create_alert(rule: alerts::AlertRuleInput) -> Result<String, String> {
    let db_path = alerts::ensure_db()?;
    alerts::db::create_alert(&db_path, &rule)
}

#[tauri::command]
async fn list_alerts(wallet_address: String) -> Result<Vec<alerts::AlertRule>, String> {
    let db_path = alerts::ensure_db()?;
    alerts::db::list_alerts(&db_path, &wallet_address)
}

#[tauri::command]
async fn delete_alert(id: String) -> Result<(), String> {
    let db_path = alerts::ensure_db()?;
    alerts::db::delete_alert(&db_path, &id)
}

#[tauri::command]
async fn set_alert_active(id: String, active: bool) -> Result<(), String> {
    let db_path = alerts::ensure_db()?;
    alerts::db::set_alert_active(&db_path, &id, active)
}

#[tauri::command]
async fn check_alerts_now(
    wallet_address: String,
    api_key: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_path = alerts::ensure_db()?;
    let engine = alerts::engine::AlertEngine::new(db_path);

    // Fetch current ETH balance
    let rpc_client = rpc::client::AlchemyClient::new(&api_key);
    let balance = rpc_client.get_eth_balance(&wallet_address).await?;

    // Check portfolio_value alerts
    let triggered = engine.check_portfolio_value_alerts(&wallet_address, balance.eth)?;
    for (rule, message) in triggered {
        engine.fire_alert(&rule, &message, &app).await?;
    }

    Ok(())
}

#[tauri::command]
async fn start_background_polling(
    wallet_addresses: Vec<String>,
    api_key: String,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    if POLLING_ACTIVE.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Ok(false); // already running
    }

    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;

            if let Ok(db_path) = alerts::ensure_db() {
                let engine = alerts::engine::AlertEngine::new(db_path);
                let rpc_client = rpc::client::AlchemyClient::new(&api_key);

                // Check portfolio_value alerts for every configured wallet
                for addr in &wallet_addresses {
                    if let Ok(balance) = rpc_client.get_eth_balance(addr).await {
                        if let Ok(triggered) = engine.check_portfolio_value_alerts(addr, balance.eth) {
                            for (rule, message) in triggered {
                                let _ = engine.fire_alert(&rule, &message, &app).await;
                            }
                        }
                    }
                }
            }
        }
    });

    Ok(true)
}

#[tauri::command]
async fn create_snipe_rule(input: sniping::SnipeRuleInput) -> Result<String, String> {
    let db_path = sniping::ensure_db()?;
    sniping::db::create_rule(&db_path, &input)
}

#[tauri::command]
async fn list_snipe_rules(wallet_address: String) -> Result<Vec<sniping::SnipeRule>, String> {
    let db_path = sniping::ensure_db()?;
    sniping::db::list_rules(&db_path, &wallet_address)
}

#[tauri::command]
async fn delete_snipe_rule(id: String) -> Result<(), String> {
    let db_path = sniping::ensure_db()?;
    sniping::db::delete_rule(&db_path, &id)
}

#[tauri::command]
async fn set_snipe_rule_active(id: String, active: bool) -> Result<(), String> {
    let db_path = sniping::ensure_db()?;
    sniping::db::set_rule_active(&db_path, &id, active)
}

#[tauri::command]
async fn run_snipe_check(
    api_key: String,
    app: tauri::AppHandle,
    engine: tauri::State<'_, std::sync::Arc<envelope::engine::EnvelopeEngine>>,
) -> Result<Vec<sniping::SnipeResult>, String> {
    let db_path = sniping::ensure_db()?;
    let snipe_engine = sniping::engine::SnipingEngine::new(db_path);
    snipe_engine.check_snipe_rules(&api_key, &engine.inner().clone(), &app).await
}

// ── Subscription ─────────────────────────────────────────────────────────────

/// Open a URL in the user's default browser (for Stripe checkout).
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    // Basic URL validation — only allow https:// to prevent abuse
    if !url.starts_with("https://") {
        return Err("only https:// URLs are permitted".to_string());
    }
    open::that(&url).map_err(|e| format!("failed to open URL: {}", e))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SubscriptionCheckResult {
    pub active: bool,
    pub plan: Option<String>,       // "monthly" | "annual" | null
    pub expires_at: Option<String>, // ISO date string
    pub error: Option<String>,
}

const SUBSCRIPTION_WORKER_URL: &str = "https://westron-subscription.YOUR_SUBDOMAIN.workers.dev";

/// Check subscription status for a wallet address against the Westron subscription worker.
/// Falls back to the locally cached result if the worker is unreachable.
#[tauri::command]
async fn check_subscription(wallet_address: String) -> SubscriptionCheckResult {
    let addr = wallet_address.trim().to_lowercase();
    if addr.is_empty() {
        return SubscriptionCheckResult {
            active: false, plan: None, expires_at: None,
            error: Some("No wallet address provided".to_string()),
        };
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .unwrap_or_default();

    let resp = client
        .post(format!("{}/validate", SUBSCRIPTION_WORKER_URL))
        .header("content-type", "application/json")
        .json(&serde_json::json!({ "wallet": addr }))
        .send()
        .await;

    match resp {
        Err(e) => {
            log::warn!("Subscription worker unreachable: {}", e);
            SubscriptionCheckResult {
                active: false, plan: None, expires_at: None,
                error: Some("Could not reach subscription server. Using cached status.".to_string()),
            }
        }
        Ok(r) => {
            let body: serde_json::Value = r.json().await.unwrap_or_default();
            SubscriptionCheckResult {
                active: body.get("active").and_then(|v| v.as_bool()).unwrap_or(false),
                plan: body.get("plan").and_then(|p| p.as_str()).map(str::to_string),
                expires_at: body.get("expires_at").and_then(|e| e.as_str()).map(str::to_string),
                error: None,
            }
        }
    }
}

// ── OpenSea API key commands ──────────────────────────────────────────────────

#[tauri::command]
fn save_opensea_key(api_key: String) -> Result<(), String> {
    wallet::keychain::store_opensea_key(&api_key)
}

#[tauri::command]
fn load_opensea_key() -> Result<String, String> {
    wallet::keychain::fetch_opensea_key()
}

#[tauri::command]
fn delete_opensea_key_cmd() -> Result<(), String> {
    wallet::keychain::delete_opensea_key()
}

// ── Marketplace commands ──────────────────────────────────────────────────────

#[tauri::command]
async fn marketplace_list_nft(
    wallet_address: String,
    contract_address: String,
    token_id: String,
    price_eth: f64,
    marketplace: String,
    expiry_hours: u64,
    api_key: String,
) -> Result<marketplace::OrderResult, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = match marketplace.to_lowercase().as_str() {
        "blur" => marketplace::Marketplace::Blur,
        _ => marketplace::Marketplace::Opensea,
    };
    let input = marketplace::ListingInput { wallet_address, contract_address, token_id, price_eth, marketplace: mp, expiry_hours };
    marketplace::list_nft(&input, &api_key, &opensea_key).await
}

#[tauri::command]
async fn marketplace_place_bid(
    wallet_address: String,
    contract_address: String,
    price_eth: f64,
    quantity: u32,
    marketplace: String,
    expiry_hours: u64,
    api_key: String,
) -> Result<marketplace::OrderResult, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = match marketplace.to_lowercase().as_str() {
        "blur" => marketplace::Marketplace::Blur,
        _ => marketplace::Marketplace::Opensea,
    };
    let input = marketplace::BidInput { wallet_address, contract_address, price_eth, quantity, marketplace: mp, expiry_hours };
    marketplace::place_bid(&input, &api_key, &opensea_key).await
}

#[tauri::command]
async fn marketplace_cancel_order(
    order_hash: String,
    wallet_address: String,
    marketplace: String,
    api_key: String,
) -> Result<marketplace::OrderResult, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = match marketplace.to_lowercase().as_str() {
        "blur" => marketplace::Marketplace::Blur,
        _ => marketplace::Marketplace::Opensea,
    };
    let input = marketplace::CancelInput { order_hash, wallet_address, marketplace: mp };
    marketplace::cancel_order(&input, &api_key, &opensea_key).await
}

#[tauri::command]
async fn fetch_collection_nfts(collection_slug: String, limit: u32) -> Result<Vec<marketplace::NftAsset>, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_nfts(&collection_slug, limit, &opensea_key).await
}

#[tauri::command]
async fn fetch_nfts_by_collection(
    collection_slug: String,
    status: String,
    wallet_address: Option<String>,
    cursor: Option<String>,
    sort: String,
    limit: u32,
) -> Result<marketplace::NftPage, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_nfts_by_collection(
        &collection_slug,
        &status,
        wallet_address.as_deref(),
        cursor.as_deref(),
        &sort,
        limit,
        &opensea_key,
    )
    .await
}

#[tauri::command]
async fn fetch_collection_by_contract(contract_address: String) -> Result<marketplace::CollectionInfo, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_by_contract(&contract_address, &opensea_key).await
}

// ── Collection data commands ──────────────────────────────────────────────────

#[tauri::command]
async fn fetch_collection_stats(collection_slug: String) -> Result<marketplace::CollectionStats, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_stats(&collection_slug, &opensea_key).await
}

#[tauri::command]
async fn fetch_collection_events(collection_slug: String, event_type: String, limit: u32) -> Result<Vec<marketplace::CollectionEvent>, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_events(&collection_slug, &event_type, limit, &opensea_key).await
}

#[tauri::command]
async fn fetch_collection_holders(contract_address: String, limit: u32) -> Result<Vec<marketplace::CollectionHolder>, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    let alchemy_key = wallet::keychain::fetch_alchemy_key().unwrap_or_default();
    marketplace::fetch_collection_holders(&contract_address, &alchemy_key, limit as usize, &opensea_key).await
}

#[tauri::command]
async fn fetch_collection_offers(collection_slug: String, limit: u32) -> Result<Vec<marketplace::CollectionOffer>, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_offers(&collection_slug, limit, &opensea_key).await
}

#[tauri::command]
async fn fetch_collection_traits(collection_slug: String, total_supply: u64) -> Result<Vec<marketplace::CollectionTrait>, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    marketplace::fetch_collection_traits(&collection_slug, total_supply, &opensea_key).await
}

// ── Stream API ────────────────────────────────────────────────────────────────

#[tauri::command]
async fn start_stream(
    collections: Vec<String>,
    stream_manager: tauri::State<'_, Arc<stream::StreamManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key is empty — add it in Settings".to_string());
    }
    stream_manager.start(opensea_key, collections, app);
    Ok(())
}

#[tauri::command]
async fn stop_stream(
    stream_manager: tauri::State<'_, Arc<stream::StreamManager>>,
) -> Result<(), String> {
    stream_manager.stop();
    Ok(())
}

#[tauri::command]
async fn get_stream_status(
    stream_manager: tauri::State<'_, Arc<stream::StreamManager>>,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "running": stream_manager.is_running(),
        "subscribed_collections": stream_manager.subscribed_collections(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let engine = Arc::new(EnvelopeEngine::new());
  let stream_manager = Arc::new(stream::StreamManager::new());

  tauri::Builder::default()
    .manage(engine)
    .manage(stream_manager)
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        get_app_version,
        create_envelope,
        revoke_envelope,
        check_transaction,
        activate_kill_switch,
        deactivate_kill_switch,
        get_envelope_status,
        import_wallet,
        get_eth_balance,
        get_token_balances,
        get_asset_transfers,
        get_token_metadata,
        get_eth_price_usd,
        save_alchemy_key,
        load_alchemy_key,
        delete_alchemy_key_cmd,
        save_opensea_key,
        load_opensea_key,
        delete_opensea_key_cmd,
        get_nfts_for_owner,
        get_floor_price,
        create_alert,
        list_alerts,
        delete_alert,
        set_alert_active,
        check_alerts_now,
        start_background_polling,
        signing::send_eth,
        signing::estimate_gas,
        create_snipe_rule,
        list_snipe_rules,
        delete_snipe_rule,
        set_snipe_rule_active,
        run_snipe_check,
        analytics::engine::get_pnl_summary,
        analytics::engine::get_trade_history,
        analytics::engine::get_portfolio_snapshot,
        marketplace_list_nft,
        marketplace_place_bid,
        marketplace_cancel_order,
        fetch_collection_nfts,
        fetch_nfts_by_collection,
        fetch_collection_by_contract,
        fetch_collection_stats,
        fetch_collection_events,
        fetch_collection_holders,
        fetch_collection_offers,
        fetch_collection_traits,
        open_external_url,
        check_subscription,
        start_stream,
        stop_stream,
        get_stream_status,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
