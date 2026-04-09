use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Unified event emitted to the frontend via Tauri for all stream events
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub collection_slug: String,
    pub event_type: String,
    pub payload: Value,
    pub received_at: String,
}

// ── Shared types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaymentToken {
    pub address: Option<String>,
    pub symbol: Option<String>,
    pub decimals: Option<u32>,
    pub eth_price: Option<String>,
    pub usd_price: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Account {
    pub address: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Transaction {
    pub hash: String,
    pub timestamp: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemTrait {
    pub trait_type: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemMetadata {
    pub name: Option<String>,
    pub image_url: Option<String>,
    pub animation_url: Option<String>,
    pub metadata_url: Option<String>,
    pub background_color: Option<String>,
    pub description: Option<String>,
    pub traits: Option<Vec<ItemTrait>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemInfo {
    pub nft_id: Option<String>,
    pub permalink: Option<String>,
    pub metadata: Option<ItemMetadata>,
    pub chain: Option<ItemChain>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemChain {
    pub name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AssetContractCriteria {
    pub address: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CollectionCriteria {
    pub slug: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TraitCriteria {
    pub trait_type: String,
    pub trait_name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NumericTraitCriteria {
    pub trait_type: String,
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
}

// ── Payload types ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct ItemListedPayload {
    pub event_timestamp: Option<String>,
    pub base_price: Option<String>,
    pub quantity: Option<u64>,
    pub payment_token: Option<PaymentToken>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub order_hash: Option<String>,
    pub item: Option<ItemInfo>,
    pub chain: Option<String>,
    pub expiration_date: Option<String>,
    pub listing_date: Option<String>,
    pub is_private: Option<bool>,
}

impl ItemListedPayload {
    pub fn price_eth(&self) -> Option<f64> {
        let wei: u128 = self.base_price.as_deref()?.parse().ok()?;
        Some(wei as f64 / 1e18)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemSoldPayload {
    pub event_timestamp: Option<String>,
    pub sale_price: Option<String>,
    pub quantity: Option<u64>,
    pub payment_token: Option<PaymentToken>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub order_hash: Option<String>,
    pub item: Option<ItemInfo>,
    pub chain: Option<String>,
    pub closing_date: Option<String>,
    pub transaction: Option<Transaction>,
    pub is_private: Option<bool>,
}

impl ItemSoldPayload {
    pub fn price_eth(&self) -> Option<f64> {
        let wei: u128 = self.sale_price.as_deref()?.parse().ok()?;
        Some(wei as f64 / 1e18)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemTransferredPayload {
    pub event_timestamp: Option<String>,
    pub from_account: Option<Account>,
    pub to_account: Option<Account>,
    pub quantity: Option<u64>,
    pub item: Option<ItemInfo>,
    pub chain: Option<String>,
    pub transaction: Option<Transaction>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemMetadataUpdatedPayload {
    pub item: Option<ItemInfo>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemCancelledPayload {
    pub event_timestamp: Option<String>,
    pub base_price: Option<String>,
    pub order_hash: Option<String>,
    pub item: Option<ItemInfo>,
    pub chain: Option<String>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub payment_token: Option<PaymentToken>,
    pub transaction: Option<Transaction>,
    pub asset_contract_criteria: Option<AssetContractCriteria>,
    pub trait_criteria: Option<Vec<TraitCriteria>>,
    pub is_private: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ItemReceivedBidPayload {
    pub event_timestamp: Option<String>,
    pub base_price: Option<String>,
    pub quantity: Option<u64>,
    pub payment_token: Option<PaymentToken>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub order_hash: Option<String>,
    pub item: Option<ItemInfo>,
    pub chain: Option<String>,
    pub created_date: Option<String>,
    pub expiration_date: Option<String>,
}

impl ItemReceivedBidPayload {
    pub fn price_eth(&self) -> Option<f64> {
        let wei: u128 = self.base_price.as_deref()?.parse().ok()?;
        Some(wei as f64 / 1e18)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CollectionOfferPayload {
    pub event_timestamp: Option<String>,
    pub base_price: Option<String>,
    pub quantity: Option<u64>,
    pub payment_token: Option<PaymentToken>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub order_hash: Option<String>,
    pub chain: Option<String>,
    pub created_date: Option<String>,
    pub expiration_date: Option<String>,
    pub asset_contract_criteria: Option<AssetContractCriteria>,
    pub collection_criteria: Option<CollectionCriteria>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TraitOfferPayload {
    pub event_timestamp: Option<String>,
    pub base_price: Option<String>,
    pub quantity: Option<u64>,
    pub payment_token: Option<PaymentToken>,
    pub maker: Option<Account>,
    pub taker: Option<Account>,
    pub order_hash: Option<String>,
    pub chain: Option<String>,
    pub created_date: Option<String>,
    pub expiration_date: Option<String>,
    pub asset_contract_criteria: Option<AssetContractCriteria>,
    pub collection_criteria: Option<CollectionCriteria>,
    pub trait_criteria: Option<TraitCriteria>,
    pub trait_criteria_list: Option<Vec<TraitCriteria>>,
    pub numeric_trait_criteria_list: Option<Vec<NumericTraitCriteria>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OrderInvalidatePayload {
    pub event_timestamp: Option<String>,
    pub order_hash: Option<String>,
    pub chain: Option<String>,
    pub item: Option<ItemInfo>,
    pub asset_contract_criteria: Option<AssetContractCriteria>,
    pub trait_criteria: Option<Vec<TraitCriteria>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OrderRevalidatePayload {
    pub event_timestamp: Option<String>,
    pub order_hash: Option<String>,
    pub chain: Option<String>,
}
