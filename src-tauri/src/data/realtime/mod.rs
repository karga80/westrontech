//! Real-time orchestration layer.
//!
//! Sits between the Alchemy WebSocket manager (raw event source) and the
//! Tauri frontend (event consumer). Responsibilities:
//!
//! 1. **Lifecycle** — start/stop subscriptions on demand, hold the singleton
//!    `RealtimeManager` registered as Tauri state.
//! 2. **Routing** — fan events out as Tauri events the frontend can `listen()`
//!    to (`emit_to(...)`).
//! 3. **Reconcile** — on connection drop/restore, fetch a delta via REST so
//!    the UI never silently misses data.
//! 4. **Adaptive price polling** — Alchemy doesn't push prices; a separate
//!    poller loops every 5–30s depending on activity.

pub mod manager;
pub mod price_poller;
pub mod event_router;

pub use manager::{RealtimeManager, WatchSet};
pub use event_router::{EVENT_WALLET_TX, EVENT_NFT_TRANSFER, EVENT_NEW_BLOCK, EVENT_PRICE_TICK, EVENT_CONNECTION};
