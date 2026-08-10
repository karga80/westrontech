use serde::{Deserialize, Serialize};

/// Which marketplace to target for an order
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Marketplace {
    Opensea,
    Blur,
}

impl std::fmt::Display for Marketplace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Marketplace::Opensea => write!(f, "opensea"),
            Marketplace::Blur => write!(f, "blur"),
        }
    }
}

/// Input for creating a new NFT listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListingInput {
    pub wallet_address: String,
    pub contract_address: String,
    pub token_id: String,
    pub price_eth: f64,
    pub marketplace: Marketplace,
    pub expiry_hours: u64,
}

/// Input for placing a collection-level bid
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BidInput {
    pub wallet_address: String,
    pub contract_address: String,
    pub price_eth: f64,
    pub quantity: u32,
    pub marketplace: Marketplace,
    pub expiry_hours: u64,
}

/// Input for cancelling an existing order
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelInput {
    pub order_hash: String,
    pub wallet_address: String,
    pub marketplace: Marketplace,
}

/// Unified result returned for all marketplace operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderResult {
    /// Marketplace-assigned order hash (or simulated placeholder)
    pub order_hash: String,
    /// Action that was performed: "list" | "bid" | "cancel"
    pub action: String,
    pub marketplace: String,
    pub status: OrderStatus,
    pub tx_hash: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderStatus {
    Pending,
    Submitted,
    Confirmed,
    Failed,
}

/// What a marketplace command actually did: it completed the order right
/// away, or the autonomy policy queued it for a human to approve — the same
/// distinction `signing::SigningOutcome` draws for `send_eth`/`transfer_nft`,
/// mirrored here rather than reused directly since the "executed" shape is
/// an `OrderResult`, not a bare tx hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum MarketplaceActionOutcome {
    Completed { result: OrderResult },
    PendingApproval { proposal_id: String, reason: String },
}

/// A single trait on an NFT
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftTrait {
    pub trait_type: String,
    pub value: String,
}

/// A single NFT returned by OpenSea collection browse
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftAsset {
    pub identifier: String,
    pub name: Option<String>,
    pub image_url: Option<String>,
    pub display_image_url: Option<String>,
    pub opensea_url: Option<String>,
    /// Current listing price in ETH (None = not listed)
    pub price_eth: Option<f64>,
    /// Last sale price in ETH
    pub last_sale_eth: Option<f64>,
    /// Order hash of the active listing (for buy flow)
    pub order_hash: Option<String>,
    /// Rarity rank (1 = rarest)
    pub rarity_rank: Option<u64>,
    /// Trait metadata
    pub traits: Vec<NftTrait>,
}

/// Paginated NFT result with cursor for next page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftPage {
    pub items: Vec<NftAsset>,
    pub next: Option<String>,
}

/// Full collection metadata fetched from OpenSea by contract address
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInfo {
    pub slug: String,
    pub name: String,
    pub contract_address: String,
    pub symbol: Option<String>,
    pub total_supply: Option<u64>,
    pub floor_price_eth: Option<f64>,
    pub vol_24h_eth: Option<f64>,
    pub vol_7d_eth: Option<f64>,
    pub sales_7d: Option<u64>,
    pub num_owners: Option<u64>,
    pub image_url: Option<String>,
    pub description: Option<String>,
}

/// Collection stats from OpenSea /api/v2/collections/{slug}/stats
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionStats {
    pub floor_price_eth: Option<f64>,
    pub num_owners: Option<u64>,
    pub total_supply: Option<u64>,
    pub market_cap_eth: Option<f64>,
    pub total_volume_eth: Option<f64>,
    /// 1-day interval
    pub vol_1d_eth: Option<f64>,
    pub vol_1d_change: Option<f64>,
    pub sales_1d: Option<u64>,
    pub avg_price_1d_eth: Option<f64>,
    /// 7-day interval
    pub vol_7d_eth: Option<f64>,
    pub vol_7d_change: Option<f64>,
    pub sales_7d: Option<u64>,
    /// 30-day interval
    pub vol_30d_eth: Option<f64>,
    pub vol_30d_change: Option<f64>,
    pub sales_30d: Option<u64>,
}

/// A single activity event from OpenSea /api/v2/events/collection/{slug}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionEvent {
    pub event_type: String,
    pub token_id: Option<String>,
    pub nft_name: Option<String>,
    pub nft_image_url: Option<String>,
    pub opensea_url: Option<String>,
    pub price_eth: Option<f64>,
    pub payment_symbol: Option<String>,
    pub seller: Option<String>,
    pub buyer: Option<String>,
    pub from_address: Option<String>,
    pub to_address: Option<String>,
    pub timestamp: Option<i64>,
    pub transaction: Option<String>,
}

/// A top holder entry from Alchemy alchemy_getOwnersForContract
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionHolder {
    pub owner_address: String,
    pub token_count: u64,
}

/// A single collection offer order from OpenSea /api/v2/orders/ethereum/seaport/offers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionOffer {
    pub price_eth: f64,
    pub payment_symbol: String,
    pub quantity: u64,
    pub maker_address: String,
    pub maker_username: Option<String>,
    pub maker_image_url: Option<String>,
    pub expiration: Option<i64>,
    pub order_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraitValue {
    pub value: String,
    pub count: u64,
    pub supply_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionTrait {
    pub category: String,
    pub values: Vec<TraitValue>,
}

/// Per-token enrichment data fetched from OpenSea
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NftDetail {
    pub rarity_rank: Option<u64>,
    pub listing_price_eth: Option<f64>,
    pub top_offer_eth: Option<f64>,
}
