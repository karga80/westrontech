//! Offline-capable, tamper-resistant subscription licensing.
//!
//! Flow (account + bearer-token, matching `subscription-worker/src/index.ts`):
//!   1. The user signs up or logs in with email + password
//!      (`POST /signup` / `POST /login` — `{email, password}`). The worker
//!      returns a session `token`, the account record, and an already-signed
//!      **license** for that account in the same response.
//!   2. The app stores the bearer token (Keychain) and the signed license
//!      (disk cache — see below), then on every later check calls
//!      `POST /license` with `Authorization: Bearer <token>` to get a fresh
//!      signed license. The response shape is `{ access, license: { payload,
//!      sig } }`; `payload` is a JSON string `{account_id, email, active,
//!      reason, plan, expires_at, issued_at}` (no wallet field — identity is
//!      the account, not an address).
//!   3. The app verifies `license.sig` with the PUBLIC key embedded below
//!      before ever reading `payload`, then caches the license on disk. From
//!      then on it re-verifies the cached license **offline** — no network
//!      needed.
//!
//! Why it can't be cheated:
//!   - Editing the cached license (e.g. pushing out `expires_at`) breaks the
//!     signature, so verification fails.
//!   - Rolling the system clock back doesn't buy time: we clamp "now" to the
//!     highest timestamp we've ever seen (`last_seen`), which only moves forward.
//!   - The offline fallback only trusts a cached license whose signed
//!     `account_id` matches the account the *currently stored* session token
//!     authenticates as — a stale license left behind by a previous account
//!     on the same machine is never read as if it were the current user's.
//!
//! The private key never ships in the app and never touches the user's machine.
//!
//! There is deliberately no wallet-based fallback path: the previous protocol
//! (`{wallet}` → unauthenticated top-level `{active, payload, sig}`) is gone.
//! A response shaped like that fails to deserialize into [`Payload`] (no
//! `account_id` field) rather than being silently accepted — see the
//! `old_wallet_shaped_payload_is_rejected` test below.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::wallet::keychain;

/// ED25519 public key (raw 32 bytes, base64) matching the worker's signing key.
///
/// PRODUCTION: regenerate a keypair, set the private key as the worker secret
/// `LICENSE_SIGNING_KEY`, and replace this value with the new public key.
/// See `subscription-worker/DEPLOY.md`.
const LICENSE_PUBLIC_KEY_B64: &str = "w1+T3XMFDkUASvJ0iNLuH7i7tyMNcGx/229uLO17wnM=";

/// Deployed worker base URL.
pub const WORKER_URL: &str = "https://westron-subscription.ebaltepe.workers.dev";

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionCheckResult {
    pub active: bool,
    pub plan: Option<String>,
    pub expires_at: Option<String>, // ISO 8601
    pub error: Option<String>,
}

impl SubscriptionCheckResult {
    fn error(message: impl Into<String>) -> Self {
        Self { active: false, plan: None, expires_at: None, error: Some(message.into()) }
    }
}

/// The signed envelope returned by the worker and cached on disk.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct License {
    /// Exact JSON string that was signed (verified verbatim, never re-serialized).
    pub payload: String,
    /// Base64 ed25519 signature over `payload`'s UTF-8 bytes.
    pub sig: String,
}

/// Decoded license contents. No `wallet` field — the old protocol is gone, not
/// bridged: a payload shaped like the old one fails to deserialize here.
#[derive(Debug, Serialize, Deserialize)]
struct Payload {
    account_id: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    active: bool,
    #[serde(default)]
    reason: String,
    plan: Option<String>,
    expires_at: Option<i64>, // unix seconds; None = never subscribed
    #[serde(default)]
    issued_at: i64,
}

/// What we persist locally to know "who is currently logged in": the bearer
/// token (secret — lives in the Keychain, never on disk) plus the account
/// identity it authenticates, so the offline cache-validation path can refuse
/// a license left behind by a different account.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredSession {
    token: String,
    account_id: String,
    email: String,
}

/// What the worker sends back from `/signup` and `/login`.
#[derive(Debug, Deserialize)]
struct AuthResponse {
    token: String,
    account: AccountInfo,
    license: License,
}

#[derive(Debug, Deserialize)]
struct AccountInfo {
    id: String,
    #[allow(dead_code)]
    email: String,
}

/// What the worker sends back from `/license`.
#[derive(Debug, Deserialize)]
struct LicenseResponse {
    license: License,
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn data_dir() -> Result<PathBuf, String> {
    let base = dirs_next::data_dir().ok_or("no data dir")?;
    let dir = base.join("Westron").join("subscription");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn license_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("license.json"))
}

fn seen_path() -> Result<PathBuf, String> {
    Ok(data_dir()?.join("last_seen"))
}

/// Highest timestamp ever observed — monotonic anti-rollback anchor.
fn last_seen() -> i64 {
    seen_path()
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0)
}

/// Advance `last_seen` to max(stored, system_now). Never moves backward.
fn record_seen() {
    let n = now_unix();
    let prev = last_seen();
    let next = n.max(prev);
    if let Ok(p) = seen_path() {
        let _ = std::fs::write(p, next.to_string());
    }
}

/// "Now" for expiry checks: the later of system clock and last_seen, so a
/// rolled-back clock can never resurrect an expired license.
fn effective_now() -> i64 {
    now_unix().max(last_seen())
}

fn verifying_key() -> Result<VerifyingKey, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(LICENSE_PUBLIC_KEY_B64)
        .map_err(|e| format!("bad public key: {e}"))?;
    let arr: [u8; 32] = bytes.as_slice().try_into().map_err(|_| "public key must be 32 bytes")?;
    VerifyingKey::from_bytes(&arr).map_err(|e| format!("invalid public key: {e}"))
}

/// Verify a license signature and return its decoded payload. Never read
/// `license.payload` for any purpose before this succeeds.
fn verify(license: &License) -> Result<Payload, String> {
    let vk = verifying_key()?;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&license.sig)
        .map_err(|e| format!("bad signature encoding: {e}"))?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|e| format!("bad signature: {e}"))?;
    vk.verify_strict(license.payload.as_bytes(), &sig)
        .map_err(|_| "license signature does not verify".to_string())?;
    serde_json::from_str::<Payload>(&license.payload).map_err(|e| format!("bad payload: {e}"))
}

fn iso(expires_at: i64) -> Option<String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(expires_at, 0).map(|dt| dt.to_rfc3339())
}

/// Turn a verified payload into a status result, applying the anti-rollback clock.
/// A payload with no `expires_at` (never subscribed, no trial left) is inactive.
fn result_from(payload: &Payload) -> SubscriptionCheckResult {
    let active = matches!(payload.expires_at, Some(exp) if exp > effective_now());
    SubscriptionCheckResult {
        active,
        plan: if active { payload.plan.clone() } else { None },
        expires_at: if active { payload.expires_at.and_then(iso) } else { None },
        error: None,
    }
}

fn store_license(license: &License) {
    if let Ok(p) = license_path() {
        if let Ok(s) = serde_json::to_string(license) {
            let _ = std::fs::write(p, s);
        }
    }
}

fn load_license() -> Option<License> {
    let p = license_path().ok()?;
    let s = std::fs::read_to_string(p).ok()?;
    serde_json::from_str::<License>(&s).ok()
}

fn store_session(session: &StoredSession) -> Result<(), String> {
    let json = serde_json::to_string(session).map_err(|e| e.to_string())?;
    keychain::store_subscription_token(&json)
}

fn load_session() -> Option<StoredSession> {
    let raw = keychain::fetch_subscription_token().ok()?;
    serde_json::from_str::<StoredSession>(&raw).ok()
}

/// Map the worker's `{error, message}` bodies to a message a non-developer
/// can act on. Unknown codes still surface the raw code and HTTP status
/// rather than a generic "something went wrong".
fn explain_auth_error(code: &str, status: u16) -> String {
    match code {
        "invalid_email" => "Please enter a valid email address.".to_string(),
        "weak_password" => "Password must be at least 8 characters.".to_string(),
        "email_taken" => {
            "An account with this email already exists. Try logging in instead.".to_string()
        }
        "invalid_credentials" => "Incorrect email or password.".to_string(),
        "invalid_json" => "Malformed request — please try again.".to_string(),
        other => format!("Subscription server error ({status}): {other}"),
    }
}

/// Sign up for a new account. Stores the session token and the returned
/// license (both offline-verified) on success.
pub async fn signup(email: &str, password: &str) -> Result<SubscriptionCheckResult, String> {
    let body = auth_request("/signup", email, password).await?;
    finish_auth(body)
}

/// Log in to an existing account. Stores the session token and the returned
/// license (both offline-verified) on success.
pub async fn login(email: &str, password: &str) -> Result<SubscriptionCheckResult, String> {
    let body = auth_request("/login", email, password).await?;
    finish_auth(body)
}

/// Forget the current session and its cached license. Does not contact the
/// worker (no server-side session revocation endpoint besides `/logout`,
/// which is not required for correctness here — the token simply stops being
/// used and eventually expires server-side).
pub fn logout() -> Result<(), String> {
    if let Ok(p) = license_path() {
        let _ = std::fs::remove_file(p);
    }
    keychain::delete_subscription_token()
}

/// Email of the currently logged-in account, if any — for display only.
/// Never returns the token itself.
pub fn current_account_email() -> Option<String> {
    load_session().map(|s| s.email)
}

async fn auth_request(path: &str, email: &str, password: &str) -> Result<AuthResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{WORKER_URL}{path}"))
        .header("content-type", "application/json")
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .map_err(|e| format!("Could not reach the subscription server: {e}"))?;

    let status = resp.status();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Unexpected response from subscription server: {e}"))?;

    if !status.is_success() {
        let code = body
            .get("error")
            .and_then(|v| v.as_str())
            .or_else(|| body.get("message").and_then(|v| v.as_str()))
            .unwrap_or("request_failed");
        return Err(explain_auth_error(code, status.as_u16()));
    }

    serde_json::from_value::<AuthResponse>(body)
        .map_err(|e| format!("Unexpected response shape from subscription server: {e}"))
}

/// Verify the license embedded in a signup/login response, persist the
/// session + license, and return the resulting status. The account id inside
/// the *signed* payload — not the unsigned `account` field alongside it — is
/// what gets trusted and stored.
fn finish_auth(body: AuthResponse) -> Result<SubscriptionCheckResult, String> {
    let payload = verify(&body.license).map_err(|e| format!("Invalid license from server: {e}"))?;
    if payload.account_id != body.account.id {
        return Err("License account mismatch — refusing to trust this response.".to_string());
    }

    let session = StoredSession {
        token: body.token,
        account_id: payload.account_id.clone(),
        email: payload.email.clone(),
    };
    store_session(&session)?;
    store_license(&body.license);
    record_seen();

    Ok(result_from(&payload))
}

/// Outcome of asking the worker for a fresh license.
enum FetchOutcome {
    /// Session token is no longer valid — caller must log in again.
    Unauthorized,
    /// Network/server problem; caller should fall back to the offline cache.
    Unreachable(String),
}

async fn fetch_license(token: &str) -> Result<License, FetchOutcome> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| FetchOutcome::Unreachable(e.to_string()))?;

    let resp = client
        .post(format!("{WORKER_URL}/license"))
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| FetchOutcome::Unreachable(e.to_string()))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(FetchOutcome::Unauthorized);
    }
    if !resp.status().is_success() {
        return Err(FetchOutcome::Unreachable(format!("worker status {}", resp.status())));
    }

    let body: LicenseResponse = resp
        .json()
        .await
        .map_err(|e| FetchOutcome::Unreachable(e.to_string()))?;
    Ok(body.license)
}

/// Evaluate subscription status for the currently logged-in account: fetch a
/// fresh signed license when online, otherwise fall back to the cached one —
/// always verifying the signature, always checking the license's signed
/// account id against the session that's actually stored.
pub async fn evaluate() -> SubscriptionCheckResult {
    record_seen();

    let session = match load_session() {
        Some(s) => s,
        None => {
            return SubscriptionCheckResult::error(
                "Not logged in. Sign up or log in to check subscription status.",
            )
        }
    };

    match fetch_license(&session.token).await {
        Ok(license) => match verify(&license) {
            Ok(payload) if payload.account_id == session.account_id => {
                store_license(&license);
                result_from(&payload)
            }
            Ok(_) => SubscriptionCheckResult::error(
                "License account mismatch — the server returned a license for a different account.",
            ),
            Err(e) => SubscriptionCheckResult::error(format!("Invalid license from server: {e}")),
        },
        Err(FetchOutcome::Unauthorized) => {
            // The token itself is invalid/expired — this is not "offline", it
            // is "no longer authenticated". Clear it so the UI asks the user
            // to log in again rather than silently reusing a dead session.
            let _ = keychain::delete_subscription_token();
            SubscriptionCheckResult::error("Session expired. Please log in again.")
        }
        // Network/server problem — fall back to the cached, signed license.
        // The underlying reason is kept (not swallowed) for the case where
        // there's no usable cache either, so the user sees why, not just "no".
        Err(FetchOutcome::Unreachable(reason)) => match load_license() {
            Some(license) => match verify(&license) {
                Ok(payload) if payload.account_id == session.account_id => {
                    let mut r = result_from(&payload);
                    if !r.active {
                        r.error = Some("Subscription expired (offline).".to_string());
                    }
                    r
                }
                _ => SubscriptionCheckResult::error(
                    "Offline and no valid cached license for this account.",
                ),
            },
            None => SubscriptionCheckResult::error(format!(
                "Offline and no cached license. Connect once to activate. ({reason})"
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tampered_payload_fails_verification() {
        // A syntactically valid but unsigned license must not verify.
        let bad = License {
            payload: r#"{"account_id":"abc","email":"a@b.com","active":true,"reason":"paid","plan":"annual","expires_at":9999999999,"issued_at":0}"#.to_string(),
            sig: base64::engine::general_purpose::STANDARD.encode([0u8; 64]),
        };
        assert!(verify(&bad).is_err());
    }

    #[test]
    fn public_key_is_valid() {
        assert!(verifying_key().is_ok());
    }

    #[test]
    fn effective_now_never_below_last_seen() {
        // effective_now is max(system_now, last_seen); it is always >= last_seen.
        assert!(effective_now() >= last_seen());
    }

    /// The whole point of T13: the old wallet-based payload must not be
    /// silently accepted by the new decoder. No backward-compat bridge.
    #[test]
    fn old_wallet_shaped_payload_is_rejected() {
        let old = r#"{"wallet":"0xabc","plan":"annual","expires_at":9999999999,"issued_at":0}"#;
        let parsed = serde_json::from_str::<Payload>(old);
        assert!(
            parsed.is_err(),
            "old wallet-shaped payload must not deserialize into the new account-shaped Payload"
        );
    }

    #[test]
    fn result_from_is_inactive_when_expires_at_is_missing() {
        let payload = Payload {
            account_id: "acct1".to_string(),
            email: "a@b.com".to_string(),
            active: false,
            reason: "none".to_string(),
            plan: None,
            expires_at: None,
            issued_at: 0,
        };
        let r = result_from(&payload);
        assert!(!r.active);
        assert!(r.plan.is_none());
        assert!(r.expires_at.is_none());
    }

    #[test]
    fn result_from_is_inactive_once_expired_even_if_payload_says_active() {
        // Anti-rollback: we recompute from expires_at vs effective_now, never
        // trust the payload's own `active` snapshot at issue time.
        let payload = Payload {
            account_id: "acct1".to_string(),
            email: "a@b.com".to_string(),
            active: true,
            reason: "paid".to_string(),
            plan: Some("monthly".to_string()),
            expires_at: Some(1), // 1970 — long expired
            issued_at: 0,
        };
        let r = result_from(&payload);
        assert!(!r.active);
    }

    #[test]
    fn stored_session_round_trips_through_json() {
        let s = StoredSession {
            token: "tok".to_string(),
            account_id: "acct1".to_string(),
            email: "a@b.com".to_string(),
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: StoredSession = serde_json::from_str(&json).unwrap();
        assert_eq!(back.token, "tok");
        assert_eq!(back.account_id, "acct1");
        assert_eq!(back.email, "a@b.com");
    }

    #[test]
    fn explain_auth_error_maps_known_codes_to_readable_text() {
        assert_eq!(
            explain_auth_error("email_taken", 409),
            "An account with this email already exists. Try logging in instead."
        );
        assert_eq!(
            explain_auth_error("invalid_credentials", 401),
            "Incorrect email or password."
        );
        assert_eq!(
            explain_auth_error("weak_password", 400),
            "Password must be at least 8 characters."
        );
    }

    #[test]
    fn explain_auth_error_surfaces_unknown_codes_instead_of_hiding_them() {
        let msg = explain_auth_error("something_new", 500);
        assert!(msg.contains("something_new"));
        assert!(msg.contains("500"));
    }
}
