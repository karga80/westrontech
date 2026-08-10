mod alerts;
mod analytics;
mod autonomy;
mod control;
mod data;
mod envelope;
mod marketplace;
mod nft;
mod stream;
mod wallet;
mod rpc;
mod signing;
mod sniping;
mod sister;
mod subscription;
mod pnl;
mod persist;

use autonomy::engine::AutonomyEngine;
use envelope::engine::EnvelopeEngine;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri::Manager;

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
    // Shared with the control server's POST /envelope so the two cannot drift.
    let env = envelope::build_envelope(per_tx_ceiling_eth, hard_cap_eth, scope_addresses, ttl_hours);
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

/// **Consumes spend budget — this is not a pre-flight check.**
///
/// Despite the name, a successful call adds `value_eth` to the envelope's
/// `spent_wei` and persists it. Calling it to ask "would this be allowed?" and
/// then sending charges the hard cap twice for one transfer, and for any value
/// above half the remaining headroom the second call trips the automatic kill
/// switch without any ETH having moved.
///
/// Behaviour and signature are deliberately unchanged — the webview may still
/// call it — but new callers want [`preview_transaction`], which runs the
/// identical guards and mutates nothing. Call this one exactly once,
/// immediately before signing.
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

/// Read-only sibling of [`check_transaction`]: runs every guard the real
/// authorisation runs — active envelope, kill switch, expiry, scope, per-tx
/// ceiling, hard-cap headroom — and returns a structured verdict **without**
/// touching `spent_wei`, engaging the kill switch, writing an audit entry, or
/// persisting anything.
///
/// `value_wei` is a decimal string rather than an f64 of ETH: wei does not
/// survive a round trip through a JS number, and a pre-flight check that
/// silently re-rounds the amount it is checking is not a check.
#[tauri::command]
fn preview_transaction(
    to: String,
    value_wei: String,
    calldata: Option<String>,
    engine: tauri::State<Arc<EnvelopeEngine>>,
) -> Result<envelope::engine::TransactionPreview, String> {
    let value_wei: u128 = value_wei
        .trim()
        .parse()
        .map_err(|_| format!("value_wei must be a decimal wei amount, got {value_wei:?}"))?;
    let request = envelope::types::TransactionRequest {
        to,
        value_wei,
        calldata: calldata.unwrap_or_default(),
    };
    Ok(engine.preview(&request))
}

#[tauri::command]
fn deactivate_kill_switch(engine: tauri::State<Arc<EnvelopeEngine>>) -> bool {
    engine.deactivate_kill_switch();
    true
}

/// Derives the wallet address from the private key itself and stores the key
/// under that derived address.
///
/// The caller-supplied `address` is NEVER trusted: an earlier build passed the
/// private key straight through as the address, which put the key in
/// localStorage and sent it to Alchemy as a query parameter. The key is the
/// only source of truth. A supplied address is treated as an assertion and must
/// match, so a UI bug can no longer file a key under the wrong identity.
#[tauri::command]
fn import_wallet(
    address: Option<String>,
    private_key_hex: String,
) -> Result<String, String> {
    use alloy::signers::local::PrivateKeySigner;

    let pk_hex = private_key_hex.trim();
    let pk_hex = pk_hex.strip_prefix("0x").unwrap_or(pk_hex);

    let signer: PrivateKeySigner = pk_hex
        .parse()
        .map_err(|_| "Invalid private key - expected 64 hex characters.".to_string())?;

    let derived = signer.address().to_checksum(None);

    if let Some(claimed) = address.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if !claimed.eq_ignore_ascii_case(&derived) {
            return Err(format!(
                "Address mismatch: this private key belongs to {derived}, not {claimed}."
            ));
        }
    }

    wallet::keychain::store_key(&derived, pk_hex)?;
    Ok(derived)
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
    // Now sourced from Alchemy Prices API (CoinGecko removed).
    let provider = data::default_provider(&api_key);
    use data::PriceProvider;
    provider.get_eth_price_usd().await.map_err(|e| e.to_string())
}

// ── New data-layer commands (Phase 1–3): Prices, Portfolio, NFT enrichment ───

#[tauri::command]
async fn get_token_prices_by_symbol(
    symbols: Vec<String>,
    api_key: String,
) -> Result<Vec<data::TokenPrice>, String> {
    let provider = data::default_provider(&api_key);
    use data::PriceProvider;
    let refs: Vec<&str> = symbols.iter().map(|s| s.as_str()).collect();
    provider.get_prices_by_symbol(&refs).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_token_prices_by_address(
    addresses: Vec<String>,
    api_key: String,
) -> Result<Vec<data::TokenPrice>, String> {
    let provider = data::default_provider(&api_key);
    use data::PriceProvider;
    let refs: Vec<&str> = addresses.iter().map(|s| s.as_str()).collect();
    provider.get_prices_by_address(&refs).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_wallet_portfolio(
    wallet: String,
    api_key: String,
) -> Result<data::WalletPortfolio, String> {
    let provider = data::default_provider(&api_key);
    use data::WalletDataProvider;
    provider.get_wallet_portfolio(&wallet).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_wallet_tokens(
    wallet: String,
    api_key: String,
) -> Result<Vec<data::types::WalletToken>, String> {
    let provider = data::default_provider(&api_key);
    use data::WalletDataProvider;
    provider.get_wallet_tokens(&wallet).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_collection_metadata(
    contract: String,
    api_key: String,
) -> Result<data::NftCollectionMeta, String> {
    let provider = data::default_provider(&api_key);
    use data::NftDataProvider;
    provider.get_collection_metadata(&contract).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_nft_sales(
    contract: String,
    token_id: Option<String>,
    limit: u32,
    api_key: String,
) -> Result<Vec<data::NftSale>, String> {
    let provider = data::default_provider(&api_key);
    use data::NftDataProvider;
    provider.get_nft_sales(&contract, token_id.as_deref(), limit).await.map_err(|e| e.to_string())
}

// ── Real-time subscription commands (Phase 4–5) ──────────────────────────────

#[tauri::command]
async fn realtime_init(
    api_key: String,
    app: tauri::AppHandle,
    realtime: tauri::State<'_, std::sync::Mutex<Option<std::sync::Arc<data::realtime::RealtimeManager>>>>,
) -> Result<(), String> {
    let provider = data::default_provider(&api_key);
    let http = std::sync::Arc::new(data::alchemy::AlchemyHttpClient::new(&api_key));
    let mgr = std::sync::Arc::new(data::realtime::RealtimeManager::new(provider, http));
    mgr.start(app);
    *realtime.lock().unwrap() = Some(mgr);
    Ok(())
}

#[tauri::command]
async fn realtime_set_watch_set(
    set: data::realtime::WatchSet,
    realtime: tauri::State<'_, std::sync::Mutex<Option<std::sync::Arc<data::realtime::RealtimeManager>>>>,
) -> Result<(), String> {
    let mgr = realtime.lock().unwrap().as_ref().cloned();
    let mgr = mgr.ok_or_else(|| "realtime not initialized — call realtime_init first".to_string())?;
    mgr.apply_watch_set(set).await.map_err(|e| e.to_string())
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

/// Where secrets are stored, plus the outcome of the one-time move of any
/// plaintext `*.key` files into the macOS Keychain. `pending > 0` means a key
/// is still on disk because its Keychain copy could not be verified.
#[tauri::command]
fn get_keychain_status() -> wallet::keychain::KeychainStatus {
    wallet::keychain::keychain_status()
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

/// Check subscription status for the currently logged-in account. Fetches a
/// fresh signed license from the worker when online, verifies it with the
/// embedded public key, caches it, and re-verifies offline with
/// clock-rollback protection. See `subscription` module. Returns an
/// `active: false` result with an explanatory `error` if no account is
/// logged in yet — call `subscription_signup`/`subscription_login` first.
#[tauri::command]
async fn check_subscription() -> subscription::SubscriptionCheckResult {
    subscription::evaluate().await
}

/// Create a new account (email + password) and store the resulting session.
#[tauri::command]
async fn subscription_signup(
    email: String,
    password: String,
) -> Result<subscription::SubscriptionCheckResult, String> {
    subscription::signup(&email, &password).await
}

/// Log in to an existing account and store the resulting session.
#[tauri::command]
async fn subscription_login(
    email: String,
    password: String,
) -> Result<subscription::SubscriptionCheckResult, String> {
    subscription::login(&email, &password).await
}

/// Forget the current session and its cached license.
#[tauri::command]
fn subscription_logout() -> Result<(), String> {
    subscription::logout()
}

/// Email of the currently logged-in account, if any — for display only.
#[tauri::command]
fn subscription_current_account() -> Option<String> {
    subscription::current_account_email()
}

// ── NFT PnL: locally-stored cost basis (recorded once from marketplace sales) ──

#[tauri::command]
async fn backfill_nft_cost_basis(wallet: String, api_key: String) -> Result<pnl::BackfillResult, String> {
    pnl::backfill_cost_basis(&wallet, &api_key).await
}

#[tauri::command]
async fn get_nft_pnl(wallet: String, api_key: String) -> Result<pnl::NftPnlSummary, String> {
    pnl::compute(&wallet, &api_key).await
}

#[tauri::command]
fn set_nft_cost_basis(wallet: String, contract: String, token_id: String, price_eth: f64) -> Result<(), String> {
    pnl::set_manual_cost(&wallet, &contract, &token_id, price_eth)
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

// ── Etherscan API key commands (used by the sister-wallet finder) ─────────────

#[tauri::command]
fn save_etherscan_key(api_key: String) -> Result<(), String> {
    wallet::keychain::store_etherscan_key(&api_key)
}

#[tauri::command]
fn load_etherscan_key() -> Result<String, String> {
    wallet::keychain::fetch_etherscan_key()
}

#[tauri::command]
fn delete_etherscan_key_cmd() -> Result<(), String> {
    wallet::keychain::delete_etherscan_key()
}

// ── Sister-wallet finder ──────────────────────────────────────────────────────

#[tauri::command]
async fn find_sister_wallets(address: String) -> Result<sister::types::SisterReport, String> {
    let api_key = wallet::keychain::fetch_etherscan_key()
        .map_err(|_| "Etherscan API key not set — add it in Settings first.".to_string())?;
    sister::find_sisters(&address, &api_key).await
}

// ── Marketplace commands ──────────────────────────────────────────────────────

/// Envelope + autonomy gate shared by all three marketplace signing paths
/// below. Mirrors `signing::send_eth`/`signing::transfer_nft` exactly:
/// envelope's `check_and_authorize` runs first and is never replaced, the
/// autonomy check is strictly additive and runs only after it succeeds, and
/// a failure at either stage rolls back whatever the envelope just
/// committed. `value_wei` for the envelope's own request is always `0` here
/// — none of these three calls move any ETH themselves, they only produce or
/// cancel an off-chain-signed order — so there is nothing to roll back
/// numerically, but the audit trail and scope/kill-switch/expiry guards
/// still apply exactly as they do for a real transfer.
///
/// `action_value_wei` is a *separate* number from the envelope's `value_wei`
/// on purpose: it's the price exposure a listing/bid puts at risk (used to
/// evaluate an autonomy rule's `per_tx_cap_wei`/`total_budget_cap_wei`), not
/// ETH actually leaving the wallet on this call. Converting `price_eth: f64`
/// into that number happens once, via `marketplace::seaport::eth_to_wei` —
/// never inline here or anywhere else — before it ever reaches the proposal.
/// Either the envelope+autonomy gate cleared and the caller may perform the
/// marketplace call now (carrying the envelope reservation so the caller can
/// still roll it back if the call itself fails), or the action was queued
/// for approval and the caller must not perform it.
enum MarketplaceAuthorization {
    Proceed(envelope::types::TransactionRequest),
    Queued { proposal_id: String, reason: String },
}

async fn authorize_marketplace_action(
    envelope_engine: &EnvelopeEngine,
    autonomy_engine: &AutonomyEngine,
    wallet_address: &str,
    envelope_to: &str,
    action_type: autonomy::types::ActionType,
    target_contract: Option<String>,
    action_value_wei: u128,
    payload: autonomy::pending::PendingActionPayload,
) -> Result<MarketplaceAuthorization, String> {
    let tx_req_envelope = envelope::types::TransactionRequest {
        to: envelope_to.to_string(),
        value_wei: 0,
        calldata: String::new(),
    };
    envelope_engine
        .check_and_authorize(&tx_req_envelope)
        .map_err(|e| format!("Envelope rejected: {e:?}"))?;

    let kill_switch_active =
        envelope_engine.get_status().map(|s| s.kill_switch).unwrap_or(false);
    let proposal = autonomy::types::ActionProposal {
        action_type,
        wallet_address: wallet_address.to_string(),
        target_contract,
        calldata: None,
        value_wei: action_value_wei,
        chain_id: signing::CHAIN_ID,
    };
    match signing::authorize_or_queue(autonomy_engine, &proposal, kill_switch_active, payload) {
        Ok(signing::AuthorizationOutcome::Proceed) => Ok(MarketplaceAuthorization::Proceed(tx_req_envelope)),
        Ok(signing::AuthorizationOutcome::Queued { proposal_id, reason }) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            Ok(MarketplaceAuthorization::Queued { proposal_id, reason })
        }
        Err(e) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            Err(e)
        }
    }
}

/// Parse a marketplace name coming from the frontend (or from a stored
/// `PendingActionPayload`) into `marketplace::Marketplace`. Shared by every
/// command that accepts a marketplace name — including
/// `execute_pending_payload` — so this mapping (unrecognized names quietly
/// default to OpenSea) exists in exactly one place rather than being
/// retyped at each call site.
fn parse_marketplace_name(name: &str) -> marketplace::Marketplace {
    match name.to_lowercase().as_str() {
        "blur" => marketplace::Marketplace::Blur,
        _ => marketplace::Marketplace::Opensea,
    }
}

#[tauri::command]
async fn marketplace_list_nft(
    wallet_address: String,
    contract_address: String,
    token_id: String,
    price_eth: f64,
    marketplace: String,
    expiry_hours: u64,
    api_key: String,
    envelope_engine: tauri::State<'_, Arc<EnvelopeEngine>>,
    autonomy_engine: tauri::State<'_, Arc<AutonomyEngine>>,
) -> Result<marketplace::MarketplaceActionOutcome, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = parse_marketplace_name(&marketplace);

    let payload = autonomy::pending::PendingActionPayload::MarketplaceList {
        contract_address: contract_address.clone(),
        token_id: token_id.clone(),
        price_eth,
        marketplace: marketplace.clone(),
        expiry_hours,
    };
    // Envelope scope reuses the same allowlist semantics `transfer_nft`
    // established: `to` is the real-world target this action concerns, here
    // the NFT's own contract — the envelope must explicitly permit acting on
    // it, exactly like it must permit a transfer recipient.
    let authorization = authorize_marketplace_action(
        &envelope_engine,
        &autonomy_engine,
        &wallet_address,
        &contract_address,
        autonomy::types::ActionType::MarketplaceList,
        Some(contract_address.clone()),
        marketplace::seaport::eth_to_wei(price_eth),
        payload,
    )
    .await?;
    let tx_req_envelope = match authorization {
        MarketplaceAuthorization::Queued { proposal_id, reason } => {
            return Ok(marketplace::MarketplaceActionOutcome::PendingApproval { proposal_id, reason });
        }
        MarketplaceAuthorization::Proceed(tx_req_envelope) => tx_req_envelope,
    };

    let input = marketplace::ListingInput { wallet_address, contract_address, token_id, price_eth, marketplace: mp, expiry_hours };
    let result = marketplace::list_nft(&input, &api_key, &opensea_key).await;
    if result.is_err() {
        envelope_engine.rollback_authorization(&tx_req_envelope);
    }
    result.map(|result| marketplace::MarketplaceActionOutcome::Completed { result })
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
    envelope_engine: tauri::State<'_, Arc<EnvelopeEngine>>,
    autonomy_engine: tauri::State<'_, Arc<AutonomyEngine>>,
) -> Result<marketplace::MarketplaceActionOutcome, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = parse_marketplace_name(&marketplace);

    let payload = autonomy::pending::PendingActionPayload::MarketplaceBid {
        contract_address: contract_address.clone(),
        price_eth,
        quantity,
        marketplace: marketplace.clone(),
        expiry_hours,
    };
    let authorization = authorize_marketplace_action(
        &envelope_engine,
        &autonomy_engine,
        &wallet_address,
        &contract_address,
        autonomy::types::ActionType::MarketplaceBidOrOffer,
        Some(contract_address.clone()),
        marketplace::seaport::eth_to_wei(price_eth),
        payload,
    )
    .await?;
    let tx_req_envelope = match authorization {
        MarketplaceAuthorization::Queued { proposal_id, reason } => {
            return Ok(marketplace::MarketplaceActionOutcome::PendingApproval { proposal_id, reason });
        }
        MarketplaceAuthorization::Proceed(tx_req_envelope) => tx_req_envelope,
    };

    let input = marketplace::BidInput { wallet_address, contract_address, price_eth, quantity, marketplace: mp, expiry_hours };
    let result = marketplace::place_bid(&input, &api_key, &opensea_key).await;
    if result.is_err() {
        envelope_engine.rollback_authorization(&tx_req_envelope);
    }
    result.map(|result| marketplace::MarketplaceActionOutcome::Completed { result })
}

#[tauri::command]
async fn marketplace_cancel_order(
    order_hash: String,
    wallet_address: String,
    marketplace: String,
    api_key: String,
    envelope_engine: tauri::State<'_, Arc<EnvelopeEngine>>,
    autonomy_engine: tauri::State<'_, Arc<AutonomyEngine>>,
) -> Result<marketplace::MarketplaceActionOutcome, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings"))?;
    let mp = parse_marketplace_name(&marketplace);

    let payload = autonomy::pending::PendingActionPayload::MarketplaceCancel {
        order_hash: order_hash.clone(),
        marketplace: marketplace.clone(),
    };
    // A cancel has no contract/recipient of its own — `CancelInput` carries
    // only an order hash. There is no natural "to" for the envelope's scope
    // check here, so this uses the wallet's own address: the envelope must
    // have that wallet in scope for any cancel to go through. This is a
    // deliberate repurposing of a scope list that was designed for transfer
    // recipients, not a perfect semantic fit — flagged explicitly rather
    // than silently reusing it as if it were obviously correct.
    let authorization = authorize_marketplace_action(
        &envelope_engine,
        &autonomy_engine,
        &wallet_address,
        &wallet_address,
        autonomy::types::ActionType::MarketplaceCancel,
        None,
        0,
        payload,
    )
    .await?;
    let tx_req_envelope = match authorization {
        MarketplaceAuthorization::Queued { proposal_id, reason } => {
            return Ok(marketplace::MarketplaceActionOutcome::PendingApproval { proposal_id, reason });
        }
        MarketplaceAuthorization::Proceed(tx_req_envelope) => tx_req_envelope,
    };

    let input = marketplace::CancelInput { order_hash, wallet_address, marketplace: mp };
    let result = marketplace::cancel_order(&input, &api_key, &opensea_key).await;
    if result.is_err() {
        envelope_engine.rollback_authorization(&tx_req_envelope);
    }
    result.map(|result| marketplace::MarketplaceActionOutcome::Completed { result })
}

// ── Wallet autonomy policy commands ─────────────────────────────────────────
//
// Phase (d): the minimal command layer that lets the policy engine and
// hash-chained audit log built in earlier phases actually be configured and
// inspected from the frontend. Every mutation here validates and persists
// in Rust (`autonomy::store::save`) before it ever reports success, and
// every mutation also updates the resident `AutonomyEngine` so the change
// takes effect immediately — a policy edit that only touched disk and left
// the signing paths still running the old in-memory policy would be worse
// than no UI at all.
//
// `list_pending_action_proposals` / `approve_action_proposal` /
// `reject_action_proposal` close the loop `signing::authorize_or_queue`
// opened: a `RequiresApproval` decision now persists an
// `autonomy::pending::PendingActionProposal` instead of just erroring out.
// Two design decisions worth stating explicitly, since they are not visible
// from the command signatures alone:
//
// 1. Approving does not re-run the autonomy policy and check for `Allow`.
//    It cannot: Manual/Assisted mode always returns `RequiresApproval`, and
//    Autonomous mode never turns a hard-banned action type into `Allow` (see
//    `engine.rs`) — re-checking the policy would deterministically produce
//    `RequiresApproval` again, forever. The human clicking "approve" *is*
//    the authorization for this one proposal; there is no rule to match, so
//    approving never touches any `AutonomyRule`'s budget/rate-limit counter.
//    What IS re-checked at approval time: the kill switch and the wallet's
//    policy `enabled` flag, because either could have changed in the time
//    between queuing and approval, and an approval must never bypass a kill
//    switch or pause activated after the proposal was queued.
// 2. Approving re-runs the envelope's own `check_and_authorize` fresh, at
//    approval time — the original call already rolled its reservation back
//    when it queued instead of executing (see `authorize_or_queue`'s doc
//    comment), so nothing is reserved until approval actually happens. This
//    also means nonce and gas price are read live by `LocalSigner`/
//    `marketplace::*` exactly as they would be for an immediate send —
//    `PendingActionPayload` deliberately never stores either, so an approval
//    landing hours after the proposal was queued can never broadcast against
//    a stale nonce or gas price.

/// A wallet address must parse as a real EVM address before it is ever
/// handed to `store::save` / `AutonomyEngine::set_wallet_policy` — an
/// invalid address would otherwise silently become a policy file no lookup
/// could ever find again correctly.
fn validate_wallet_policy(policy: &autonomy::types::WalletPolicy) -> Result<(), String> {
    policy
        .wallet_address
        .parse::<alloy::primitives::Address>()
        .map_err(|_| format!("Invalid wallet address: {}", policy.wallet_address))?;
    // v1 is Ethereum mainnet only. `AutonomyEngine::evaluate` already refuses
    // any other chain unconditionally; rejecting it here too means a bad
    // policy is never even persisted, instead of being saved and then
    // silently doing nothing whenever it's consulted.
    if policy.chain_id != 1 {
        return Err(format!(
            "Unsupported chain_id {} — this build only supports Ethereum mainnet (1).",
            policy.chain_id
        ));
    }
    Ok(())
}

/// Diff `before` → `after` and append one audit record per thing that
/// actually changed, instead of one opaque "policy replaced" record — so a
/// viewer of `list_autonomy_audit` can see exactly what a mutation changed.
/// Best-effort: an audit write failure is logged, never allowed to fail the
/// policy write itself (mirrors `signing::authorize_via_autonomy`'s own
/// audit-write tradeoff).
fn audit_policy_diff(
    wallet_address: &str,
    before: &autonomy::types::WalletPolicy,
    after: &autonomy::types::WalletPolicy,
    now: i64,
) {
    use autonomy::audit::{append, AuditRecordKind, PolicyChangeKind};

    let mut log_change = |kind: PolicyChangeKind| {
        if let Err(e) = append(wallet_address, AuditRecordKind::PolicyChanged { change: kind }, now) {
            log::error!(
                "could not append autonomy policy-change audit record for {wallet_address}: {e}"
            );
        }
    };

    if before.mode != after.mode {
        log_change(PolicyChangeKind::ModeChanged { from: before.mode, to: after.mode });
    }
    if before.enabled != after.enabled {
        log_change(if after.enabled { PolicyChangeKind::Enabled } else { PolicyChangeKind::Disabled });
    }
    for idx in 0..after.rules.len().max(before.rules.len()) {
        match (before.rules.get(idx), after.rules.get(idx)) {
            (None, Some(_)) => log_change(PolicyChangeKind::RuleCreated { rule_index: idx }),
            (Some(_), None) => log_change(PolicyChangeKind::RuleDeleted { rule_index: idx }),
            (Some(b), Some(a)) if b != a => log_change(PolicyChangeKind::RuleUpdated { rule_index: idx }),
            _ => {}
        }
    }
}

#[tauri::command]
fn get_wallet_policy(wallet_address: String) -> autonomy::types::WalletPolicy {
    autonomy::store::load_or_default(&wallet_address)
}

#[tauri::command]
fn list_wallet_policies() -> Result<Vec<autonomy::types::WalletPolicy>, String> {
    autonomy::store::list_all()
}

#[tauri::command]
fn create_or_update_wallet_policy(
    mut policy: autonomy::types::WalletPolicy,
    autonomy_engine: tauri::State<Arc<AutonomyEngine>>,
) -> Result<autonomy::types::WalletPolicy, String> {
    validate_wallet_policy(&policy)?;
    policy.wallet_address = policy.wallet_address.to_lowercase();

    let before = autonomy::store::load_or_default(&policy.wallet_address);
    autonomy::store::save(&policy)?;
    autonomy_engine.set_wallet_policy(policy.clone());

    let now = chrono::Utc::now().timestamp();
    audit_policy_diff(&policy.wallet_address, &before, &policy, now);

    Ok(policy)
}

/// Load-mutate-save-resync, shared by every small policy mutation below so
/// each one is a one-line closure instead of a fourth copy of
/// "load, snapshot, save, push into the engine, diff for audit."
fn apply_policy_update(
    wallet_address: &str,
    autonomy_engine: &AutonomyEngine,
    mutate: impl FnOnce(&mut autonomy::types::WalletPolicy),
) -> Result<autonomy::types::WalletPolicy, String> {
    let mut policy = autonomy::store::load_or_default(wallet_address);
    let before = policy.clone();
    mutate(&mut policy);
    autonomy::store::save(&policy)?;
    autonomy_engine.set_wallet_policy(policy.clone());

    let now = chrono::Utc::now().timestamp();
    audit_policy_diff(wallet_address, &before, &policy, now);

    Ok(policy)
}

#[tauri::command]
fn set_wallet_autonomy_mode(
    wallet_address: String,
    mode: autonomy::types::AutonomyMode,
    autonomy_engine: tauri::State<Arc<AutonomyEngine>>,
) -> Result<autonomy::types::WalletPolicy, String> {
    apply_policy_update(&wallet_address, &autonomy_engine, |p| p.mode = mode)
}

#[tauri::command]
fn set_wallet_policy_enabled(
    wallet_address: String,
    enabled: bool,
    autonomy_engine: tauri::State<Arc<AutonomyEngine>>,
) -> Result<autonomy::types::WalletPolicy, String> {
    apply_policy_update(&wallet_address, &autonomy_engine, |p| p.enabled = enabled)
}

/// Wallet-scoped pause: disables this wallet's autonomy policy so every
/// action for it routes to manual approval (or deny, if it wasn't even in
/// autonomous mode) regardless of what its rules say. Distinct from — and
/// does not touch — the existing global kill switch (`activate_kill_switch`
/// / `EnvelopeEngine`), which already stops every wallet's envelope-guarded
/// signing outright. This does not duplicate that: it reuses the
/// already-wired, already-tested per-policy `enabled` gate
/// (`AutonomyEngine::evaluate` step 2) instead of inventing a second "stop
/// everything" concept the engine would also have to learn about.
#[tauri::command]
fn pause_wallet_autonomy(
    wallet_address: String,
    autonomy_engine: tauri::State<Arc<AutonomyEngine>>,
) -> Result<autonomy::types::WalletPolicy, String> {
    apply_policy_update(&wallet_address, &autonomy_engine, |p| p.enabled = false)
}

/// Side-effect-free: runs the exact same guard chain a real
/// `send_eth`/`transfer_nft`/marketplace call would, via
/// `AutonomyEngine::preview_proposal`, and reports the verdict without
/// touching any budget/rate-limit counter or writing an audit record — a
/// "what would happen" check the frontend can call as often as it likes
/// before a user commits to anything.
#[tauri::command]
fn evaluate_action_proposal(
    proposal: autonomy::types::ActionProposal,
    envelope_engine: tauri::State<Arc<EnvelopeEngine>>,
    autonomy_engine: tauri::State<Arc<AutonomyEngine>>,
) -> autonomy::types::AutonomyDecision {
    autonomy_engine.ensure_policy_loaded(&proposal.wallet_address);
    let kill_switch_active = envelope_engine.get_status().map(|s| s.kill_switch).unwrap_or(false);
    let now = chrono::Utc::now().timestamp();
    autonomy_engine.preview_proposal(&proposal, kill_switch_active, /* watch_only */ false, now)
}

#[tauri::command]
fn list_autonomy_audit(wallet_address: String) -> Result<autonomy::audit::AuditLogView, String> {
    autonomy::audit::wallet_audit_view(&wallet_address)
}

// ── Pending action proposals (approve/reject a queued `RequiresApproval`) ──
//
// Two design decisions worth stating explicitly, since neither is visible
// just from reading the individual functions below:
//
// 1. Approval never re-runs `AutonomyEngine::evaluate` looking for `Allow`.
//    It structurally cannot: Manual/Assisted mode always returns
//    `RequiresApproval`, and Autonomous mode only ever lets `Mint` reach
//    `Allow` — every proposal that reaches this module got here precisely
//    because the engine will say `RequiresApproval` again, forever, no
//    matter how many times it is asked. A human's click on "approve" *is*
//    the authorization here — a separate, out-of-band act, not a second
//    attempt at the same deterministic decision. What approval *does* still
//    re-check is whatever could have legitimately changed since the
//    proposal was queued: the global kill switch, and this wallet's policy
//    `enabled` flag (`pause_wallet_autonomy` may have fired after the
//    proposal was created).
// 2. Approval re-runs the envelope's `check_and_authorize` fresh, exactly
//    like the original call did — the original reservation was rolled back
//    the moment the action was queued (see `authorize_or_queue` and
//    `authorize_marketplace_action`), so nothing is double-spent, but the
//    spend cap must still hold at approval time, which may be hours later.
//    Nonce and gas are never stored in the pending payload at all (see
//    `PendingActionPayload`'s doc comment) — they are always read live by
//    the same signing code an immediate send already uses.

#[tauri::command]
fn list_pending_action_proposals(
    wallet_address: String,
) -> Result<Vec<autonomy::pending::PendingActionProposal>, String> {
    autonomy::pending::list(&wallet_address)
}

#[tauri::command]
fn reject_action_proposal(
    id: String,
) -> Result<autonomy::pending::PendingActionProposal, String> {
    let now = chrono::Utc::now().timestamp();
    let resolved = autonomy::pending::resolve(&id, autonomy::pending::PendingStatus::Rejected, now)?;
    if let Err(e) = autonomy::audit::append(
        &resolved.wallet_address,
        autonomy::audit::AuditRecordKind::Denied {
            reason: format!("proposal {id} rejected by user: {}", resolved.reason),
        },
        now,
    ) {
        log::error!("could not append rejection audit record for {}: {e}", resolved.wallet_address);
    }
    Ok(resolved)
}

/// Actually perform the action a pending proposal describes, dispatching on
/// its payload variant. Reused by nothing else — this is the one place an
/// approved proposal's stored data turns into a real signed/broadcast
/// action or a real marketplace order, always by calling the exact same
/// lower-level functions (`LocalSigner::sign_and_send`,
/// `signing::build_and_send_nft_transfer`, `marketplace::list_nft` /
/// `place_bid` / `cancel_order`) the immediate (non-queued) commands above
/// call, so an approved action is built through the identical code path an
/// immediate one would have used — never a second, hand-rolled copy.
///
/// Credentials are fetched fresh from the Keychain here rather than taken
/// from the frontend caller (unlike the immediate commands, which receive
/// `api_key` as a parameter): approval only ever carries an `id`, so there
/// is no frontend-supplied key to forward.
async fn execute_pending_payload(
    wallet_address: &str,
    payload: &autonomy::pending::PendingActionPayload,
) -> Result<autonomy::pending::ApprovalResult, String> {
    use autonomy::pending::{ApprovalResult, PendingActionPayload};

    let alchemy_key = wallet::keychain::fetch_alchemy_key().map_err(|e| {
        format!("Could not read Alchemy key (Keychain error: {e}) — try saving again in Settings")
    })?;

    match payload {
        PendingActionPayload::SendEth { to, value_wei } => {
            let request = signing::TxRequest {
                to: to.clone(),
                value_wei: value_wei.clone(),
                data: None,
                gas_limit: None,
            };
            signing::LocalSigner::sign_and_send(wallet_address, request, &alchemy_key)
                .await
                .map(|tx_hash| ApprovalResult::TxSent { tx_hash })
        }
        PendingActionPayload::TransferNft { contract_address, token_id, to, token_standard, amount } => {
            signing::build_and_send_nft_transfer(
                wallet_address,
                contract_address,
                token_id,
                to,
                *token_standard,
                amount.as_deref(),
                &alchemy_key,
            )
            .await
            .map(|tx_hash| ApprovalResult::TxSent { tx_hash })
        }
        PendingActionPayload::MarketplaceList { contract_address, token_id, price_eth, marketplace, expiry_hours } => {
            let opensea_key = wallet::keychain::fetch_opensea_key().map_err(|e| {
                format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings")
            })?;
            let input = marketplace::ListingInput {
                wallet_address: wallet_address.to_string(),
                contract_address: contract_address.clone(),
                token_id: token_id.clone(),
                price_eth: *price_eth,
                marketplace: parse_marketplace_name(marketplace),
                expiry_hours: *expiry_hours,
            };
            marketplace::list_nft(&input, &alchemy_key, &opensea_key)
                .await
                .map(|result| ApprovalResult::OrderCompleted { result })
        }
        PendingActionPayload::MarketplaceBid { contract_address, price_eth, quantity, marketplace, expiry_hours } => {
            let opensea_key = wallet::keychain::fetch_opensea_key().map_err(|e| {
                format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings")
            })?;
            let input = marketplace::BidInput {
                wallet_address: wallet_address.to_string(),
                contract_address: contract_address.clone(),
                price_eth: *price_eth,
                quantity: *quantity,
                marketplace: parse_marketplace_name(marketplace),
                expiry_hours: *expiry_hours,
            };
            marketplace::place_bid(&input, &alchemy_key, &opensea_key)
                .await
                .map(|result| ApprovalResult::OrderCompleted { result })
        }
        PendingActionPayload::MarketplaceCancel { order_hash, marketplace } => {
            let opensea_key = wallet::keychain::fetch_opensea_key().map_err(|e| {
                format!("Could not read OpenSea key (Keychain error: {e}) — try saving again in Settings")
            })?;
            let input = marketplace::CancelInput {
                order_hash: order_hash.clone(),
                wallet_address: wallet_address.to_string(),
                marketplace: parse_marketplace_name(marketplace),
            };
            marketplace::cancel_order(&input, &alchemy_key, &opensea_key)
                .await
                .map(|result| ApprovalResult::OrderCompleted { result })
        }
    }
}

// ── Atomic claim for `approve_action_proposal` ──────────────────────────
//
// Bug this closes: the file-backed `PendingStatus` only moves from
// `Pending` to `Approved` *after* `execute_pending_payload` returns —
// deliberately, so a transient execution failure leaves the proposal
// retryable (see the doc comment on `approve_action_proposal_in` below).
// That means two concurrent calls for the same `id` (double-click, a
// retried IPC call after a slow response) both pass the `effective_status
// == Pending` check before either one calls `resolve`, so both go on to
// sign/broadcast or place an order — a real double-send or double-submit.
//
// Fix: an in-memory set of proposal ids currently "in flight", guarded by a
// `Mutex` and claimed (insert-if-absent) before anything else happens. This
// is process-local state, which is sufficient here — Westron is a
// single-process desktop app, so there is only ever one such set, and it
// does not need to survive a restart (a proposal that was mid-approval when
// the app was killed is not "in flight" anymore; nothing is running to
// finish it).
fn approval_in_flight() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static IN_FLIGHT: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    IN_FLIGHT.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// Holds `id`'s claim until dropped. Every return path out of
/// `approve_action_proposal_in` — success, an early `?`, an explicit early
/// `return Err` — drops this and frees the id for a future retry. This is
/// what turns "preserve existing retry semantics" from the doc comment
/// below into something actually true after a failed approval: the pending
/// proposal itself is unchanged (still `Pending` on disk), and now nothing
/// in memory blocks approving it again either.
struct ApprovalClaim(String);

impl Drop for ApprovalClaim {
    fn drop(&mut self) {
        if let Ok(mut set) = approval_in_flight().lock() {
            set.remove(&self.0);
        }
    }
}

/// Claim exclusive execution rights for `id`. `Err` — without touching the
/// pending-proposal file, the envelope, or anything else — if some other
/// in-flight call already holds this exact id's claim.
fn claim_for_approval(id: &str) -> Result<ApprovalClaim, String> {
    let mut set = approval_in_flight()
        .lock()
        .map_err(|_| "internal error: approval claim lock was poisoned".to_string())?;
    if !set.insert(id.to_string()) {
        return Err(format!(
            "Pending action proposal {id} is already being approved by another request"
        ));
    }
    Ok(ApprovalClaim(id.to_string()))
}

/// Approve a queued `RequiresApproval` proposal: re-check what could have
/// changed since it was queued (kill switch, this wallet's policy
/// `enabled` flag), re-authorize fresh against the envelope, then actually
/// perform the action.
///
/// On execution failure, the envelope reservation taken here is rolled
/// back and the proposal is deliberately left `Pending` rather than marked
/// `Approved` — a transient failure (RPC hiccup, momentarily stale gas
/// estimate) should be retryable by approving again, not a dead end that
/// silently drops the user's request. Only a genuine execution success
/// resolves the proposal to `Approved`.
///
/// `dir` is the pending-proposal store's directory — injected so tests can
/// point it at an isolated tmp dir instead of the real app-data location,
/// same convention every other `_in` function in `autonomy::` already uses.
/// The command wrapper below always passes the real directory.
async fn approve_action_proposal_in(
    dir: &std::path::Path,
    id: &str,
    envelope_engine: &EnvelopeEngine,
) -> Result<autonomy::pending::ApprovalResult, String> {
    use autonomy::pending::PendingStatus;

    // Claim first, before anything else — including the `Pending` check
    // below. That check reads a file whose write only happens at the very
    // end of this function, so by itself it cannot serialize two concurrent
    // calls; this claim is what actually does.
    let _claim = claim_for_approval(id)?;

    let now = chrono::Utc::now().timestamp();

    let found = autonomy::pending::find_by_id_in(dir, id)?
        .ok_or_else(|| format!("No pending action proposal found with id {id}"))?;
    let effective = found.effective_status(now);
    if effective != PendingStatus::Pending {
        return Err(format!(
            "Pending action proposal {id} is {effective:?} and cannot be approved"
        ));
    }

    if envelope_engine.get_status().map(|s| s.kill_switch).unwrap_or(false) {
        return Err("Cannot approve: the kill switch is active.".to_string());
    }
    let current_policy = autonomy::store::load_or_default(&found.wallet_address);
    if !current_policy.enabled {
        return Err(
            "Cannot approve: this wallet's autonomy policy is currently disabled or paused."
                .to_string(),
        );
    }

    let tx_req_envelope = envelope::types::TransactionRequest {
        to: found
            .proposal
            .target_contract
            .clone()
            .unwrap_or_else(|| found.wallet_address.clone()),
        value_wei: found.proposal.value_wei,
        calldata: String::new(),
    };
    envelope_engine
        .check_and_authorize(&tx_req_envelope)
        .map_err(|e| format!("Envelope rejected: {e:?}"))?;

    let execution = execute_pending_payload(&found.wallet_address, &found.payload).await;
    let execution = match execution {
        Ok(result) => result,
        Err(e) => {
            envelope_engine.rollback_authorization(&tx_req_envelope);
            return Err(e);
        }
    };

    // Execution succeeded — resolve the proposal and audit it. Both are
    // best-effort from here on: the real send/order already went through
    // and cannot be undone, so a bookkeeping failure at this point must
    // never be reported back as an error (that would falsely tell the user
    // their action failed when money has already moved or an order is
    // already live). Failures are logged loudly instead of swallowed.
    if let Err(e) = autonomy::pending::resolve_in(dir, id, PendingStatus::Approved, now) {
        log::error!(
            "action for proposal {id} executed successfully but could not be marked Approved: {e}"
        );
    }
    if let Err(e) = autonomy::audit::append(
        &found.wallet_address,
        autonomy::audit::AuditRecordKind::Approved { note: Some(format!("proposal {id}")) },
        now,
    ) {
        log::error!("could not append approval audit record for {}: {e}", found.wallet_address);
    }

    Ok(execution)
}

#[tauri::command]
async fn approve_action_proposal(
    id: String,
    envelope_engine: tauri::State<'_, Arc<EnvelopeEngine>>,
) -> Result<autonomy::pending::ApprovalResult, String> {
    let dir = autonomy::pending::default_dir()?;
    approve_action_proposal_in(&dir, &id, &envelope_engine).await
}

#[cfg(test)]
mod approve_action_proposal_tests {
    use super::*;
    use autonomy::pending::{self, PendingActionPayload, PendingActionProposal, PendingStatus};
    use autonomy::types::{ActionProposal, ActionType};
    use std::sync::Barrier;

    fn tmp_pending_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("westron-approve-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const WALLET: &str = "0x000000000000000000000000000000000000dead";

    fn sample_proposal(id: &str) -> PendingActionProposal {
        PendingActionProposal {
            id: id.to_string(),
            wallet_address: WALLET.to_string(),
            proposal: ActionProposal {
                action_type: ActionType::TransferNative,
                wallet_address: WALLET.to_string(),
                target_contract: Some("0x00000000000000000000000000000000000beef".to_string()),
                calldata: None,
                value_wei: 1_000_000_000_000_000_000,
                chain_id: 1,
            },
            reason: "manual mode always requires approval".to_string(),
            payload: PendingActionPayload::SendEth {
                to: "0x00000000000000000000000000000000000beef".to_string(),
                value_wei: "1000000000000000000".to_string(),
            },
            created_at: chrono::Utc::now().timestamp(),
            status: PendingStatus::Pending,
        }
    }

    /// The primitive itself: two threads racing to claim the same id — only
    /// one wins, the other is rejected with a clear reason, and once the
    /// winner's guard is dropped the id becomes claimable again (retry
    /// semantics preserved). This is the exact mechanism that closes
    /// CRITICAL #2 (double-execution of the same pending approval).
    #[test]
    fn claim_for_approval_lets_only_one_of_two_concurrent_claimants_through() {
        let id = format!("claim-race-{}", uuid::Uuid::new_v4());
        let barrier = Arc::new(Barrier::new(2));

        let (id_a, barrier_a) = (id.clone(), barrier.clone());
        let handle_a = std::thread::spawn(move || {
            barrier_a.wait();
            claim_for_approval(&id_a)
        });

        let (id_b, barrier_b) = (id.clone(), barrier.clone());
        let handle_b = std::thread::spawn(move || {
            barrier_b.wait();
            claim_for_approval(&id_b)
        });

        let result_a = handle_a.join().unwrap();
        let result_b = handle_b.join().unwrap();

        let ok_count = [&result_a, &result_b].iter().filter(|r| r.is_ok()).count();
        assert_eq!(ok_count, 1, "exactly one of two concurrent claims must succeed");
        let err = result_a
            .as_ref()
            .err()
            .or(result_b.as_ref().err())
            .expect("the losing claim must be an Err");
        assert!(err.contains("already being approved"), "got: {err}");

        // Drop both results (releasing whichever guard was held) before
        // asserting the id is claimable again.
        drop(result_a);
        drop(result_b);
        assert!(
            claim_for_approval(&id).is_ok(),
            "id must be claimable again once the previous claim was released"
        );
    }

    /// Wired into the real command: two concurrent approvals of the same
    /// pending proposal id. Only one may ever get past the claim to reach
    /// the proposal's business logic (kill switch / policy / envelope /
    /// execution) — the other must be rejected by the claim itself, before
    /// touching the pending-proposal file, the envelope, or anything else.
    /// This is the exact double-send / double-submit bug CRITICAL #2
    /// describes: before this fix, both calls reached `execute_pending_payload`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn rejects_second_concurrent_approval_reusing_the_same_proposal_id() {
        let dir = tmp_pending_dir("concurrent-approve");
        let id = format!("prop-{}", uuid::Uuid::new_v4());
        pending::add_in(&dir, sample_proposal(&id)).unwrap();

        let engine = Arc::new(EnvelopeEngine::new());
        let barrier = Arc::new(Barrier::new(2));

        let (dir_a, id_a, engine_a, barrier_a) = (dir.clone(), id.clone(), engine.clone(), barrier.clone());
        let task_a = tokio::spawn(async move {
            barrier_a.wait();
            approve_action_proposal_in(&dir_a, &id_a, &engine_a).await
        });

        let (dir_b, id_b, engine_b, barrier_b) = (dir.clone(), id.clone(), engine.clone(), barrier.clone());
        let task_b = tokio::spawn(async move {
            barrier_b.wait();
            approve_action_proposal_in(&dir_b, &id_b, &engine_b).await
        });

        let result_a = task_a.await.unwrap();
        let result_b = task_b.await.unwrap();

        let errors: Vec<String> = [&result_a, &result_b]
            .iter()
            .filter_map(|r| r.as_ref().err().cloned())
            .collect();

        // This test wallet has no autonomy policy configured, so whichever
        // call wins the claim still fails — just for a *different* reason
        // (policy disabled), proving it actually reached real business
        // logic rather than also being rejected by the claim.
        assert_eq!(errors.len(), 2, "both calls should fail in this test, got: {errors:?}");
        let claim_rejections =
            errors.iter().filter(|e| e.contains("already being approved")).count();
        assert_eq!(
            claim_rejections, 1,
            "exactly one of the two concurrent calls must be rejected by the claim, got: {errors:?}"
        );
        let other_error = errors
            .iter()
            .find(|e| !e.contains("already being approved"))
            .expect("the call that passed the claim must fail for a different reason");
        assert!(
            other_error.contains("disabled or paused"),
            "the call that passed the claim should fail on the disabled-policy check, got: {other_error}"
        );

        std::fs::remove_dir_all(&dir).ok();
    }
}

// ── Marketplace metadata commands ───────────────────────────────────────────

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

#[tauri::command]
async fn fetch_nft_detail(contract_address: String, token_id: String) -> Result<marketplace::NftDetail, String> {
    let opensea_key = wallet::keychain::fetch_opensea_key()
        .map_err(|e| format!("Could not read OpenSea key: {e}"))?;
    if opensea_key.is_empty() {
        return Err("OpenSea API key not set".to_string());
    }
    let client = marketplace::client::MarketplaceClient::new("", &opensea_key);
    client.fetch_nft_detail(&contract_address, &token_id).await
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
  // Persisted: spend cap, accumulated spend and kill switch all survive a
  // restart. An expired envelope is not restored as active.
  let engine = Arc::new(EnvelopeEngine::load_or_new());
  // In-memory only: no disk-backed `load_or_new` counterpart exists for
  // autonomy policies. Each wallet's policy is populated lazily on first use
  // (`AutonomyEngine::ensure_policy_loaded`, called from the signing entry
  // points) via `autonomy::store::load_or_default`, mirroring the envelope
  // engine's persistence without inventing a second bootstrapping path.
  let autonomy_engine = Arc::new(AutonomyEngine::new());
  let stream_manager = Arc::new(stream::StreamManager::new());
  // Realtime manager is built lazily by `realtime_init` — store an empty slot
  // so the Tauri command handler can fill it in once we have the API key.
  let realtime_slot: std::sync::Mutex<Option<Arc<data::realtime::RealtimeManager>>> =
      std::sync::Mutex::new(None);

  // Clone for the control server / scheduler, which are started from `setup`
  // (the first point where an `AppHandle` exists for event emission).
  let control_engine = engine.clone();

  tauri::Builder::default()
    .manage(engine)
    .manage(autonomy_engine)
    .manage(stream_manager)
    .manage(realtime_slot)
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Loopback control server (Bearer-token auth) + snipe scheduler loop.
      // Both share the live EnvelopeEngine so the kill switch means the same
      // thing from the UI, from Claude, and inside the loop.
      let scheduler = control::start(control_engine.clone(), app.handle().clone());
      app.manage(scheduler);
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        get_app_version,
        create_envelope,
        revoke_envelope,
        check_transaction,
        preview_transaction,
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
        get_keychain_status,
        save_opensea_key,
        load_opensea_key,
        delete_opensea_key_cmd,
        save_etherscan_key,
        load_etherscan_key,
        delete_etherscan_key_cmd,
        find_sister_wallets,
        backfill_nft_cost_basis,
        get_nft_pnl,
        set_nft_cost_basis,
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
        signing::transfer_nft,
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
        get_wallet_policy,
        list_wallet_policies,
        create_or_update_wallet_policy,
        set_wallet_autonomy_mode,
        set_wallet_policy_enabled,
        pause_wallet_autonomy,
        evaluate_action_proposal,
        list_autonomy_audit,
        list_pending_action_proposals,
        approve_action_proposal,
        reject_action_proposal,
        fetch_collection_nfts,
        fetch_nfts_by_collection,
        fetch_collection_by_contract,
        fetch_collection_stats,
        fetch_collection_events,
        fetch_collection_holders,
        fetch_collection_offers,
        fetch_collection_traits,
        fetch_nft_detail,
        open_external_url,
        check_subscription,
        subscription_signup,
        subscription_login,
        subscription_logout,
        subscription_current_account,
        start_stream,
        stop_stream,
        get_stream_status,
        get_token_prices_by_symbol,
        get_token_prices_by_address,
        get_wallet_portfolio,
        get_wallet_tokens,
        get_collection_metadata,
        get_nft_sales,
        realtime_init,
        realtime_set_watch_set,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
