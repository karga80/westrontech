//! Alchemy provider — implements every trait in `data::provider`.
//!
//! Internal layout:
//! - `client`    — shared HTTP client + JSON-RPC dispatcher
//! - `prices`    — Prices API (REST, `api.g.alchemy.com/prices/v1/...`)
//! - `portfolio` — Portfolio API (REST, `api.g.alchemy.com/data/v1/...`)
//! - `nft`       — NFT API v3 enrichment (REST, `eth-mainnet.g.alchemy.com/nft/v3/...`)
//! - `transfers` — `alchemy_getAssetTransfers` (JSON-RPC over the v2 endpoint)
//! - `ws`        — WebSocket subscription multiplexer

pub mod client;
pub mod prices;
pub mod portfolio;
pub mod nft;
pub mod transfers;
pub mod ws;

pub use client::AlchemyHttpClient;

use async_trait::async_trait;
use std::sync::Arc;

use crate::data::provider::{
    DataProviderError, NftDataProvider, PriceProvider, ProviderResult, RealtimeProvider,
    WalletDataProvider,
};
use crate::data::types::{
    NftCollectionMeta, NftSale, SubscriptionId, TokenPrice, WalletEvent, WalletPortfolio,
    WalletToken,
};

/// Single Alchemy provider instance — cheap to clone (Arc-shared HTTP client).
#[derive(Clone)]
pub struct AlchemyProvider {
    http: Arc<AlchemyHttpClient>,
    ws: Arc<ws::AlchemyWsManager>,
}

impl AlchemyProvider {
    pub fn new(api_key: &str) -> Self {
        let http = Arc::new(AlchemyHttpClient::new(api_key));
        let ws = Arc::new(ws::AlchemyWsManager::new(api_key));
        Self { http, ws }
    }

    pub fn http(&self) -> &AlchemyHttpClient { &self.http }
    pub fn ws(&self) -> &ws::AlchemyWsManager { &self.ws }
}

#[async_trait]
impl PriceProvider for AlchemyProvider {
    async fn get_prices_by_symbol(&self, symbols: &[&str]) -> ProviderResult<Vec<TokenPrice>> {
        prices::get_prices_by_symbol(&self.http, symbols).await
    }

    async fn get_prices_by_address(&self, addresses: &[&str]) -> ProviderResult<Vec<TokenPrice>> {
        prices::get_prices_by_address(&self.http, addresses).await
    }
}

#[async_trait]
impl WalletDataProvider for AlchemyProvider {
    async fn get_wallet_portfolio(&self, wallet: &str) -> ProviderResult<WalletPortfolio> {
        portfolio::get_wallet_portfolio(&self.http, wallet).await
    }

    async fn get_wallet_tokens(&self, wallet: &str) -> ProviderResult<Vec<WalletToken>> {
        portfolio::get_wallet_tokens(&self.http, wallet).await
    }
}

#[async_trait]
impl NftDataProvider for AlchemyProvider {
    async fn get_collection_metadata(&self, contract: &str) -> ProviderResult<NftCollectionMeta> {
        nft::get_collection_metadata(&self.http, contract).await
    }

    async fn get_nft_sales(
        &self,
        contract: &str,
        token_id: Option<&str>,
        limit: u32,
    ) -> ProviderResult<Vec<NftSale>> {
        nft::get_nft_sales(&self.http, contract, token_id, limit).await
    }
}

#[async_trait]
impl RealtimeProvider for AlchemyProvider {
    async fn subscribe_wallet_transactions(
        &self,
        wallets: &[String],
    ) -> ProviderResult<SubscriptionId> {
        self.ws.subscribe_mined_transactions(wallets).await
    }

    async fn subscribe_collection_transfers(
        &self,
        contracts: &[String],
    ) -> ProviderResult<SubscriptionId> {
        self.ws.subscribe_collection_transfers(contracts).await
    }

    async fn subscribe_new_heads(&self) -> ProviderResult<SubscriptionId> {
        self.ws.subscribe_new_heads().await
    }

    async fn unsubscribe(&self, id: SubscriptionId) -> ProviderResult<()> {
        self.ws.unsubscribe(id).await
    }

    async fn poll_events(&self) -> ProviderResult<Vec<WalletEvent>> {
        // Delegate to the WS manager's drain queue. Real consumers should listen
        // via `event_router::subscribe_events` instead.
        Ok(self.ws.drain_pending().await)
    }
}

/// Helper: convert any `reqwest::Error` into a `DataProviderError` with a
/// useful context string (used by submodules).
pub(crate) fn map_reqwest(e: reqwest::Error, context: &str) -> DataProviderError {
    let base: DataProviderError = e.into();
    match base {
        DataProviderError::Upstream { status, message } => DataProviderError::Upstream {
            status,
            message: format!("{context}: {message}"),
        },
        other => other,
    }
}
