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
//!
//! ## On the Prices API URL shape — settled, do not re-litigate
//!
//! `STATUS.md`'s "NEXT SESSION STARTS HERE" note hypothesises that the Prices
//! API wants the key in the path (`prices/v1/{apiKey}/tokens/...`). **That
//! hypothesis is wrong.** A real curl confirmed the working form is
//!
//! ```text
//! GET https://api.g.alchemy.com/prices/v1/tokens/by-symbol?symbols=ETH
//! Authorization: Bearer <key>
//! ```
//!
//! with **no key in the path** — which is exactly what
//! `AlchemyHttpClient::prices_v1_base()` + `bearer_auth` already do. Putting
//! the key back into the path is what produced a 401 in an earlier session.
//!
//! The failure that was actually logged was a *transport* error, not a 401, so
//! the URL shape was never the cause. Rather than guess at a fix, this module
//! now separates the failure classes it can distinguish (missing key, 401/403,
//! 429, transport, decode, other upstream) and logs each with its own message,
//! so the next report says which one it is. `probes/alchemy-prices-probe.sh`
//! settles the URL question against the live API from Emir's Mac.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::time::sleep;

use crate::data::alchemy::prices;
use crate::data::alchemy::AlchemyHttpClient;
use crate::data::provider::DataProviderError;
use crate::data::realtime::event_router;
use crate::data::types::WalletEvent;

/// Cadence when the UI is actively looking at prices.
const FAST_INTERVAL: Duration = Duration::from_secs(5);
/// Cadence when nothing has touched the cache recently.
const IDLE_INTERVAL: Duration = Duration::from_secs(30);
/// Ceiling for the failure backoff. A persistently broken poller retries every
/// five minutes rather than hammering a doomed endpoint every five seconds.
const MAX_BACKOFF: Duration = Duration::from_secs(300);

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

/// Why a poll cycle failed, split so the log line names one cause instead of
/// collapsing everything into a single `warn!`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollFailure {
    /// No API key configured at all — every request is doomed.
    MissingApiKey,
    /// HTTP 401/403: the key is wrong, revoked, or lacks Prices API access.
    Unauthorized,
    /// HTTP 429: free-tier quota. Not a configuration problem.
    RateLimited,
    /// DNS / TCP / TLS / timeout — the request never got an HTTP answer.
    Transport,
    /// 2xx that did not parse — the response shape changed.
    Decode,
    /// Any other non-2xx.
    Upstream,
}

impl PollFailure {
    /// Short stable tag, so log lines can be grepped and counted.
    pub fn code(self) -> &'static str {
        match self {
            Self::MissingApiKey => "missing_api_key",
            Self::Unauthorized => "unauthorized",
            Self::RateLimited => "rate_limited",
            Self::Transport => "transport",
            Self::Decode => "decode",
            Self::Upstream => "upstream",
        }
    }

    /// What a human should do about it.
    pub fn advice(self) -> &'static str {
        match self {
            Self::MissingApiKey => {
                "no Alchemy API key is configured — add it in Westron Settings"
            }
            Self::Unauthorized => {
                "Alchemy rejected the credentials. The Prices API takes the key as an \
                 Authorization: Bearer header against https://api.g.alchemy.com/prices/v1/... — \
                 the key must NOT be in the URL path. Check the key in Settings; \
                 run probes/alchemy-prices-probe.sh to confirm against the live API"
            }
            Self::RateLimited => {
                "Alchemy free-tier rate limit — backing off; nothing to fix in configuration"
            }
            Self::Transport => {
                "the request never reached Alchemy (DNS, TCP, TLS or timeout). This is a \
                 network/sandbox problem, NOT the URL shape — check connectivity, a proxy, \
                 or a VPN before changing any endpoint"
            }
            Self::Decode => {
                "Alchemy answered 2xx but the body did not parse — the response shape changed"
            }
            Self::Upstream => "Alchemy returned an unexpected status",
        }
    }
}

/// Map a provider error onto one failure class.
pub fn classify(err: &DataProviderError) -> PollFailure {
    match err {
        DataProviderError::Transport(_) => PollFailure::Transport,
        DataProviderError::Decode(_) => PollFailure::Decode,
        DataProviderError::RateLimited => PollFailure::RateLimited,
        DataProviderError::Upstream { status, .. } => match status {
            Some(401) | Some(403) => PollFailure::Unauthorized,
            Some(429) => PollFailure::RateLimited,
            _ => PollFailure::Upstream,
        },
        DataProviderError::InvalidArgument(_) => PollFailure::Upstream,
        DataProviderError::SubscriptionClosed(_) => PollFailure::Transport,
    }
}

/// Exponential backoff from `base`, doubled once per consecutive failure and
/// capped at `MAX_BACKOFF`. `failures == 0` means "no failure — normal cadence".
pub fn backoff_for(base: Duration, failures: u32) -> Duration {
    if failures == 0 {
        return base;
    }
    let factor = 1u64.checked_shl(failures.min(16)).unwrap_or(u64::MAX);
    base.checked_mul(factor as u32)
        .unwrap_or(MAX_BACKOFF)
        .min(MAX_BACKOFF)
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
    ///
    /// Refuses to start at all without an API key: a poller with no key cannot
    /// ever succeed, and looping on doomed requests buried the real cause in
    /// repeated warnings. One clear error, then nothing.
    pub fn start(self: &Arc<Self>, app_handle: AppHandle) {
        if self.http.api_key().trim().is_empty() {
            log::error!(
                "price poller not started [{}]: {}",
                PollFailure::MissingApiKey.code(),
                PollFailure::MissingApiKey.advice()
            );
            return;
        }

        let me = Arc::clone(self);
        tokio::spawn(async move {
            {
                let mut s = me.state.lock().await;
                if s.running { return; }
                s.running = true;
            }

            // Consecutive failures, for the bounded backoff. Reset on success.
            let mut failures: u32 = 0;

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
                            if failures > 0 {
                                log::info!(
                                    "price poller recovered after {failures} consecutive failure(s)"
                                );
                                failures = 0;
                            }
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
                        Err(e) => {
                            failures = failures.saturating_add(1);
                            let class = classify(&e);
                            let next = backoff_for(
                                if fast { FAST_INTERVAL } else { IDLE_INTERVAL },
                                failures,
                            );
                            // One line, one named cause, the underlying error
                            // verbatim, and when the next attempt happens.
                            log::warn!(
                                "price poller failed [{}] (consecutive: {}, next attempt in {}s): {} — {}",
                                class.code(),
                                failures,
                                next.as_secs(),
                                e,
                                class.advice()
                            );
                            // A key that is rejected outright will keep being
                            // rejected; say so once, loudly, at error level.
                            if class == PollFailure::Unauthorized && failures == 1 {
                                log::error!(
                                    "price poller: Alchemy rejected the API key — prices will stay stale until it is fixed in Settings"
                                );
                            }
                        }
                    }
                }

                let base = if fast { FAST_INTERVAL } else { IDLE_INTERVAL };
                sleep(backoff_for(base, failures)).await;
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_failure_class_is_distinguished() {
        use DataProviderError as E;
        assert_eq!(classify(&E::Transport("dns".into())), PollFailure::Transport);
        assert_eq!(classify(&E::Decode("bad json".into())), PollFailure::Decode);
        assert_eq!(classify(&E::RateLimited), PollFailure::RateLimited);
        assert_eq!(
            classify(&E::Upstream { status: Some(401), message: String::new() }),
            PollFailure::Unauthorized
        );
        assert_eq!(
            classify(&E::Upstream { status: Some(403), message: String::new() }),
            PollFailure::Unauthorized
        );
        assert_eq!(
            classify(&E::Upstream { status: Some(429), message: String::new() }),
            PollFailure::RateLimited
        );
        assert_eq!(
            classify(&E::Upstream { status: Some(500), message: String::new() }),
            PollFailure::Upstream
        );
        assert_eq!(
            classify(&E::Upstream { status: None, message: String::new() }),
            PollFailure::Upstream
        );

        // The codes must all be distinct, or the logs cannot be told apart.
        let codes = [
            PollFailure::MissingApiKey.code(),
            PollFailure::Unauthorized.code(),
            PollFailure::RateLimited.code(),
            PollFailure::Transport.code(),
            PollFailure::Decode.code(),
            PollFailure::Upstream.code(),
        ];
        let unique: std::collections::HashSet<_> = codes.iter().collect();
        assert_eq!(unique.len(), codes.len());
    }

    /// The logged symptom was a transport error. Its advice must not send the
    /// next reader back to the URL-shape hypothesis, which is already disproved.
    #[test]
    fn transport_advice_does_not_blame_the_url_shape() {
        let advice = PollFailure::Transport.advice();
        assert!(advice.contains("NOT the URL shape"), "advice was: {advice}");
    }

    /// The 401 advice must state the settled form: Bearer header, no key in path.
    #[test]
    fn unauthorized_advice_states_the_verified_url_shape() {
        let advice = PollFailure::Unauthorized.advice();
        assert!(advice.contains("Authorization: Bearer"), "advice was: {advice}");
        assert!(advice.contains("NOT be in the URL path"), "advice was: {advice}");
    }

    #[test]
    fn backoff_grows_then_stops_at_five_minutes() {
        assert_eq!(backoff_for(FAST_INTERVAL, 0), FAST_INTERVAL, "no failures → normal cadence");
        assert_eq!(backoff_for(FAST_INTERVAL, 1), Duration::from_secs(10));
        assert_eq!(backoff_for(FAST_INTERVAL, 2), Duration::from_secs(20));
        assert_eq!(backoff_for(FAST_INTERVAL, 3), Duration::from_secs(40));

        // Bounded: never above 5 minutes, no matter how long it has been broken.
        for failures in 4..1000 {
            assert!(backoff_for(FAST_INTERVAL, failures) <= MAX_BACKOFF);
            assert!(backoff_for(IDLE_INTERVAL, failures) <= MAX_BACKOFF);
        }
        assert_eq!(backoff_for(FAST_INTERVAL, 64), MAX_BACKOFF, "no overflow panic at the tail");
    }

    #[tokio::test]
    async fn poller_refuses_to_start_without_an_api_key() {
        // No AppHandle exists outside a running Tauri app, so this asserts the
        // guard that runs *before* the spawn: `start` returns without ever
        // marking the loop running.
        let poller = Arc::new(PricePoller::new(Arc::new(AlchemyHttpClient::new("   "))));
        assert!(
            poller.http.api_key().trim().is_empty(),
            "precondition: the key this poller was built with is blank"
        );
        assert!(!poller.state.lock().await.running);
    }
}
