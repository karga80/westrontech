//! Thin wrappers over `alchemy_getAssetTransfers` for use inside the new
//! provider layer. The original `crate::rpc::client::AlchemyClient` callers
//! continue to work — these helpers exist so realtime/price-poller code can
//! compose with the new shared HTTP client without dragging in the older one.

use serde::Deserialize;
use serde_json::json;

use crate::data::alchemy::AlchemyHttpClient;
use crate::data::provider::ProviderResult;

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetTransfer {
    pub hash: String,
    pub from: String,
    pub to: Option<String>,
    pub value: Option<f64>,
    pub asset: Option<String>,
    pub category: String,
    pub block_num: String,
    #[serde(rename = "tokenId")]
    pub token_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TransferResult {
    transfers: Vec<AssetTransfer>,
}

/// Pull recent inbound + outbound transfers for a wallet starting at a block.
pub async fn get_recent_transfers(
    http: &AlchemyHttpClient,
    wallet: &str,
    from_block_hex: &str,
    max_count: u32,
) -> ProviderResult<Vec<AssetTransfer>> {
    let max_hex = format!("0x{:x}", max_count.min(1000));
    let common_categories = json!(["external", "erc20", "erc721", "erc1155"]);

    // `getAssetTransfers` is one-direction-per-call; do both in parallel.
    let to_call = http.rpc_call::<TransferResult>(
        "alchemy_getAssetTransfers",
        json!([{
            "fromBlock": from_block_hex,
            "toAddress": wallet,
            "category": common_categories,
            "withMetadata": true,
            "excludeZeroValue": false,
            "maxCount": max_hex,
            "order": "desc",
        }]),
    );
    let from_call = http.rpc_call::<TransferResult>(
        "alchemy_getAssetTransfers",
        json!([{
            "fromBlock": from_block_hex,
            "fromAddress": wallet,
            "category": common_categories,
            "withMetadata": true,
            "excludeZeroValue": false,
            "maxCount": max_hex,
            "order": "desc",
        }]),
    );

    let (to_res, from_res) = tokio::try_join!(to_call, from_call)?;
    let mut all = to_res.transfers;
    all.extend(from_res.transfers);
    // Deduplicate by hash + asset (a token transfer can show in both directions
    // for self-transfers).
    all.sort_by(|a, b| b.block_num.cmp(&a.block_num));
    all.dedup_by(|a, b| a.hash == b.hash && a.token_id == b.token_id);
    Ok(all)
}
