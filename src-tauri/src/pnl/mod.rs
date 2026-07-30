//! NFT PnL engine — cost basis recorded once from marketplace sales, kept local.
//!
//! - `backfill_cost_basis`: for each held NFT we don't yet have, look up the
//!   acquisition price from marketplace sale records (Alchemy NFT sales, which
//!   include OpenSea) and store it ONCE. Tokens without a marketplace buy
//!   (mint/airdrop/transfer) are stored as `unknown` so we never re-query them.
//! - `compute`: unrealized PnL = current floor − recorded cost, per held NFT.
//!   Current floor comes from the held-NFT metadata (no extra call per token).
//!
//! Everything lives in the user's local SQLite DB. No central server, no shared
//! table — so this scales to any number of subscribers for free.

pub mod db;

use std::path::PathBuf;
use chrono::Utc;
use serde::Serialize;

use crate::data;
use crate::rpc;

fn ensure_db() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir().ok_or("no data dir")?;
    let dir = base.join("Westron");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("cost_basis.db");
    db::init_db(&path)?;
    Ok(path)
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

#[derive(Debug, Serialize)]
pub struct BackfillResult {
    pub scanned: usize,
    pub newly_recorded: usize,
    pub with_price: usize,
    pub unknown: usize,
}

/// Record acquisition prices for any held NFTs we don't already have. One-time
/// per token; already-recorded tokens are skipped (never re-queried).
pub async fn backfill_cost_basis(wallet: &str, api_key: &str) -> Result<BackfillResult, String> {
    let path = ensure_db()?;
    let rpc_client = rpc::client::AlchemyClient::new(api_key);
    let provider = data::default_provider(api_key);
    use data::NftDataProvider;

    let owned = rpc_client.get_nfts_for_owner(wallet, None).await?;
    let wl = wallet.to_lowercase();

    let mut res = BackfillResult { scanned: 0, newly_recorded: 0, with_price: 0, unknown: 0 };

    for nft in owned.owned_nfts {
        res.scanned += 1;
        let contract = nft.contract.address.to_lowercase();
        let token_id = nft.token_id.clone();

        // Never re-query a token we already have.
        if db::exists(&path, &wl, &contract, &token_id)? {
            continue;
        }

        // Look up the acquisition price from marketplace sales for THIS token.
        let sales = provider
            .get_nft_sales(&contract, Some(&token_id), 25)
            .await
            .unwrap_or_default();

        // The most recent sale where this wallet was the buyer = how they got it.
        let acq = sales
            .into_iter()
            .filter(|s| s.buyer.as_deref().map(|b| b.to_lowercase()).as_deref() == Some(wl.as_str()))
            .max_by(|a, b| {
                a.block_timestamp
                    .clone()
                    .unwrap_or_default()
                    .cmp(&b.block_timestamp.clone().unwrap_or_default())
            });

        match acq {
            Some(sale) if sale.price_eth.is_some() => {
                let recorded = db::upsert_if_absent(
                    &path, &wl, &contract, &token_id,
                    sale.price_eth, sale.block_timestamp.as_deref(),
                    "marketplace_sale", &now_iso(),
                )?;
                if recorded { res.newly_recorded += 1; res.with_price += 1; }
            }
            _ => {
                // No marketplace buy (mint/airdrop/transfer). Store as unknown so
                // we don't keep re-querying it; the user can set it manually.
                let recorded = db::upsert_if_absent(
                    &path, &wl, &contract, &token_id,
                    None, None, "unknown", &now_iso(),
                )?;
                if recorded { res.newly_recorded += 1; res.unknown += 1; }
            }
        }
    }

    Ok(res)
}

#[derive(Debug, Serialize)]
pub struct NftPnlItem {
    pub contract: String,
    pub token_id: String,
    pub collection: Option<String>,
    pub cost_eth: Option<f64>,   // recorded acquisition price
    pub floor_eth: Option<f64>,  // current floor
    pub unrealized_eth: Option<f64>,
    pub source: String,          // marketplace_sale | manual | unknown | none
}

#[derive(Debug, Serialize)]
pub struct NftPnlSummary {
    pub total_cost_eth: f64,      // sum of known cost bases (with a floor)
    pub total_floor_eth: f64,     // sum of current floors for those same items
    pub unrealized_eth: f64,      // total_floor - total_cost
    pub priced_count: usize,      // items with both a cost and a floor
    pub held_count: usize,
    pub items: Vec<NftPnlItem>,
}

/// Compute unrealized NFT PnL from locally-stored cost basis + current floors.
pub async fn compute(wallet: &str, api_key: &str) -> Result<NftPnlSummary, String> {
    let path = ensure_db()?;
    let rpc_client = rpc::client::AlchemyClient::new(api_key);
    let owned = rpc_client.get_nfts_for_owner(wallet, None).await?;
    let wl = wallet.to_lowercase();

    let mut summary = NftPnlSummary {
        total_cost_eth: 0.0,
        total_floor_eth: 0.0,
        unrealized_eth: 0.0,
        priced_count: 0,
        held_count: 0,
        items: Vec::new(),
    };

    for nft in owned.owned_nfts {
        summary.held_count += 1;
        let contract = nft.contract.address.to_lowercase();
        let token_id = nft.token_id.clone();
        let floor = nft.contract.opensea_floor_price;
        let collection = nft.contract.opensea_collection_name.clone();

        let basis = db::get(&path, &wl, &contract, &token_id)?;
        let cost = basis.as_ref().and_then(|b| b.price_eth);
        let source = basis.map(|b| b.source).unwrap_or_else(|| "none".to_string());

        let unrealized = match (cost, floor) {
            (Some(c), Some(f)) => {
                summary.total_cost_eth += c;
                summary.total_floor_eth += f;
                summary.priced_count += 1;
                Some(f - c)
            }
            _ => None,
        };

        summary.items.push(NftPnlItem {
            contract,
            token_id,
            collection,
            cost_eth: cost,
            floor_eth: floor,
            unrealized_eth: unrealized,
            source,
        });
    }

    summary.unrealized_eth = summary.total_floor_eth - summary.total_cost_eth;
    Ok(summary)
}

/// Manual override for a token's cost basis (mints, gifts, corrections).
pub fn set_manual_cost(wallet: &str, contract: &str, token_id: &str, price_eth: f64) -> Result<(), String> {
    let path = ensure_db()?;
    db::set_manual(&path, wallet, contract, token_id, price_eth, &now_iso())
}
