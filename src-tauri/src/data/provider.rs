//! Provider-agnostic traits.
//!
//! Each trait isolates one concern. The Alchemy implementation in
//! `data::alchemy` implements all of them; alternative providers (Moralis,
//! QuickNode, self-hosted indexers) can be slotted in by implementing the
//! same traits and updating `data::default_provider`.

use std::fmt;
use async_trait::async_trait;

use crate::data::types::{
    NftCollectionMeta, NftSale, SubscriptionId, TokenPrice, WalletPortfolio, WalletToken,
    WalletEvent,
};

/// All provider failures collapse into this type so callers never have to
/// branch on the underlying transport.
#[derive(Debug, Clone)]
pub enum DataProviderError {
    /// Network/transport failure (DNS, TCP, TLS, timeout)
    Transport(String),
    /// Provider returned a non-2xx response or a structured RPC error
    Upstream { status: Option<u16>, message: String },
    /// Response was 2xx but couldn't be parsed
    Decode(String),
    /// Caller passed an invalid argument
    InvalidArgument(String),
    /// Provider rate limit hit (HTTP 429 or RPC rate-limit code)
    RateLimited,
    /// WebSocket subscription is closed / no longer valid
    SubscriptionClosed(SubscriptionId),
}

impl fmt::Display for DataProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Transport(m) => write!(f, "transport error: {m}"),
            Self::Upstream { status, message } => match status {
                Some(s) => write!(f, "upstream {s}: {message}"),
                None => write!(f, "upstream: {message}"),
            },
            Self::Decode(m) => write!(f, "decode error: {m}"),
            Self::InvalidArgument(m) => write!(f, "invalid argument: {m}"),
            Self::RateLimited => write!(f, "rate limited by upstream"),
            Self::SubscriptionClosed(id) => write!(f, "subscription {id:?} closed"),
        }
    }
}

impl std::error::Error for DataProviderError {}

impl From<reqwest::Error> for DataProviderError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() || e.is_connect() {
            Self::Transport(e.to_string())
        } else if e.is_decode() {
            Self::Decode(e.to_string())
        } else if let Some(status) = e.status() {
            if status.as_u16() == 429 {
                Self::RateLimited
            } else {
                Self::Upstream { status: Some(status.as_u16()), message: e.to_string() }
            }
        } else {
            Self::Transport(e.to_string())
        }
    }
}

impl From<DataProviderError> for String {
    /// Tauri commands return `Result<T, String>` — make the conversion automatic.
    fn from(e: DataProviderError) -> Self { e.to_string() }
}

pub type ProviderResult<T> = Result<T, DataProviderError>;

/// Token price provider — replaces direct CoinGecko usage.
#[async_trait]
pub trait PriceProvider: Send + Sync {
    /// Get current USD price for one or more well-known token symbols (ETH, USDC...).
    async fn get_prices_by_symbol(&self, symbols: &[&str]) -> ProviderResult<Vec<TokenPrice>>;

    /// Get current USD price for ERC-20 tokens by contract address.
    async fn get_prices_by_address(&self, addresses: &[&str]) -> ProviderResult<Vec<TokenPrice>>;

    /// Convenience: just give me ETH/USD now.
    async fn get_eth_price_usd(&self) -> ProviderResult<f64> {
        let prices = self.get_prices_by_symbol(&["ETH"]).await?;
        prices
            .into_iter()
            .find(|p| p.symbol.eq_ignore_ascii_case("ETH"))
            .and_then(|p| p.usd)
            .ok_or_else(|| DataProviderError::Upstream {
                status: None,
                message: "ETH price not in response".into(),
            })
    }
}

/// Wallet data provider — balances, tokens, transfers.
#[async_trait]
pub trait WalletDataProvider: Send + Sync {
    /// One-shot snapshot: native balance + ERC-20 balances + USD prices + metadata.
    async fn get_wallet_portfolio(&self, wallet: &str) -> ProviderResult<WalletPortfolio>;

    /// Just the token list (no prices).
    async fn get_wallet_tokens(&self, wallet: &str) -> ProviderResult<Vec<WalletToken>>;
}

/// NFT data provider — owned NFTs, collection metadata, sales history.
#[async_trait]
pub trait NftDataProvider: Send + Sync {
    /// Collection metadata (name, symbol, total supply, OpenSea floor).
    async fn get_collection_metadata(&self, contract: &str) -> ProviderResult<NftCollectionMeta>;

    /// Recent sales for a collection (or specific token).
    async fn get_nft_sales(
        &self,
        contract: &str,
        token_id: Option<&str>,
        limit: u32,
    ) -> ProviderResult<Vec<NftSale>>;
}

/// Real-time provider — WebSocket subscriptions emitting WalletEvents.
///
/// Subscriptions are owned by the implementation; the caller receives a
/// `SubscriptionId` it can use to unsubscribe. Events are delivered via the
/// `event_router` rather than returned from these methods directly.
#[async_trait]
pub trait RealtimeProvider: Send + Sync {
    /// Subscribe to mined transactions involving any of the given wallet
    /// addresses (both incoming and outgoing).
    async fn subscribe_wallet_transactions(
        &self,
        wallets: &[String],
    ) -> ProviderResult<SubscriptionId>;

    /// Subscribe to ERC-721/1155 Transfer events on the given contract addresses.
    async fn subscribe_collection_transfers(
        &self,
        contracts: &[String],
    ) -> ProviderResult<SubscriptionId>;

    /// Subscribe to new block headers (gas tracker / block clock).
    async fn subscribe_new_heads(&self) -> ProviderResult<SubscriptionId>;

    /// Cancel a previously-created subscription.
    async fn unsubscribe(&self, id: SubscriptionId) -> ProviderResult<()>;

    /// Drain the next batch of events (non-blocking).
    /// In production you'll prefer the event router; this is here for tests.
    async fn poll_events(&self) -> ProviderResult<Vec<WalletEvent>>;
}
