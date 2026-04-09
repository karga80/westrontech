use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: serde_json::Value,
    pub id: u64,
}

impl RpcRequest {
    pub fn new(method: &str, params: serde_json::Value) -> Self {
        RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
            id: 1,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct RpcResponse<T> {
    pub result: Option<T>,
    pub error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct EthBalance {
    pub address: String,
    pub wei: String,      // hex string from RPC
    pub eth: f64,         // parsed
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TokenBalance {
    pub contract_address: String,
    pub token_balance: String, // hex
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
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
    pub metadata: Option<AssetTransferMetadata>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AssetTransferMetadata {
    pub block_timestamp: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TokenMetadata {
    pub contract_address: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<u8>,
    pub logo: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NftContract {
    pub address: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub token_type: Option<String>, // "ERC721" | "ERC1155"
    pub opensea_floor_price: Option<f64>,
    pub opensea_collection_name: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NftImage {
    pub cached_url: Option<String>,
    pub original_url: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NftAttribute {
    pub trait_type: Option<String>,
    pub value: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OwnedNft {
    pub contract: NftContract,
    pub token_id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub image: Option<NftImage>,
    pub raw_metadata: Option<serde_json::Value>,
    pub attributes: Option<Vec<NftAttribute>>,
    pub balance: Option<String>, // ERC1155 için adet
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NftFloorPrice {
    pub contract_address: String,
    pub floor_price: Option<f64>,
    pub price_currency: Option<String>,
    pub marketplace: Option<String>,
    pub retrieved_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NftsForOwnerResponse {
    pub owned_nfts: Vec<OwnedNft>,
    pub total_count: u64,
    pub page_key: Option<String>,
}
