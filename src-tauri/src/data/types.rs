//! Shared DTOs returned by the provider layer.
//!
//! Kept deliberately small — most NFT fields are still served by existing
//! types in `crate::rpc::types`. Only types specific to the new endpoints
//! (Prices API, Portfolio API, real-time events) live here.

use serde::{Deserialize, Serialize};

/// One quote for one token.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenPrice {
    pub symbol: String,
    pub address: Option<String>,
    pub network: Option<String>,
    pub usd: Option<f64>,
    pub last_updated_at: Option<String>, // ISO-8601
}

/// One token in a wallet (Portfolio API row).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletToken {
    pub address: String,                  // owner wallet
    pub network: String,                  // e.g. "eth-mainnet"
    pub token_address: Option<String>,    // None for native ETH
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub decimals: Option<u8>,
    pub logo: Option<String>,
    pub balance_raw: Option<String>,      // hex or decimal string
    pub balance: Option<f64>,             // human-readable
    pub usd_value: Option<f64>,           // balance × usd_price
    pub usd_price: Option<f64>,
    pub price_last_updated_at: Option<String>,
    pub is_native: bool,
}

/// Aggregated wallet portfolio — one call replaces (eth_balance + token_balances + prices).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletPortfolio {
    pub wallet: String,
    pub eth_balance: f64,
    pub eth_price_usd: Option<f64>,
    pub total_usd: f64,
    pub tokens: Vec<WalletToken>,
}

/// Collection-level metadata (NFT v3 getContractMetadata).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NftCollectionMeta {
    pub address: String,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub total_supply: Option<String>,
    pub token_type: Option<String>,
    pub deployed_block_number: Option<u64>,
    pub deployer: Option<String>,
    pub opensea_floor_price_eth: Option<f64>,
    pub opensea_collection_name: Option<String>,
    pub opensea_image_url: Option<String>,
    pub opensea_banner_url: Option<String>,
    pub opensea_safelist_status: Option<String>,
}

/// Single NFT sale event (NFT v3 getNFTSales).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NftSale {
    pub contract_address: String,
    pub token_id: String,
    pub marketplace: Option<String>,
    pub seller: Option<String>,
    pub buyer: Option<String>,
    pub price_eth: Option<f64>,
    pub price_usd: Option<f64>,
    pub block_number: Option<u64>,
    pub block_timestamp: Option<String>,
    pub tx_hash: Option<String>,
    pub quantity: Option<u64>,
}

/// Opaque handle for a real-time subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SubscriptionId(pub u64);

impl std::fmt::Display for SubscriptionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "sub:{}", self.0)
    }
}

/// Event delivered from the WebSocket layer to the frontend.
///
/// Variants intentionally use `kind` discriminator (snake_case) so the
/// frontend can pattern-match on a single string instead of a class union.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WalletEvent {
    /// Wallet sent or received a confirmed transaction.
    WalletTx {
        wallet: String,
        hash: String,
        from: String,
        to: Option<String>,
        value_wei: Option<String>,
        block_number: u64,
        category: String, // "external" | "erc20" | "erc721" | "erc1155" | "internal"
        asset: Option<String>,
    },
    /// ERC-721 / ERC-1155 Transfer event for a watched collection.
    CollectionTransfer {
        contract: String,
        from: String,
        to: String,
        token_id: Option<String>,
        block_number: u64,
        tx_hash: String,
    },
    /// New block (for gas tracker, block clock).
    NewBlock {
        block_number: u64,
        block_hash: String,
        timestamp: u64,
        base_fee_per_gas_wei: Option<String>,
        gas_used: Option<String>,
        gas_limit: Option<String>,
    },
    /// Price tick from the adaptive poller.
    PriceTick {
        symbol: String,
        usd: f64,
        last_updated_at: String,
    },
    /// Subscription connection state change (ui badge).
    ConnectionState {
        connected: bool,
        reason: Option<String>,
    },
}
