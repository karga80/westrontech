use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use crate::rpc::{client::AlchemyClient, types::AssetTransfer};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PnlSummary {
    pub wallet_address: String,
    pub realized_pnl_eth: f64,
    pub unrealized_pnl_eth: f64,
    pub total_buy_volume_eth: f64,
    pub total_sell_volume_eth: f64,
    pub gas_spent_eth: f64,     // always 0.0 — Alchemy transfers API does not return gas
    pub trade_count: u32,
    pub win_count: u32,
    pub loss_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TradeRecord {
    pub contract_address: String,
    pub token_id: String,
    pub buy_price_eth: f64,
    pub sell_price_eth: Option<f64>,
    pub pnl_eth: Option<f64>,
    pub buy_tx_hash: String,
    pub sell_tx_hash: Option<String>,
    pub buy_timestamp: String,
    pub sell_timestamp: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortfolioSnapshot {
    pub eth_balance: f64,
    pub eth_price_usd: f64,
    pub portfolio_value_usd: f64,
    pub token_count: u32,
    pub nft_count: u32,
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Composite key for grouping transfers: lowercase contract address + token_id
fn nft_key(contract: &str, token_id: &str) -> String {
    format!("{}:{}", contract.to_lowercase(), token_id)
}

fn transfer_timestamp(t: &AssetTransfer) -> String {
    t.metadata
        .as_ref()
        .and_then(|m| m.block_timestamp.clone())
        .unwrap_or_else(|| t.block_num.clone())
}

/// Derive contract address from an ERC-721/1155 transfer.
/// Alchemy returns the contract address in `to` for mint-style transfers, but
/// `rawContract.address` is the authoritative field. Since `AssetTransfer`
/// does not carry rawContract, we fall back to the `asset` field (collection
/// name/symbol — not an address) or leave blank. The caller must supply the
/// contract address via a separate channel when available.
///
/// In practice the PnL engine pairs incoming transfers (wallet is `to`) with
/// outgoing transfers (wallet is `from`). For ERC-721/1155 transfers the
/// Alchemy API returns `tokenId` at the top level. We normalise the contract
/// address from the `from` / `to` fields: for outgoing NFT transfers `to` is
/// the contract or buyer, but the contract address must be resolved from
/// `rawContract`. Because we cannot resolve it in this struct, we use a
/// placeholder strategy and group by token_id only when the caller supplies
/// the address via a separate lookup.
///
/// For the purposes of this engine we use the `asset` field (which for NFTs
/// contains the collection name/symbol) plus token_id as a best-effort key
/// and expose the raw `from`/`to` addresses. The UI can enrich with contract
/// address later.
///
/// NOTE: A production implementation should include `rawContract.address` in
/// `AssetTransfer`. This engine is designed to be upgraded once that field is
/// added.
fn extract_nft_transfers(
    transfers: &[AssetTransfer],
) -> Vec<&AssetTransfer> {
    transfers.iter().filter(|t| {
        t.category == "erc721" || t.category == "erc1155"
    }).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Core computation
// ─────────────────────────────────────────────────────────────────────────────

/// Build trade records by matching incoming (buy) and outgoing (sell) NFT
/// transfers keyed on (contract_address, token_id).
///
/// Strategy:
/// - incoming transfers where wallet == `to`  → "buy" events
/// - outgoing transfers where wallet == `from` → "sell" events
/// - Match by (asset_key, token_id). asset_key is the `asset` field (symbol)
///   which is an imperfect proxy; a raw contract address would be better.
///
/// For each matched pair we compute realized PnL.
/// Unmatched buys produce TradeRecords with sell_price_eth = None (unrealized).
pub fn compute_trades(
    wallet: &str,
    incoming: &[AssetTransfer],
    outgoing: &[AssetTransfer],
) -> Vec<TradeRecord> {
    let wallet_lc = wallet.to_lowercase();

    // Filter to NFT-only transfers
    let buys: Vec<&AssetTransfer> = extract_nft_transfers(incoming)
        .into_iter()
        .filter(|t| t.to.as_deref().map(|a| a.to_lowercase()) == Some(wallet_lc.clone()))
        .collect();

    let sells: Vec<&AssetTransfer> = extract_nft_transfers(outgoing)
        .into_iter()
        .filter(|t| t.from.to_lowercase() == wallet_lc)
        .collect();

    // Index sells by (asset, token_id) → first available sell
    // Using a Vec per key to handle multiple sells of the same token (e.g. ERC1155)
    let mut sell_map: HashMap<String, Vec<&AssetTransfer>> = HashMap::new();
    for sell in &sells {
        let key = nft_key(
            sell.asset.as_deref().unwrap_or("unknown"),
            sell.token_id.as_deref().unwrap_or(""),
        );
        sell_map.entry(key).or_default().push(sell);
    }

    let mut records: Vec<TradeRecord> = Vec::new();

    for buy in &buys {
        let token_id = buy.token_id.as_deref().unwrap_or("").to_string();
        let asset_key = nft_key(
            buy.asset.as_deref().unwrap_or("unknown"),
            &token_id,
        );

        let buy_price = buy.value.unwrap_or(0.0);
        let buy_ts = transfer_timestamp(buy);

        // Try to match a sell
        let matched_sell = sell_map.get_mut(&asset_key).and_then(|v| {
            if v.is_empty() { None } else { Some(v.remove(0)) }
        });

        let (sell_price_eth, pnl_eth, sell_tx_hash, sell_timestamp) =
            if let Some(sell) = matched_sell {
                let sp = sell.value.unwrap_or(0.0);
                let pnl = sp - buy_price;
                (
                    Some(sp),
                    Some(pnl),
                    Some(sell.hash.clone()),
                    Some(transfer_timestamp(sell)),
                )
            } else {
                (None, None, None, None)
            };

        records.push(TradeRecord {
            // Use `asset` field as best-effort contract address identifier.
            // A real implementation should use rawContract.address.
            contract_address: buy.asset.clone().unwrap_or_else(|| "unknown".to_string()),
            token_id,
            buy_price_eth: buy_price,
            sell_price_eth,
            pnl_eth,
            buy_tx_hash: buy.hash.clone(),
            sell_tx_hash,
            buy_timestamp: buy_ts,
            sell_timestamp,
        });
    }

    records
}

/// Aggregate trade records into a PnlSummary.
pub fn aggregate_pnl(wallet: &str, trades: &[TradeRecord]) -> PnlSummary {
    let mut realized_pnl = 0.0_f64;
    let unrealized_pnl = 0.0_f64;
    let mut total_buy = 0.0_f64;
    let mut total_sell = 0.0_f64;
    let mut trade_count = 0u32;
    let mut win_count = 0u32;
    let mut loss_count = 0u32;

    for trade in trades {
        total_buy += trade.buy_price_eth;
        if let Some(sp) = trade.sell_price_eth {
            total_sell += sp;
            trade_count += 1;
            if let Some(pnl) = trade.pnl_eth {
                realized_pnl += pnl;
                if pnl >= 0.0 {
                    win_count += 1;
                } else {
                    loss_count += 1;
                }
            }
        }
        // Unrealized: no floor price available at this layer — caller enriches
        // with floor data. Here we leave unrealized_pnl = 0.0 as baseline.
        // The command layer adds floor-based unrealized PnL.
        let _ = unrealized_pnl; // suppressed; computed in command layer
    }

    PnlSummary {
        wallet_address: wallet.to_string(),
        realized_pnl_eth: realized_pnl,
        unrealized_pnl_eth: unrealized_pnl,
        total_buy_volume_eth: total_buy,
        total_sell_volume_eth: total_sell,
        // Gas: alchemy_getAssetTransfers does not return gas fields.
        // gas_spent_eth is always 0.0 — UI should display "N/A".
        gas_spent_eth: 0.0,
        trade_count,
        win_count,
        loss_count,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri commands
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_pnl_summary(
    wallet_address: String,
    api_key: String,
) -> Result<PnlSummary, String> {
    let client = AlchemyClient::new(&api_key);

    let (incoming, outgoing) = tokio::try_join!(
        client.get_nft_transfers_to(&wallet_address, "0x0"),
        client.get_asset_transfers_from(&wallet_address, "0x0"),
    )?;

    let trades = compute_trades(&wallet_address, &incoming, &outgoing);
    let mut summary = aggregate_pnl(&wallet_address, &trades);

    // Unrealized PnL: for held NFTs compute (floor - avg_buy_price).
    // We use NFTs still held (no sell matched) and fetch floor prices.
    // Group held trades by contract/asset to batch floor lookups.
    let held: Vec<&TradeRecord> = trades.iter().filter(|t| t.sell_price_eth.is_none()).collect();

    let mut unrealized = 0.0_f64;
    // Deduplicate contract keys to avoid redundant floor requests
    let mut seen_contracts: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut floor_cache: HashMap<String, f64> = HashMap::new();

    for trade in &held {
        let contract_key = trade.contract_address.to_lowercase();
        if !seen_contracts.contains(&contract_key) {
            seen_contracts.insert(contract_key.clone());
            // contract_address here is actually the asset symbol/name (limitation noted above).
            // We attempt a floor price lookup; if it fails we skip.
            if let Ok(fp) = client.get_floor_price(&trade.contract_address).await {
                if let Some(price) = fp.floor_price {
                    floor_cache.insert(contract_key, price);
                }
            }
        }
    }

    for trade in &held {
        let contract_key = trade.contract_address.to_lowercase();
        if let Some(&floor) = floor_cache.get(&contract_key) {
            unrealized += floor - trade.buy_price_eth;
        }
    }

    summary.unrealized_pnl_eth = unrealized;
    Ok(summary)
}

#[tauri::command]
pub async fn get_trade_history(
    wallet_address: String,
    api_key: String,
) -> Result<Vec<TradeRecord>, String> {
    let client = AlchemyClient::new(&api_key);

    let (incoming, outgoing) = tokio::try_join!(
        client.get_nft_transfers_to(&wallet_address, "0x0"),
        client.get_asset_transfers_from(&wallet_address, "0x0"),
    )?;

    let trades = compute_trades(&wallet_address, &incoming, &outgoing);
    Ok(trades)
}

#[tauri::command]
pub async fn get_portfolio_snapshot(
    wallet_address: String,
    api_key: String,
) -> Result<PortfolioSnapshot, String> {
    use crate::data::WalletDataProvider;

    let provider = crate::data::default_provider(&api_key);
    let rpc_client = AlchemyClient::new(&api_key);

    // Run both in parallel; neither failure is fatal
    let (portfolio_result, nfts_result) = tokio::join!(
        provider.get_wallet_portfolio(&wallet_address),
        rpc_client.get_nfts_for_owner(&wallet_address, None),
    );

    // Prefer the premium Data API (full ERC-20 USD values). If unavailable (free/standard
    // plan returns 401/403), fall back to standard RPC endpoints that work on every tier.
    let (eth_balance, eth_price_usd, token_count, token_total_usd) = match portfolio_result {
        Ok(portfolio) => {
            let count = portfolio.tokens.len() as u32;
            let price = portfolio.eth_price_usd.unwrap_or(0.0);
            (portfolio.eth_balance, price, count, portfolio.total_usd)
        }
        Err(_) => {
            // Standard RPC fallback — available on all Alchemy plan tiers
            let http = crate::data::alchemy::AlchemyHttpClient::new(&api_key);
            let (eth_result, tok_result, price_result) = tokio::join!(
                rpc_client.get_eth_balance(&wallet_address),
                rpc_client.get_token_balances(&wallet_address),
                crate::data::alchemy::prices::get_eth_price_usd(&http),
            );
            let eth_bal = eth_result.map(|b| b.eth).unwrap_or(0.0);
            let eth_price = price_result.unwrap_or(0.0);
            let tok_count = tok_result.map(|v| v.len() as u32).unwrap_or(0);
            (eth_bal, eth_price, tok_count, eth_bal * eth_price)
        }
    };

    // Sum highest bid (top offer) for each NFT. Falls back to floor price if no OpenSea key.
    let (nft_count, nft_value_usd) = match nfts_result {
        Ok(nfts) => {
            let count = nfts.total_count as u32;
            let opensea_key = crate::wallet::keychain::fetch_opensea_key().unwrap_or_default();

            let nft_eth = if !opensea_key.is_empty() && !nfts.owned_nfts.is_empty() {
                let mp = crate::marketplace::client::MarketplaceClient::new("", &opensea_key);
                let pairs: Vec<(String, String)> = nfts.owned_nfts.iter()
                    .map(|n| (n.contract.address.clone(), n.token_id.clone()))
                    .collect();
                let results = futures_util::future::join_all(
                    pairs.iter().map(|(c, t)| mp.fetch_nft_detail(c, t))
                ).await;
                results.into_iter()
                    .filter_map(|r| r.ok())
                    .filter_map(|d| d.top_offer_eth)
                    .sum::<f64>()
            } else {
                nfts.owned_nfts.iter()
                    .filter_map(|n| n.contract.opensea_floor_price)
                    .sum::<f64>()
            };

            (count, nft_eth * eth_price_usd)
        }
        Err(_) => (0, 0.0),
    };

    Ok(PortfolioSnapshot {
        eth_balance,
        eth_price_usd,
        portfolio_value_usd: token_total_usd + nft_value_usd,
        token_count,
        nft_count,
    })
}
