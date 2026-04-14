//! Alchemy NFT API v3 — enrichment endpoints.
//!
//! `getNFTsForOwner` is already wrapped in `crate::rpc::client`; this module
//! adds the missing pieces:
//! - `getContractMetadata` — collection name/symbol/floor independent of OpenSea
//! - `getNFTSales`         — recent sales for a contract (replaces OpenSea events tab data for "last sale")
//! - `getTransfersForOwner` — wallet's full NFT transfer history (used by PnL)

use serde::Deserialize;

use crate::data::alchemy::AlchemyHttpClient;
use crate::data::provider::ProviderResult;
use crate::data::types::{NftCollectionMeta, NftSale};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractMetaResponse {
    address: String,
    name: Option<String>,
    symbol: Option<String>,
    total_supply: Option<String>,
    token_type: Option<String>,
    deployed_block_number: Option<u64>,
    contract_deployer: Option<String>,
    opensea_metadata: Option<OpenSeaMeta>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenSeaMeta {
    floor_price: Option<f64>,
    collection_name: Option<String>,
    safelist_request_status: Option<String>,
    image_url: Option<String>,
    banner_image_url: Option<String>,
}

/// GET /getContractMetadata?contractAddress=0x...
pub async fn get_collection_metadata(
    http: &AlchemyHttpClient,
    contract: &str,
) -> ProviderResult<NftCollectionMeta> {
    let query = [("contractAddress", contract)];
    let resp: ContractMetaResponse = http.nft_get("getContractMetadata", &query).await?;

    Ok(NftCollectionMeta {
        address: resp.address,
        name: resp.name,
        symbol: resp.symbol,
        total_supply: resp.total_supply,
        token_type: resp.token_type,
        deployed_block_number: resp.deployed_block_number,
        deployer: resp.contract_deployer,
        opensea_floor_price_eth: resp.opensea_metadata.as_ref().and_then(|m| m.floor_price),
        opensea_collection_name: resp.opensea_metadata.as_ref().and_then(|m| m.collection_name.clone()),
        opensea_image_url: resp.opensea_metadata.as_ref().and_then(|m| m.image_url.clone()),
        opensea_banner_url: resp.opensea_metadata.as_ref().and_then(|m| m.banner_image_url.clone()),
        opensea_safelist_status: resp.opensea_metadata.as_ref().and_then(|m| m.safelist_request_status.clone()),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NftSalesResponse {
    nft_sales: Vec<NftSaleRow>,
    #[serde(default)]
    page_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NftSaleRow {
    marketplace: Option<String>,
    contract_address: String,
    token_id: String,
    quantity: Option<String>,
    block_number: Option<u64>,
    block_timestamp: Option<String>,
    transaction_hash: Option<String>,
    seller_address: Option<String>,
    buyer_address: Option<String>,
    seller_fee: Option<FeeRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FeeRow {
    amount: Option<String>,
    decimals: Option<u8>,
    symbol: Option<String>,
}

/// GET /getNFTSales?contractAddress=0x...&tokenId=N&limit=K
pub async fn get_nft_sales(
    http: &AlchemyHttpClient,
    contract: &str,
    token_id: Option<&str>,
    limit: u32,
) -> ProviderResult<Vec<NftSale>> {
    let limit_str = limit.min(1000).to_string();
    let mut query: Vec<(&str, String)> = vec![
        ("contractAddress", contract.to_string()),
        ("limit", limit_str),
        ("order", "desc".into()),
    ];
    if let Some(tid) = token_id {
        query.push(("tokenId", tid.to_string()));
    }

    let resp: NftSalesResponse = http.nft_get("getNFTSales", &query).await?;

    Ok(resp.nft_sales.into_iter().map(|row| {
        let price_eth = row.seller_fee.as_ref().and_then(|fee| {
            let amount = fee.amount.as_ref()?;
            let decimals = fee.decimals.unwrap_or(18) as i32;
            amount.parse::<f64>().ok().map(|v| v / 10f64.powi(decimals))
        });

        let quantity = row.quantity.as_ref().and_then(|q| q.parse::<u64>().ok());

        NftSale {
            contract_address: row.contract_address,
            token_id: row.token_id,
            marketplace: row.marketplace,
            seller: row.seller_address,
            buyer: row.buyer_address,
            price_eth,
            price_usd: None, // can be enriched later by multiplying by ETH price
            block_number: row.block_number,
            block_timestamp: row.block_timestamp,
            tx_hash: row.transaction_hash,
            quantity,
        }
    }).collect())
}
