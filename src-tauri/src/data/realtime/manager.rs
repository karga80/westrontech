//! `RealtimeManager` — the singleton that orchestrates wallet, NFT, block
//! and price subscriptions for the entire app.
//!
//! Lifecycle:
//! 1. `RealtimeManager::new()` — built once during Tauri setup.
//! 2. `manager.start(app_handle)` — kicks off the event drain loop and price
//!    poller, both bound to the Tauri AppHandle so events reach the UI.
//! 3. Frontend issues `realtime_set_watch_set` whenever the user adds/removes
//!    wallets or collections; the manager diffs the new set against the live
//!    subscriptions and adds/removes accordingly.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::data::alchemy::{AlchemyHttpClient, AlchemyProvider};
use crate::data::provider::ProviderResult;
use crate::data::realtime::event_router;
use crate::data::realtime::price_poller::PricePoller;
use crate::data::types::SubscriptionId;

/// What the frontend wants us to watch right now.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSet {
    /// Wallet addresses (incoming + outgoing tx subscription).
    pub wallets: Vec<String>,
    /// NFT collection contract addresses (Transfer event subscription).
    pub collections: Vec<String>,
    /// ERC-20 / native token symbols to keep priced in real time.
    pub price_symbols: Vec<String>,
    /// Whether to subscribe to newHeads (gas tracker / block clock).
    pub subscribe_blocks: bool,
}

/// Active per-purpose subscription handles so we can selectively drop them on
/// watch-set updates rather than restarting everything.
#[derive(Default)]
struct ActiveSubscriptions {
    wallet_tx: Option<SubscriptionId>,
    collection_transfers: Option<SubscriptionId>,
    new_heads: Option<SubscriptionId>,
}

pub struct RealtimeManager {
    provider: Arc<AlchemyProvider>,
    state: Arc<Mutex<ActiveSubscriptions>>,
    last_set: Arc<Mutex<WatchSet>>,
    poller: Arc<PricePoller>,
    started: Arc<Mutex<bool>>,
}

impl RealtimeManager {
    pub fn new(provider: AlchemyProvider, http: Arc<AlchemyHttpClient>) -> Self {
        Self {
            provider: Arc::new(provider),
            state: Arc::new(Mutex::new(ActiveSubscriptions::default())),
            last_set: Arc::new(Mutex::new(WatchSet::default())),
            poller: Arc::new(PricePoller::new(http)),
            started: Arc::new(Mutex::new(false)),
        }
    }

    /// Cheap copy for cloning into closures.
    pub fn provider(&self) -> Arc<AlchemyProvider> { Arc::clone(&self.provider) }

    /// Start the event-drain loop and price poller. Idempotent.
    pub fn start(&self, app_handle: AppHandle) {
        let started = Arc::clone(&self.started);
        let provider = Arc::clone(&self.provider);
        let poller = Arc::clone(&self.poller);
        let app_for_loop = app_handle.clone();

        tokio::spawn(async move {
            {
                let mut g = started.lock().await;
                if *g { return; }
                *g = true;
            }
            poller.start(app_handle);

            // Drain WS events into Tauri events. The WS manager itself has
            // already buffered them in its pending queue.
            loop {
                let events = provider.ws().drain_pending().await;
                for ev in events {
                    event_router::emit(&app_for_loop, &ev);
                }
                tokio::time::sleep(Duration::from_millis(150)).await;
            }
        });
    }

    /// Replace the live watch set. Subscriptions are diffed:
    /// - if wallets changed → re-subscribe wallet stream
    /// - if collections changed → re-subscribe collection stream
    /// - newHeads is on/off based on `subscribe_blocks`
    /// - price symbols are added to the poller (the poller never subtracts —
    ///   stale symbols just stop being touched and stay on the slow cadence).
    pub async fn apply_watch_set(&self, set: WatchSet) -> ProviderResult<()> {
        let mut last = self.last_set.lock().await;
        let mut active = self.state.lock().await;
        let provider = &self.provider;

        // Wallets
        let wallets_changed = !set_eq(&set.wallets, &last.wallets);
        if wallets_changed {
            if let Some(prev) = active.wallet_tx.take() {
                let _ = provider.ws().unsubscribe(prev).await;
            }
            if !set.wallets.is_empty() {
                let id = provider.ws().subscribe_mined_transactions(&set.wallets).await?;
                active.wallet_tx = Some(id);
            }
        }

        // Collections
        let collections_changed = !set_eq(&set.collections, &last.collections);
        if collections_changed {
            if let Some(prev) = active.collection_transfers.take() {
                let _ = provider.ws().unsubscribe(prev).await;
            }
            if !set.collections.is_empty() {
                let id = provider.ws().subscribe_collection_transfers(&set.collections).await?;
                active.collection_transfers = Some(id);
            }
        }

        // Blocks
        if set.subscribe_blocks && active.new_heads.is_none() {
            let id = provider.ws().subscribe_new_heads().await?;
            active.new_heads = Some(id);
        } else if !set.subscribe_blocks {
            if let Some(prev) = active.new_heads.take() {
                let _ = provider.ws().unsubscribe(prev).await;
            }
        }

        // Prices
        let symbol_refs: Vec<&str> = set.price_symbols.iter().map(|s| s.as_str()).collect();
        self.poller.watch_many(&symbol_refs).await;

        *last = set;
        Ok(())
    }

    pub fn poller(&self) -> Arc<PricePoller> { Arc::clone(&self.poller) }
}

fn set_eq(a: &[String], b: &[String]) -> bool {
    let sa: HashSet<&String> = a.iter().collect();
    let sb: HashSet<&String> = b.iter().collect();
    sa == sb
}
