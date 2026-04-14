//! Tauri event names + helpers for emitting `WalletEvent`s to the frontend.
//!
//! The frontend listens with `listen('westron:wallet:tx', ...)` etc. Keeping
//! the channel names in one place avoids string drift between Rust and TS.

use tauri::{AppHandle, Emitter};

use crate::data::types::WalletEvent;

pub const EVENT_WALLET_TX: &str       = "westron:wallet:tx";
pub const EVENT_NFT_TRANSFER: &str    = "westron:nft:transfer";
pub const EVENT_NEW_BLOCK: &str       = "westron:block:new";
pub const EVENT_PRICE_TICK: &str      = "westron:price:tick";
pub const EVENT_CONNECTION: &str      = "westron:realtime:connection";

/// Push one `WalletEvent` to the matching frontend channel.
/// Errors are logged but never bubbled — emit failures must not kill the loop.
pub fn emit(handle: &AppHandle, event: &WalletEvent) {
    let (channel, payload) = match event {
        WalletEvent::WalletTx { .. }            => (EVENT_WALLET_TX,    serde_json::to_value(event)),
        WalletEvent::CollectionTransfer { .. }  => (EVENT_NFT_TRANSFER, serde_json::to_value(event)),
        WalletEvent::NewBlock { .. }            => (EVENT_NEW_BLOCK,    serde_json::to_value(event)),
        WalletEvent::PriceTick { .. }           => (EVENT_PRICE_TICK,   serde_json::to_value(event)),
        WalletEvent::ConnectionState { .. }     => (EVENT_CONNECTION,   serde_json::to_value(event)),
    };

    let payload = match payload {
        Ok(v) => v,
        Err(e) => { log::warn!("event_router serialize: {e}"); return; }
    };

    if let Err(e) = handle.emit(channel, payload) {
        log::warn!("event_router emit({channel}): {e}");
    }
}
