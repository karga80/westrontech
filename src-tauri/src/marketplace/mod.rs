pub mod client;
pub mod seaport;
pub mod types;

pub use types::{BidInput, CancelInput, CollectionEvent, CollectionHolder, CollectionInfo, CollectionOffer, CollectionStats, CollectionTrait, ListingInput, Marketplace, NftAsset, NftPage, NftTrait, OrderResult, TraitValue};

use client::MarketplaceClient;

pub async fn list_nft(input: &ListingInput, alchemy_key: &str, opensea_key: &str) -> Result<OrderResult, String> {
    let client = MarketplaceClient::new(alchemy_key, opensea_key);
    client.list_nft(input).await
}

pub async fn place_bid(input: &BidInput, alchemy_key: &str, opensea_key: &str) -> Result<OrderResult, String> {
    let client = MarketplaceClient::new(alchemy_key, opensea_key);
    client.place_bid(input).await
}

pub async fn cancel_order(input: &CancelInput, alchemy_key: &str, opensea_key: &str) -> Result<OrderResult, String> {
    let client = MarketplaceClient::new(alchemy_key, opensea_key);
    client.cancel_order(input).await
}

pub async fn fetch_collection_nfts(collection_slug: &str, limit: u32, opensea_key: &str) -> Result<Vec<NftAsset>, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_nfts(collection_slug, limit).await
}

pub async fn fetch_nfts_by_collection(
    slug: &str,
    status: &str,
    wallet_address: Option<&str>,
    cursor: Option<&str>,
    sort: &str,
    limit: u32,
    opensea_key: &str,
) -> Result<NftPage, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_nfts_by_collection(slug, status, wallet_address, cursor, sort, limit).await
}

pub async fn fetch_collection_by_contract(contract_address: &str, opensea_key: &str) -> Result<CollectionInfo, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_by_contract(contract_address).await
}

pub async fn fetch_collection_stats(slug: &str, opensea_key: &str) -> Result<CollectionStats, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_stats(slug).await
}

pub async fn fetch_collection_events(slug: &str, event_type: &str, limit: u32, opensea_key: &str) -> Result<Vec<CollectionEvent>, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_events(slug, event_type, limit).await
}

pub async fn fetch_collection_holders(contract_address: &str, alchemy_key: &str, limit: usize, opensea_key: &str) -> Result<Vec<CollectionHolder>, String> {
    let client = MarketplaceClient::new(alchemy_key, opensea_key);
    client.fetch_collection_holders(contract_address, alchemy_key, limit).await
}

pub async fn fetch_collection_offers(slug: &str, limit: u32, opensea_key: &str) -> Result<Vec<CollectionOffer>, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_offers(slug, limit).await
}

pub async fn fetch_collection_traits(slug: &str, total_supply: u64, opensea_key: &str) -> Result<Vec<CollectionTrait>, String> {
    let client = MarketplaceClient::new("", opensea_key);
    client.fetch_collection_traits(slug, total_supply).await
}
