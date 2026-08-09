//! In-app control server.
//!
//! A loopback-only HTTP surface over the same module functions the Tauri
//! commands wrap, so Claude (via the `westron-mcp` stdio shim) can drive
//! Westron while the app is running. It lives inside the app process on
//! purpose: `EnvelopeEngine` state is in-memory, and a second process would
//! hold a different envelope — making the kill switch meaningless.
//!
//! Security posture:
//! * binds `127.0.0.1` only, never `0.0.0.0`;
//! * every route requires `Authorization: Bearer <token>`;
//! * the token is a 32-byte random hex string in a 0600 file;
//! * API keys are read from `wallet::keychain` inside handlers and never
//!   appear in a request parameter, a response body, or a log line.

pub mod routes;
pub mod scheduler;
pub mod token;

use std::sync::Arc;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;

use crate::envelope::engine::EnvelopeEngine;
use scheduler::SchedulerHandle;

/// Default loopback port; override with `WESTRON_CONTROL_PORT`.
pub const DEFAULT_PORT: u16 = 7777;

#[derive(Clone)]
pub struct ControlState {
    pub token: Arc<String>,
    pub envelope: Arc<EnvelopeEngine>,
    pub scheduler: Arc<SchedulerHandle>,
    pub app: tauri::AppHandle,
}

fn port_from_env() -> u16 {
    std::env::var("WESTRON_CONTROL_PORT")
        .ok()
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(DEFAULT_PORT)
}

/// Bearer auth on every route. Missing, malformed, or wrong token → 401.
async fn require_bearer(State(st): State<ControlState>, req: Request, next: Next) -> Response {
    let presented = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|v| v.trim().to_string());

    let ok = match presented {
        Some(ref p) => token::constant_time_eq(p, st.token.as_str()),
        None => false,
    };

    if !ok {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "unauthorized — send Authorization: Bearer <token> from the control-token file"
            })),
        )
            .into_response();
    }
    next.run(req).await
}

pub fn build_router(state: ControlState) -> Router {
    Router::new()
        .route("/status", get(routes::status))
        .route("/portfolio/{address}", get(routes::portfolio))
        .route("/floor/{contract}", get(routes::floor))
        .route("/rules", get(routes::list_rules).post(routes::create_rule))
        .route("/rules/{id}", delete(routes::delete_rule))
        .route("/rules/{id}/active", post(routes::set_rule_active))
        // One path pattern: axum cannot register two different parameter names
        // at the same position. GET reads it as a wallet, DELETE as a rule id.
        .route(
            "/alerts/{wallet_or_id}",
            get(routes::list_alerts).delete(routes::delete_alert),
        )
        .route("/alerts", post(routes::create_alert))
        .route(
            "/envelope",
            post(routes::create_envelope).delete(routes::revoke_envelope),
        )
        .route("/kill-switch", post(routes::kill_switch))
        // Read-only: asks the envelope a question without spending any of it.
        .route("/preview-transaction", post(routes::preview_transaction))
        .route("/snipe-check", post(routes::snipe_check))
        .route("/scheduler", post(routes::scheduler))
        .fallback(routes::not_found)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_bearer,
        ))
        .with_state(state)
}

/// Start the control server and the snipe scheduler.
///
/// Called from `run()`'s `setup` hook, where the `AppHandle` needed for event
/// emission exists. Failures are logged and swallowed — the desktop app must
/// still start if, say, the port is already taken.
pub fn start(envelope: Arc<EnvelopeEngine>, app: tauri::AppHandle) -> Arc<SchedulerHandle> {
    // The loop DEFAULTS to disabled on purpose. Westron runs on a free Alchemy
    // tier where concurrent-call bursts have already produced real 429s, and the
    // product's sequencing is monitoring first, automation last. An always-on
    // 15s floor poll from first launch would spend that quota indefinitely for
    // a feature whose output is currently a simulated tx hash. Claude turns it
    // on deliberately via POST /scheduler {"enabled": true}; /status and
    // POST /rules both say so in plain language so nobody assumes a freshly
    // created rule is armed.
    //
    // That default applies to a *first* launch only. Once armed, the flag is
    // persisted and restored here — previously it silently reset to off on
    // every restart, so a user who turned the loop on found it disarmed the
    // next morning with no indication anything had changed.
    let sched = Arc::new(SchedulerHandle::load_or_new(false));
    scheduler::spawn(sched.clone(), envelope.clone(), app.clone());

    let token = match token::ensure_token() {
        Ok(t) => t,
        Err(e) => {
            log::error!("control server disabled — could not prepare control token: {e}");
            return sched;
        }
    };

    let state = ControlState {
        token: Arc::new(token),
        envelope,
        scheduler: sched.clone(),
        app,
    };

    let port = port_from_env();
    tauri::async_runtime::spawn(async move {
        let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                log::error!("control server could not bind {addr}: {e}");
                return;
            }
        };
        log::info!("control server listening on http://{addr} (loopback only)");
        if let Err(e) = axum::serve(listener, build_router(state)).await {
            log::error!("control server stopped: {e}");
        }
    });

    sched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn port_defaults_and_respects_env() {
        std::env::remove_var("WESTRON_CONTROL_PORT");
        assert_eq!(port_from_env(), DEFAULT_PORT);
        std::env::set_var("WESTRON_CONTROL_PORT", "8123");
        assert_eq!(port_from_env(), 8123);
        std::env::set_var("WESTRON_CONTROL_PORT", "not-a-port");
        assert_eq!(port_from_env(), DEFAULT_PORT);
        std::env::remove_var("WESTRON_CONTROL_PORT");
    }
}
