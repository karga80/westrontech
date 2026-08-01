//! Offline-capable, tamper-resistant subscription licensing.
//!
//! Flow:
//!   1. User pays ETH to the payment wallet (detected by the Cloudflare worker
//!      via an Alchemy address-activity webhook — no server holds any keys).
//!   2. The app asks the worker `POST /license {wallet}`. If the wallet has an
//!      active subscription the worker returns a **signed license**:
//!         { payload: "<json string>", sig: "<base64 ed25519 signature>" }
//!      signed with the worker's ED25519 private key (a Cloudflare secret).
//!   3. The app verifies the signature with the PUBLIC key embedded below,
//!      then caches the license on disk. From then on it re-verifies the cached
//!      license **offline** — no network needed.
//!
//! Why it can't be cheated:
//!   - Editing the cached license (e.g. pushing out `expires_at`) breaks the
//!     signature, so verification fails.
//!   - Rolling the system clock back doesn't buy time: we clamp "now" to the
//!     highest timestamp we've ever seen (`last_seen`), which only moves forward.
//!
//! The private key never ships in the app and never touches the user's machine.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};

/// ED25519 public key (raw 32 bytes, base64) matching the worker's signing key.
///
/// PRODUCTION: regenerate a keypair, set the private key as the worker secret
/// `LICENSE_SIGNING_KEY`, and replace this value with the new public key.
/// See `subscription-worker/DEPLOY.md`.
const LICENSE_PUBLIC_KEY_B64: &str = "w1+T3XMFDkUASvJ0iNLuH7i7tyMNcGx/229uLO17wnM=";

/// Deployed worker base URL. Replace `YOUR_SUBDOMAIN` after `wrangler deploy`.
pub const WORKER_URL: &str = "https://westron-subscription.ebaltepe.workers.dev";

#[derive(Debug, Serialize, Deserialize)]
pub struct SubscriptionCheckResult {
    pub active: bool,
    pub plan: Option<String>,
    pub expires_at: Option<String>, // ISO 8601
    pub error: Option<String>,
}

/// The signed envelope returned by the worker and cached on disk.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct License {
    /// Exact JSON string that was signed (verified verbatim, never re-serialized).
    pub payload: String,
    /// Base64 ed25519 signature over `payload`'s UTF-8 bytes.
    pub sig: String,
}

/// Decoded license contents.
#[derive(Debug, Serialize, Deserialize)]
struct Payload {
    wallet: String,
    plan: String,
    expires_at: i64, // unix seconds
    #[serde(default)]
    issued_at: i64,
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

/// Verify a license signature and return its decoded payload.
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
fn result_from(payload: &Payload) -> SubscriptionCheckResult {
    let active = payload.expires_at > effective_now();
    SubscriptionCheckResult {
        active,
        plan: if active { Some(payload.plan.clone()) } else { None },
        expires_at: if active { iso(payload.expires_at) } else { None },
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

/// Evaluate subscription for `wallet`: fetch a fresh signed license when online,
/// otherwise fall back to the cached one — always verifying the signature.
pub async fn evaluate(wallet: &str) -> SubscriptionCheckResult {
    record_seen();

    let addr = wallet.trim().to_lowercase();
    if addr.is_empty() {
        return SubscriptionCheckResult {
            active: false, plan: None, expires_at: None,
            error: Some("No wallet address provided".to_string()),
        };
    }

    // 1) Try to fetch a fresh signed license from the worker.
    let online = fetch_license(&addr).await;
    match online {
        Ok(Some(license)) => match verify(&license) {
            Ok(payload) if payload.wallet.to_lowercase() == addr => {
                store_license(&license);
                result_from(&payload)
            }
            Ok(_) => SubscriptionCheckResult {
                active: false, plan: None, expires_at: None,
                error: Some("License wallet mismatch".to_string()),
            },
            Err(e) => SubscriptionCheckResult {
                active: false, plan: None, expires_at: None,
                error: Some(format!("Invalid license from server: {e}")),
            },
        },
        // Worker reachable but wallet has no active subscription.
        Ok(None) => {
            // Clear any stale cached license for this wallet.
            if let Some(cached) = load_license() {
                if let Ok(p) = verify(&cached) {
                    if p.wallet.to_lowercase() == addr {
                        let _ = license_path().map(std::fs::remove_file);
                    }
                }
            }
            SubscriptionCheckResult { active: false, plan: None, expires_at: None, error: None }
        }
        // 2) Offline — fall back to the cached, signed license.
        Err(_) => match load_license() {
            Some(license) => match verify(&license) {
                Ok(payload) if payload.wallet.to_lowercase() == addr => {
                    let mut r = result_from(&payload);
                    if !r.active {
                        r.error = Some("Subscription expired (offline).".to_string());
                    }
                    r
                }
                _ => SubscriptionCheckResult {
                    active: false, plan: None, expires_at: None,
                    error: Some("Offline and no valid cached license for this wallet.".to_string()),
                },
            },
            None => SubscriptionCheckResult {
                active: false, plan: None, expires_at: None,
                error: Some("Offline and no cached license. Connect once to activate.".to_string()),
            },
        },
    }
}

/// Returns Ok(Some(license)) if the worker issued one, Ok(None) if the wallet has
/// no active subscription, Err if the worker is unreachable.
async fn fetch_license(addr: &str) -> Result<Option<License>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/license", WORKER_URL))
        .header("content-type", "application/json")
        .json(&serde_json::json!({ "wallet": addr }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("worker status {}", resp.status()));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    // Worker returns { active: false } when there is no subscription.
    if body.get("active").and_then(|v| v.as_bool()) == Some(false) {
        return Ok(None);
    }

    let payload = body.get("payload").and_then(|v| v.as_str());
    let sig = body.get("sig").and_then(|v| v.as_str());
    match (payload, sig) {
        (Some(p), Some(s)) => Ok(Some(License { payload: p.to_string(), sig: s.to_string() })),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tampered_payload_fails_verification() {
        // A syntactically valid but unsigned license must not verify.
        let bad = License {
            payload: r#"{"wallet":"0xabc","plan":"annual","expires_at":9999999999,"issued_at":0}"#.to_string(),
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
}
