//! Wallet data layer — single source of truth for everything wallet-related.
//!
//! All Westron wallet data (balances, tokens, NFTs, transfers, prices) flows
//! through this module. The provider implementation (Alchemy today) is hidden
//! behind traits in `provider`, so swapping providers later is a one-line
//! config change rather than a sprawling refactor.
//!
//! Submodules:
//! - `provider`  — provider-agnostic traits and shared error type
//! - `types`     — shared DTOs returned to the Tauri layer
//! - `alchemy`   — Alchemy implementation (REST + JSON-RPC + WebSocket)
//! - `realtime`  — WebSocket subscription manager + adaptive price poller

pub mod provider;
pub mod types;
pub mod alchemy;
pub mod realtime;

pub use provider::{
    DataProviderError,
    PriceProvider,
    WalletDataProvider,
    NftDataProvider,
    RealtimeProvider,
};
pub use types::{
    TokenPrice,
    WalletToken,
    WalletPortfolio,
    NftCollectionMeta,
    NftSale,
    WalletEvent,
    SubscriptionId,
};

/// Default provider — returns an Alchemy-backed provider implementing all traits.
/// `api_key` is the Alchemy app key (REST + RPC); `ws_key` defaults to the same.
pub fn default_provider(api_key: &str) -> alchemy::AlchemyProvider {
    alchemy::AlchemyProvider::new(api_key)
}
