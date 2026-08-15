use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;

use super::ControlState;
use crate::{alerts, analytics, rpc, sniping, wallet};

// ── Error type ────────────────────────────────────────────────────────────────

/// Plain `String` errors, matching the rest of the codebase, wrapped so axum can
/// turn them into a JSON body. API keys never reach this type.
pub struct ApiError(StatusCode, String);

impl ApiError {
    fn bad_request(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::BAD_REQUEST, msg.into())
    }
    fn internal(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::INTERNAL_SERVER_ERROR, msg.into())
    }
    fn precondition(msg: impl Into<String>) -> Self {
        ApiError(StatusCode::PRECONDITION_FAILED, msg.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

type ApiResult = Result<Json<serde_json::Value>, ApiError>;

/// Envelope TTL used when `POST /envelope` omits `ttl_hours`. Deliberately far
/// tighter than the 168h ceiling — a guardrail default should err short.
const DEFAULT_ENVELOPE_TTL_HOURS: u64 = 24;

/// Read the Alchemy key from the keychain layer. The key is required by every
/// on-chain read; it is never accepted as a request parameter and never echoed.
fn alchemy_key() -> Result<String, ApiError> {
    let key = wallet::keychain::fetch_alchemy_key().map_err(|_| {
        ApiError::precondition("Alchemy API key not configured — add it in Westron Settings first.")
    })?;
    if key.trim().is_empty() {
        return Err(ApiError::precondition(
            "Alchemy API key is empty — add it in Westron Settings first.",
        ));
    }
    Ok(key)
}

// ── Request bodies ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ActiveBody {
    pub active: bool,
}

#[derive(Debug, Deserialize)]
pub struct EnvelopeBody {
    pub per_tx_ceiling_eth: f64,
    pub hard_cap_eth: f64,
    pub scope_addresses: Vec<String>,
    #[serde(default)]
    pub ttl_hours: Option<u64>,
}

/// Body for `POST /preview-transaction`. `value_wei` is a decimal wei string —
/// wei does not survive a round trip through a JSON number.
#[derive(Debug, Deserialize)]
pub struct PreviewBody {
    pub to: String,
    pub value_wei: String,
    #[serde(default)]
    pub calldata: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SchedulerBody {
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub interval_secs: Option<u64>,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /status — everything an operator needs to decide whether the loop is alive.
pub async fn status(State(st): State<ControlState>) -> ApiResult {
    let envelope_status = st.envelope.get_status();
    let kill_switch = envelope_status
        .as_ref()
        .map(|s| s.kill_switch)
        .unwrap_or(false);

    let (active_rules, rules_error) =
        match sniping::ensure_db().and_then(|p| sniping::db::count_active_rules(&p)) {
            Ok(n) => (n, None),
            Err(e) => (0, Some(e)),
        };

    let scheduler = st.scheduler.snapshot();
    let scheduler_hint = scheduler.hint();

    Ok(Json(json!({
        "app_version": env!("CARGO_PKG_VERSION"),
        "envelope": envelope_status,
        "kill_switch": kill_switch,
        "scheduler": scheduler,
        "scheduler_hint": scheduler_hint,
        "active_rule_count": active_rules,
        "rules_error": rules_error,
        "alchemy_key_configured": wallet::keychain::fetch_alchemy_key()
            .map(|k| !k.trim().is_empty())
            .unwrap_or(false),
        // Where secrets actually live, and whether any plaintext key file is
        // still sitting on disk after the one-time migration. `pending > 0`
        // means a private key could not be confirmed inside the Keychain and
        // was therefore left where it was — that needs a human.
        "keychain": wallet::keychain::keychain_status(),
    })))
}

/// GET /portfolio/{address}
pub async fn portfolio(Path(address): Path<String>) -> ApiResult {
    let key = alchemy_key()?;
    let snapshot = analytics::engine::get_portfolio_snapshot(address, key)
        .await
        .map_err(ApiError::internal)?;
    serde_json::to_value(snapshot)
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// GET /floor/{contract} — `contract` must be an ERC-721/1155 CONTRACT ADDRESS.
pub async fn floor(Path(contract): Path<String>) -> ApiResult {
    let key = alchemy_key()?;
    let client = rpc::client::AlchemyClient::new(&key);
    let floor = client
        .get_floor_price(&contract)
        .await
        .map_err(ApiError::internal)?;
    serde_json::to_value(floor)
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// GET /rules — all rules, or just one wallet's with `?wallet=0x...`.
pub async fn list_rules(Query(q): Query<HashMap<String, String>>) -> ApiResult {
    let db_path = sniping::ensure_db().map_err(ApiError::internal)?;
    let rules = match q.get("wallet").or_else(|| q.get("wallet_address")) {
        Some(w) => sniping::db::list_rules(&db_path, w).map_err(ApiError::internal)?,
        None => sniping::db::list_all_rules(&db_path).map_err(ApiError::internal)?,
    };
    Ok(Json(json!({ "rules": rules, "count": rules.len() })))
}

/// POST /rules
pub async fn create_rule(
    State(st): State<ControlState>,
    Json(input): Json<sniping::SnipeRuleInput>,
) -> ApiResult {
    if input.collection_slug.trim().is_empty() {
        return Err(ApiError::bad_request(
            "collection_slug is required and must be a contract address (0x…), not an OpenSea slug",
        ));
    }
    if input.wallet_address.trim().is_empty() {
        return Err(ApiError::bad_request("wallet_address is required"));
    }
    if !(input.target_price_eth > 0.0) {
        return Err(ApiError::bad_request(
            "target_price_eth must be greater than 0",
        ));
    }
    if input.max_quantity == 0 {
        return Err(ApiError::bad_request("max_quantity must be at least 1"));
    }
    // Same gate as the `create_snipe_rule` command. This endpoint cannot raise a
    // Touch ID prompt — there is no user in front of an HTTP call — so it cannot
    // arm the wallet itself. What it must not do is write a rule that looks
    // created and is inert: `execute_snipe` refuses to fire on a disarmed
    // wallet, so accepting here would be a silent failure with a 200 on it.
    if !crate::wallet::armed::is_armed(&input.wallet_address) {
        return Err(ApiError::bad_request(
            "wallet is not armed — arm it in Westron with Touch ID before creating a rule for it, \
             otherwise the rule is stored but can never fire",
        ));
    }
    let db_path = sniping::ensure_db().map_err(ApiError::internal)?;
    let id = sniping::db::create_rule(&db_path, &input).map_err(ApiError::internal)?;
    let created = sniping::db::list_rules(&db_path, &input.wallet_address)
        .map_err(ApiError::internal)?
        .into_iter()
        .find(|r| r.id == id);
    // A rule created while the loop is off will never fire by itself. Say so in
    // the response rather than letting the caller assume it is armed.
    let scheduler = st.scheduler.snapshot();
    Ok(Json(json!({
        "id": id,
        "rule": created,
        "scheduler_enabled": scheduler.enabled,
        "hint": scheduler.hint(),
    })))
}

/// DELETE /rules/{id}
pub async fn delete_rule(Path(id): Path<String>) -> ApiResult {
    let db_path = sniping::ensure_db().map_err(ApiError::internal)?;
    sniping::db::delete_rule(&db_path, &id).map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": id })))
}

/// POST /rules/{id}/active
pub async fn set_rule_active(Path(id): Path<String>, Json(body): Json<ActiveBody>) -> ApiResult {
    let db_path = sniping::ensure_db().map_err(ApiError::internal)?;
    sniping::db::set_rule_active(&db_path, &id, body.active).map_err(ApiError::internal)?;
    Ok(Json(json!({ "id": id, "active": body.active })))
}

/// GET /alerts/{wallet}
pub async fn list_alerts(Path(wallet): Path<String>) -> ApiResult {
    let db_path = alerts::ensure_db().map_err(ApiError::internal)?;
    let rules = alerts::db::list_alerts(&db_path, &wallet).map_err(ApiError::internal)?;
    Ok(Json(json!({ "alerts": rules, "count": rules.len() })))
}

/// POST /alerts
pub async fn create_alert(Json(input): Json<alerts::AlertRuleInput>) -> ApiResult {
    if input.wallet_address.trim().is_empty() {
        return Err(ApiError::bad_request("wallet_address is required"));
    }
    if !matches!(input.condition.as_str(), "above" | "below") {
        return Err(ApiError::bad_request(
            "condition must be \"above\" or \"below\"",
        ));
    }
    let db_path = alerts::ensure_db().map_err(ApiError::internal)?;
    let id = alerts::db::create_alert(&db_path, &input).map_err(ApiError::internal)?;
    Ok(Json(json!({ "id": id })))
}

/// DELETE /alerts/{id}
pub async fn delete_alert(Path(id): Path<String>) -> ApiResult {
    let db_path = alerts::ensure_db().map_err(ApiError::internal)?;
    alerts::db::delete_alert(&db_path, &id).map_err(ApiError::internal)?;
    Ok(Json(json!({ "deleted": id })))
}

/// POST /envelope
pub async fn create_envelope(
    State(st): State<ControlState>,
    Json(body): Json<EnvelopeBody>,
) -> ApiResult {
    if body.scope_addresses.is_empty() {
        return Err(ApiError::bad_request(
            "scope_addresses must contain at least one address — an empty scope authorises nothing",
        ));
    }
    let requested_ttl = body.ttl_hours.unwrap_or(DEFAULT_ENVELOPE_TTL_HOURS);
    let applied_ttl = requested_ttl.min(crate::envelope::MAX_TTL_HOURS);
    let env = crate::envelope::build_envelope(
        body.per_tx_ceiling_eth,
        body.hard_cap_eth,
        body.scope_addresses,
        requested_ttl,
    );
    let envelope_id = env.id.to_string();
    let expires_at = env.expires_at;
    st.envelope.create_envelope(env);
    // Always report the expiry that was actually applied — a caller who omitted
    // ttl_hours should learn here that the envelope dies in 24 hours, not later.
    Ok(Json(json!({
        "envelope_id": envelope_id,
        "expires_at": expires_at,
        "expires_at_rfc3339": chrono::DateTime::from_timestamp(expires_at, 0)
            .map(|t| t.to_rfc3339()),
        "ttl_hours_applied": applied_ttl,
        "ttl_hours_defaulted": body.ttl_hours.is_none(),
        "hint": format!(
            "Envelope active for {applied_ttl} hour(s); it expires at the timestamp above and \
             authorises nothing afterwards.{}",
            if body.ttl_hours.is_none() {
                " No ttl_hours was supplied, so the 24 hour default was applied."
            } else if requested_ttl > applied_ttl {
                " The requested TTL exceeded the 168 hour cap and was clamped."
            } else {
                ""
            }
        ),
    })))
}

/// DELETE /envelope
pub async fn revoke_envelope(State(st): State<ControlState>) -> ApiResult {
    st.envelope.revoke();
    Ok(Json(json!({ "revoked": true })))
}

/// POST /kill-switch — `{"active": true}` engages, `false` releases.
pub async fn kill_switch(
    State(st): State<ControlState>,
    Json(body): Json<ActiveBody>,
) -> ApiResult {
    if body.active {
        st.envelope.activate_kill_switch();
    } else {
        st.envelope.deactivate_kill_switch();
    }
    Ok(Json(json!({
        "kill_switch": body.active,
        "envelope": st.envelope.get_status(),
    })))
}

/// POST /preview-transaction — would this transfer be authorised right now?
///
/// Read-only. Runs every guard the real authorisation runs and changes
/// nothing: no spend recorded, no kill switch engaged, no audit entry, no
/// write to disk. Safe to call as often as a UI likes.
///
/// The consuming path is the Tauri `check_transaction` command / the actual
/// send; this endpoint exists so nothing has to spend budget to ask a question.
pub async fn preview_transaction(
    State(st): State<ControlState>,
    Json(body): Json<PreviewBody>,
) -> ApiResult {
    if body.to.trim().is_empty() {
        return Err(ApiError::bad_request("to is required"));
    }
    let value_wei: u128 = body.value_wei.trim().parse().map_err(|_| {
        ApiError::bad_request(format!(
            "value_wei must be a decimal wei amount, got {:?}",
            body.value_wei
        ))
    })?;
    let request = crate::envelope::types::TransactionRequest {
        to: body.to,
        value_wei,
        calldata: body.calldata.unwrap_or_default(),
    };
    let preview = st.envelope.preview(&request);
    serde_json::to_value(preview)
        .map(Json)
        .map_err(|e| ApiError::internal(e.to_string()))
}

/// POST /snipe-check — run one check immediately, without waiting for the loop.
pub async fn snipe_check(
    State(st): State<ControlState>,
    body: Option<Json<serde_json::Value>>,
) -> ApiResult {
    // The body is accepted but ignored: every active rule is checked. Kept so
    // callers may POST `{}` (or nothing at all) without a 415/422.
    let _ = body;
    let key = alchemy_key()?;
    let db_path = sniping::ensure_db().map_err(ApiError::internal)?;
    let expired = sniping::db::deactivate_expired_rules(&db_path).unwrap_or(0);
    let engine = sniping::engine::SnipingEngine::new(db_path);
    let results = engine
        .check_snipe_rules(&key, &st.envelope, &st.app)
        .await
        .map_err(ApiError::internal)?;
    let triggered = results.iter().filter(|r| r.triggered).count();
    Ok(Json(json!({
        "checked_at": chrono::Utc::now().to_rfc3339(),
        "expired_deactivated": expired,
        "triggered": triggered,
        "results": results,
    })))
}

/// POST /scheduler — enable/disable the loop or change its cadence.
pub async fn scheduler(
    State(st): State<ControlState>,
    body: Option<Json<SchedulerBody>>,
) -> ApiResult {
    let (enabled, interval) = match body {
        Some(Json(b)) => (b.enabled, b.interval_secs),
        None => (None, None),
    };
    let status = st.scheduler.configure(enabled, interval);
    let hint = status.hint();
    let mut value = serde_json::to_value(status).map_err(|e| ApiError::internal(e.to_string()))?;
    if let Some(obj) = value.as_object_mut() {
        obj.insert("hint".to_string(), json!(hint));
    }
    Ok(Json(value))
}

/// Fallback for unmatched paths — keeps the shim's error messages JSON-shaped.
pub async fn not_found() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "no such endpoint".to_string())
}
