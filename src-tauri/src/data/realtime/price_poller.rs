//! Adaptive price poller.
//!
//! Alchemy's Prices API is REST-only — no push. We hold a small in-memory
//! cache and a single poller task that re-fetches at an interval that scales
//! with how recently the UI asked for the data:
//!
//! - Active (frontend touched the cache in the last 60s): every 5s
//! - Idle  (no recent touch):                              every 30s
//!
//! The poller emits `WalletEvent::PriceTick` so the UI updates without
//! having to poll Tauri commands itself.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::data::alchemy::AlchemyHttpClient;
use crate::data::alchemy::prices;
use crate::data::realtime::event_router;
use crate::data::types::WalletEvent;

/// Cached price entry — last value and when it was queried.
#[derive(Debug, Clone)]
struct CacheEntry {
    usd: f64,
    last_updated_at: String,
    last_touched: Instant,
}

#[derive(Default)]
struct PollerState {
    /// symbol → cache entry
    by_symbol: HashMap<String, CacheEntry>,
    /// running flag — second `start` call is a no-op
    running: bool,
}

pub struct PricePoller {
    http: Arc<AlchemyHttpClient>,
    state: Arc<Mutex<PollerState>>,
}

impl PricePoller {
    pub fn new(http: Arc<AlchemyHttpClient>) -> Self {
        Self {
            http,
            state: Arc::new(Mutex::new(PollerState::default())),
        }
    }

    /// Add a symbol to the active watch list. Calling this also marks the
    /// entry as "recently touched", so the loop bumps to fast cadence.
    pub async fn watch(&self, symbol: &str) {
        let mut s = self.state.lock().await;
        let entry = s.by_symbol.entry(symbol.to_uppercase()).or_insert(CacheEntry {
            usd: 0.0,
            last_updated_at: String::new(),
            last_touched: Instant::now(),
        });
        entry.last_touched = Instant::now();
    }

    pub async fn watch_many(&self, symbols: &[&str]) {
        for s in symbols { self.watch(s).await; }
    }

    pub async fn snapshot(&self) -> Vec<(String, f64, String)> {
        let s = self.state.lock().await;
        s.by_symbol.iter()
            .map(|(sym, e)| (sym.clone(), e.usd, e.last_updated_at.clone()))
            .collect()
    }

    /// Spawn the background loop (idempotent — second call is a no-op).
    pub fn start(self: &Arc<Self>, app_handle: AppHandle) {
        let me = Arc::clone(self);
        tokio::spawn(async move {
            {
                let mut s = me.state.lock().await;
                if s.running { return; }
                s.running = true;
            }

            loop {
                // Snapshot symbols and decide cadence.
                let (symbols, fast) = {
                    let s = me.state.lock().await;
                    let symbols: Vec<String> = s.by_symbol.keys().cloned().collect();
                    let fast = s.by_symbol.values().any(|e| e.last_touched.elapsed() < Duration::from_secs(60));
                    (symbols, fast)
                };

                if !symbols.is_empty() {
                    let symbol_refs: Vec<&str> = symbols.iter().map(|s| s.as_str()).collect();
                    match prices::get_prices_by_symbol(&me.http, &symbol_refs).await {
                        Ok(quotes) => {
                            let mut s = me.state.lock().await;
                            for q in &quotes {
                                if let Some(usd) = q.usd {
                                    let entry = s.by_symbol.entry(q.symbol.clone()).or_insert(CacheEntry {
                                        usd: 0.0,
                                        last_updated_at: String::new(),
                                        last_touched: Instant::now(),
                                    });
                                    entry.usd = usd;
                                    entry.last_updated_at = q.last_updated_at.clone().unwrap_or_default();
                                }
                            }
                            // Emit each tick separately so subscribers can listen by symbol.
                            drop(s);
                            for q in quotes {
                                if let Some(usd) = q.usd {
                                    event_router::emit(&app_handle, &WalletEvent::PriceTick {
                                        symbol: q.symbol,
                                        usd,
                                        last_updated_at: q.last_updated_at.unwrap_or_default(),
                                    });
                                }
                            }
                        }
                        Err(e) => log::warn!("price_poller: {e}"),
                    }
                }

                sleep(if fast { Duration::from_secs(5) } else { Duration::from_secs(30) }).await;
            }
        });
    }
}
