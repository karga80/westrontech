use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Utc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::envelope::types::*;
use crate::envelope::audit::AuditLog;

/// File that holds the envelope across restarts, next to the app's SQLite DBs.
pub const STATE_FILE: &str = "envelope-state.json";

mod u128_as_string {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u128, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u128, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

pub struct EnvelopeEngine {
    pub envelope: Mutex<Option<Envelope>>,
    pub audit: AuditLog,
    /// Where the envelope is persisted. `None` means memory-only (tests).
    store: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvelopeStatus {
    pub active: bool,
    pub kill_switch: bool,
    #[serde(with = "u128_as_string")]
    pub spent_wei: u128,
    #[serde(with = "u128_as_string")]
    pub hard_cap_wei: u128,
    /// Largest single transaction this envelope allows. Additive field: it was
    /// missing entirely, so a caller could not tell a user why one transfer was
    /// refused when a smaller one to the same address would go through.
    #[serde(with = "u128_as_string")]
    pub per_tx_ceiling_wei: u128,
    pub expires_at: i64,
}

/// Which guard refused a transaction. Stable machine-readable codes — the same
/// strings the audit log already writes as `reject_reason` — so a UI can branch
/// on them instead of pattern-matching a `Debug` rendering.
pub mod reject_code {
    pub const NO_ENVELOPE: &str = "no_envelope";
    pub const KILL_SWITCH: &str = "kill_switch";
    pub const EXPIRED: &str = "expired";
    pub const NO_SCOPE: &str = "no_scope";
    pub const OUT_OF_SCOPE: &str = "out_of_scope";
    pub const PER_TX_CEILING: &str = "per_tx_ceiling";
    pub const HARD_CAP: &str = "hard_cap";
}

/// Read-only verdict from [`EnvelopeEngine::preview`]. Carries everything a
/// caller needs to render a precise refusal without re-deriving a single limit
/// itself — that re-derivation is exactly what the frontend had to do while no
/// non-consuming check existed.
///
/// Every wei quantity is a decimal string: these do not fit in a JS number and
/// the frontend already works in BigInt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransactionPreview {
    /// Would `check_and_authorize` accept this transaction right now?
    pub authorized: bool,
    /// One of `reject_code::*` when `authorized` is false.
    pub reject_code: Option<String>,
    /// A sentence fit to show the user.
    pub reject_reason: Option<String>,
    /// `Debug` form of the underlying `EnvelopeError`, identical to what
    /// `check_transaction` puts in its `reject_reason` field, so any existing
    /// error handling keeps working against this too.
    pub reject_detail: Option<String>,

    pub envelope_active: bool,
    pub kill_switch: bool,
    pub expires_at: Option<i64>,
    /// Is `request.to` within the envelope's scope? Reported independently of
    /// `authorized` so a UI can flag a bad destination even when some earlier
    /// guard (kill switch, expiry) is what actually refused.
    pub in_scope: bool,

    /// The value that was previewed, echoed back.
    pub value_wei: String,
    pub per_tx_ceiling_wei: Option<String>,
    pub hard_cap_wei: Option<String>,
    pub spent_wei: Option<String>,
    /// `hard_cap_wei - spent_wei`: how much this envelope will still authorise.
    pub remaining_wei: Option<String>,
}

impl EnvelopeEngine {
    /// Memory-only engine. Nothing it does touches the persisted state file.
    pub fn new() -> Self {
        EnvelopeEngine {
            envelope: Mutex::new(None),
            audit: AuditLog::new(),
            store: None,
        }
    }

    /// Engine backed by `path`, restoring whatever was persisted there.
    ///
    /// Restore rules, both of which fail closed:
    /// * an envelope whose `expires_at` has passed is NOT restored as active —
    ///   a restart must not resurrect an expired authorisation;
    /// * everything else is restored verbatim, including `spent_wei` and
    ///   `kill_switch_active`. Dropping `spent_wei` would reset the hard cap on
    ///   every restart, which is the entire point of having one; dropping the
    ///   kill switch would silently re-arm an account the user had stopped.
    pub fn with_store(path: PathBuf) -> Self {
        let restored: Option<Envelope> = match crate::persist::read_json::<Option<Envelope>>(&path) {
            Ok(Some(Some(env))) => {
                let now = Utc::now().timestamp();
                if now >= env.expires_at {
                    log::info!(
                        "envelope from a previous session had already expired; not restored"
                    );
                    None
                } else {
                    log::info!(
                        "restored envelope {} — kill switch {}, expires at {}",
                        env.id,
                        if env.kill_switch_active { "ENGAGED" } else { "off" },
                        env.expires_at
                    );
                    Some(env)
                }
            }
            Ok(_) => None,
            Err(e) => {
                // Unreadable state is treated as "no authorisation", never as
                // "no limits". Surfaced loudly so it is not mistaken for a
                // clean first run.
                log::error!("could not read persisted envelope ({e}); starting with none");
                None
            }
        };

        let engine = EnvelopeEngine {
            envelope: Mutex::new(restored),
            audit: AuditLog::new(),
            store: Some(path),
        };
        // Normalise the file so an expired envelope is not re-evaluated forever.
        engine.persist(&engine.envelope.lock().unwrap());
        engine
    }

    /// Engine backed by the standard app-data location. Falls back to
    /// memory-only if the data directory cannot be determined — the app still
    /// starts, it just cannot remember the envelope.
    pub fn load_or_new() -> Self {
        match crate::persist::app_file(STATE_FILE) {
            Ok(path) => Self::with_store(path),
            Err(e) => {
                log::error!("envelope persistence disabled — {e}");
                Self::new()
            }
        }
    }

    /// Write the current envelope to disk. Best-effort: a failure is logged,
    /// never propagated, because losing persistence must not break a
    /// transaction check that has already been decided in memory.
    fn persist(&self, current: &Option<Envelope>) {
        let Some(path) = self.store.as_ref() else { return };
        if let Err(e) = crate::persist::write_json(path, current) {
            log::error!("could not persist envelope state: {e}");
        }
    }

    pub fn create_envelope(&self, env: Envelope) {
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: AuditEvent::EnvelopeCreated,
            tx_to: None,
            value_wei: None,
            reject_reason: None,
            spent_wei_snapshot: 0,
        };
        let _ = self.audit.write_entry(&entry);
        let mut guard = self.envelope.lock().unwrap();
        *guard = Some(env);
        self.persist(&guard);
    }

    /// **The** guard implementation. Pure: it reads an envelope and a request,
    /// decides, and touches nothing.
    ///
    /// Both `check_and_authorize` (which consumes budget) and `preview` (which
    /// does not) route through this one function. Duplicating these rules would
    /// be a money bug waiting to happen: a ceiling enforced on one path and not
    /// the other is worse than having no preview at all.
    ///
    /// The order is part of the contract — kill switch, expiry, scope, per-tx
    /// ceiling, hard cap — so a caller is always told the most fundamental
    /// reason first.
    fn evaluate(
        env: &Envelope,
        request: &TransactionRequest,
        now: i64,
    ) -> Result<(), EnvelopeError> {
        if env.kill_switch_active {
            return Err(EnvelopeError::KillSwitchActive);
        }
        if now >= env.expires_at {
            return Err(EnvelopeError::EnvelopeExpired { expired_at: env.expires_at });
        }
        if env.scope.is_empty() {
            return Err(EnvelopeError::NoScopeDefined);
        }
        if !Self::is_in_scope(env, &request.to) {
            return Err(EnvelopeError::AddressOutOfScope { requested: request.to.clone() });
        }
        if request.value_wei > env.per_tx_ceiling_wei {
            return Err(EnvelopeError::PerTxCeilingExceeded {
                requested_wei: request.value_wei,
                ceiling_wei: env.per_tx_ceiling_wei,
            });
        }
        let new_spent = env.spent_wei.checked_add(request.value_wei).unwrap_or(u128::MAX);
        if new_spent > env.hard_cap_wei {
            return Err(EnvelopeError::HardCapExceeded {
                remaining_wei: env.hard_cap_wei.saturating_sub(env.spent_wei),
                requested_wei: request.value_wei,
            });
        }
        Ok(())
    }

    fn is_in_scope(env: &Envelope, to: &str) -> bool {
        let to_lower = to.to_lowercase();
        env.scope.iter().any(|a| a.to_lowercase() == to_lower)
    }

    /// **Consumes budget — not a pre-flight check.**
    ///
    /// On success this adds `value_wei` to `spent_wei` and persists it. Calling
    /// it twice for one transfer therefore charges the spend cap twice, and for
    /// any value above half the remaining headroom the second call trips the
    /// automatic kill switch without a single wei having moved.
    ///
    /// Call it exactly once, immediately before signing. To ask "would this be
    /// allowed?" use [`EnvelopeEngine::preview`], which runs these identical
    /// guards and mutates nothing.
    pub fn check_and_authorize(&self, request: &TransactionRequest) -> Result<(), EnvelopeError> {
        let mut guard = self.envelope.lock().unwrap();
        let now = Utc::now().timestamp();

        let verdict = {
            let env = guard.as_ref().ok_or(EnvelopeError::NoScopeDefined)?;
            Self::evaluate(env, request, now)
        };

        if let Err(err) = verdict {
            let hard_cap_breach = matches!(err, EnvelopeError::HardCapExceeded { .. });
            {
                let env = guard.as_mut().expect("envelope presence checked above");
                match &err {
                    EnvelopeError::KillSwitchActive => {
                        self.log_reject(env, AuditEvent::KillSwitchBlocked, request, "kill_switch");
                    }
                    EnvelopeError::EnvelopeExpired { .. } => {
                        self.log_reject(env, AuditEvent::EnvelopeExpired, request, "expired");
                    }
                    // Unchanged from before: an empty scope is not audited.
                    EnvelopeError::NoScopeDefined => {}
                    EnvelopeError::AddressOutOfScope { .. } => {
                        self.log_reject(env, AuditEvent::ScopeViolation, request, "out_of_scope");
                    }
                    EnvelopeError::PerTxCeilingExceeded { .. } => {
                        self.log_reject(
                            env,
                            AuditEvent::PerTxCeilingViolation,
                            request,
                            "per_tx_ceiling",
                        );
                    }
                    EnvelopeError::HardCapExceeded { .. } => {
                        // E4-B: Otomatik kill switch
                        env.kill_switch_active = true;
                        self.log_reject(env, AuditEvent::HardCapViolation, request, "hard_cap");
                        let kill_entry = AuditEntry {
                            id: Uuid::new_v4(),
                            timestamp: Utc::now().timestamp_millis(),
                            envelope_id: env.id,
                            event_type: AuditEvent::KillSwitchActivated,
                            tx_to: None, value_wei: None, reject_reason: None,
                            spent_wei_snapshot: env.spent_wei,
                        };
                        let _ = self.audit.write_entry(&kill_entry);
                    }
                    // `evaluate` never produces these; they come from callers.
                    EnvelopeError::KeychainError { .. } | EnvelopeError::SigningError { .. } => {}
                }
            }
            if hard_cap_breach {
                // The auto-engaged kill switch has to survive a restart, or the
                // breach that tripped it is forgotten when the app next opens.
                self.persist(&guard);
            }
            return Err(err);
        }

        let env = guard.as_mut().expect("envelope presence checked above");
        env.spent_wei = env.spent_wei.checked_add(request.value_wei).unwrap_or(u128::MAX);
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: AuditEvent::TxAuthorized,
            tx_to: Some(request.to.clone()),
            value_wei: Some(request.value_wei),
            reject_reason: None,
            spent_wei_snapshot: env.spent_wei,
        };
        let _ = self.audit.write_entry(&entry);
        // Persist the new spend before returning Ok: the caller is about to
        // sign, and a crash between here and the next write must not hand the
        // user back their full hard cap.
        self.persist(&guard);
        Ok(())
    }

    /// **Read-only.** Runs exactly the guards `check_and_authorize` runs and
    /// reports the verdict without touching `spent_wei`, without engaging the
    /// kill switch, without writing an audit entry and without persisting
    /// anything.
    ///
    /// This is what a pre-flight check should call. Using
    /// `check_and_authorize` for that purpose charges the spend cap for a
    /// transaction that never happens.
    pub fn preview(&self, request: &TransactionRequest) -> TransactionPreview {
        let guard = self.envelope.lock().unwrap();
        let now = Utc::now().timestamp();

        let Some(env) = guard.as_ref() else {
            return TransactionPreview {
                authorized: false,
                reject_code: Some(reject_code::NO_ENVELOPE.to_string()),
                reject_reason: Some(
                    "No spend envelope is active. Create one before sending — Westron \
                     authorises nothing without it."
                        .to_string(),
                ),
                reject_detail: Some(format!("{:?}", EnvelopeError::NoScopeDefined)),
                envelope_active: false,
                kill_switch: false,
                expires_at: None,
                in_scope: false,
                value_wei: request.value_wei.to_string(),
                per_tx_ceiling_wei: None,
                hard_cap_wei: None,
                spent_wei: None,
                remaining_wei: None,
            };
        };

        let remaining = env.hard_cap_wei.saturating_sub(env.spent_wei);
        let verdict = Self::evaluate(env, request, now);
        let (code, reason) = match &verdict {
            Ok(()) => (None, None),
            Err(e) => {
                let (c, r) = Self::describe(e, env, request);
                (Some(c.to_string()), Some(r))
            }
        };

        TransactionPreview {
            authorized: verdict.is_ok(),
            reject_code: code,
            reject_reason: reason,
            reject_detail: verdict.as_ref().err().map(|e| format!("{e:?}")),
            envelope_active: true,
            kill_switch: env.kill_switch_active,
            expires_at: Some(env.expires_at),
            in_scope: Self::is_in_scope(env, &request.to),
            value_wei: request.value_wei.to_string(),
            per_tx_ceiling_wei: Some(env.per_tx_ceiling_wei.to_string()),
            hard_cap_wei: Some(env.hard_cap_wei.to_string()),
            spent_wei: Some(env.spent_wei.to_string()),
            remaining_wei: Some(remaining.to_string()),
        }
    }

    /// Machine code + a sentence a user can act on, for one guard failure.
    fn describe(
        err: &EnvelopeError,
        env: &Envelope,
        request: &TransactionRequest,
    ) -> (&'static str, String) {
        let eth = |wei: u128| format!("{:.6} ETH", wei as f64 / 1e18);
        match err {
            EnvelopeError::KillSwitchActive => (
                reject_code::KILL_SWITCH,
                "The kill switch is engaged. Every transaction is blocked until it is released."
                    .to_string(),
            ),
            EnvelopeError::EnvelopeExpired { expired_at } => (
                reject_code::EXPIRED,
                format!(
                    "The spend envelope expired at {}. Create a new one to send.",
                    chrono::DateTime::from_timestamp(*expired_at, 0)
                        .map(|t| t.to_rfc3339())
                        .unwrap_or_else(|| expired_at.to_string())
                ),
            ),
            EnvelopeError::NoScopeDefined => (
                reject_code::NO_SCOPE,
                "The envelope has an empty scope, so it authorises no destination at all."
                    .to_string(),
            ),
            EnvelopeError::AddressOutOfScope { requested } => (
                reject_code::OUT_OF_SCOPE,
                format!(
                    "{requested} is not in this envelope's scope of {} address(es).",
                    env.scope.len()
                ),
            ),
            EnvelopeError::PerTxCeilingExceeded { .. } => (
                reject_code::PER_TX_CEILING,
                format!(
                    "{} exceeds the per-transaction ceiling of {}.",
                    eth(request.value_wei),
                    eth(env.per_tx_ceiling_wei)
                ),
            ),
            EnvelopeError::HardCapExceeded { .. } => (
                reject_code::HARD_CAP,
                format!(
                    "{} would exceed the hard cap: {} of {} is already spent, leaving {}.",
                    eth(request.value_wei),
                    eth(env.spent_wei),
                    eth(env.hard_cap_wei),
                    eth(env.hard_cap_wei.saturating_sub(env.spent_wei))
                ),
            ),
            EnvelopeError::KeychainError { reason } => {
                (reject_code::NO_ENVELOPE, format!("Keychain error: {reason}"))
            }
            EnvelopeError::SigningError { reason } => {
                (reject_code::NO_ENVELOPE, format!("Signing error: {reason}"))
            }
        }
    }

    pub fn activate_kill_switch(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_mut() {
            env.kill_switch_active = true;
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::KillSwitchActivated,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
        self.persist(&guard);
    }

    pub fn deactivate_kill_switch(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_mut() {
            env.kill_switch_active = false;
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::KillSwitchDeactivated,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
        self.persist(&guard);
    }

    pub fn revoke(&self) {
        let mut guard = self.envelope.lock().unwrap();
        if let Some(env) = guard.as_ref() {
            let entry = AuditEntry {
                id: Uuid::new_v4(),
                timestamp: Utc::now().timestamp_millis(),
                envelope_id: env.id,
                event_type: AuditEvent::EnvelopeRevoked,
                tx_to: None, value_wei: None, reject_reason: None,
                spent_wei_snapshot: env.spent_wei,
            };
            let _ = self.audit.write_entry(&entry);
        }
        *guard = None;
        self.persist(&guard);
    }

    pub fn get_status(&self) -> Option<EnvelopeStatus> {
        let guard = self.envelope.lock().unwrap();
        guard.as_ref().map(|env| EnvelopeStatus {
            active: true,
            kill_switch: env.kill_switch_active,
            spent_wei: env.spent_wei,
            hard_cap_wei: env.hard_cap_wei,
            per_tx_ceiling_wei: env.per_tx_ceiling_wei,
            expires_at: env.expires_at,
        })
    }

    fn log_reject(&self, env: &Envelope, event: AuditEvent, req: &TransactionRequest, reason: &str) {
        let entry = AuditEntry {
            id: Uuid::new_v4(),
            timestamp: Utc::now().timestamp_millis(),
            envelope_id: env.id,
            event_type: event,
            tx_to: Some(req.to.clone()),
            value_wei: Some(req.value_wei),
            reject_reason: Some(reason.to_string()),
            spent_wei_snapshot: env.spent_wei,
        };
        let _ = self.audit.write_entry(&entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::types::{Envelope, TransactionRequest};

    const ADDR: &str = "0x000000000000000000000000000000000000dead";
    const ETH: u128 = 1_000_000_000_000_000_000; // 1 ETH in wei

    fn engine_with(per_tx: u128, hard_cap: u128, spent: u128, kill: bool, expired: bool) -> EnvelopeEngine {
        let e = EnvelopeEngine::new();
        let now = Utc::now().timestamp();
        e.create_envelope(Envelope {
            id: Uuid::new_v4(),
            created_at: now,
            expires_at: if expired { now - 10 } else { now + 3600 },
            per_tx_ceiling_wei: per_tx,
            hard_cap_wei: hard_cap,
            spent_wei: spent,
            scope: vec![ADDR.to_string()],
            kill_switch_active: kill,
        });
        e
    }

    fn req(to: &str, value: u128) -> TransactionRequest {
        TransactionRequest { to: to.to_string(), value_wei: value, calldata: String::new() }
    }

    #[test]
    fn authorizes_within_limits_and_tracks_spend() {
        let e = engine_with(2 * ETH, 5 * ETH, 0, false, false);
        assert!(e.check_and_authorize(&req(ADDR, ETH)).is_ok());
        let st = e.get_status().unwrap();
        assert_eq!(st.spent_wei, ETH);
    }

    #[test]
    fn rejects_over_per_tx_ceiling() {
        let e = engine_with(1 * ETH, 100 * ETH, 0, false, false);
        let err = e.check_and_authorize(&req(ADDR, 2 * ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::PerTxCeilingExceeded { .. }));
    }

    #[test]
    fn rejects_out_of_scope_address() {
        let e = engine_with(10 * ETH, 100 * ETH, 0, false, false);
        let other = "0x1111111111111111111111111111111111111111";
        let err = e.check_and_authorize(&req(other, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::AddressOutOfScope { .. }));
    }

    #[test]
    fn hard_cap_breach_trips_kill_switch() {
        // ceiling high, hard cap 3 ETH, already spent 2.5 ETH -> a 1 ETH tx breaches.
        let e = engine_with(10 * ETH, 3 * ETH, 2_500_000_000_000_000_000, false, false);
        let err = e.check_and_authorize(&req(ADDR, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::HardCapExceeded { .. }));
        // auto kill switch must now be engaged
        assert!(e.get_status().unwrap().kill_switch);
    }

    #[test]
    fn expired_envelope_rejects() {
        let e = engine_with(10 * ETH, 100 * ETH, 0, false, true);
        let err = e.check_and_authorize(&req(ADDR, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::EnvelopeExpired { .. }));
    }

    #[test]
    fn kill_switch_blocks_all() {
        let e = engine_with(10 * ETH, 100 * ETH, 0, true, false);
        let err = e.check_and_authorize(&req(ADDR, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::KillSwitchActive));
    }

    // ── preview: read-only, and identical to the real thing ───────────────────

    /// The defect this fixes: `check_transaction` calls `check_and_authorize`,
    /// which CONSUMES budget. Used as a pre-flight check it charges the cap
    /// twice for one transfer.
    #[test]
    fn preview_does_not_consume_budget_while_check_and_authorize_does() {
        let e = engine_with(2 * ETH, 5 * ETH, 0, false, false);

        // Ten previews of a 1 ETH transfer.
        for _ in 0..10 {
            let p = e.preview(&req(ADDR, ETH));
            assert!(p.authorized, "preview should allow: {:?}", p.reject_reason);
        }
        assert_eq!(e.get_status().unwrap().spent_wei, 0, "preview must spend nothing");

        // The real call is what moves the counter.
        assert!(e.check_and_authorize(&req(ADDR, ETH)).is_ok());
        assert_eq!(e.get_status().unwrap().spent_wei, ETH);

        // And the preview afterwards reflects the new headroom.
        let p = e.preview(&req(ADDR, ETH));
        assert_eq!(p.spent_wei.as_deref(), Some("1000000000000000000"));
        assert_eq!(p.remaining_wei.as_deref(), Some("4000000000000000000"));
    }

    /// Previewing an amount over half the remaining cap used to trip the auto
    /// kill switch on the second call, with no ETH moved. It must not.
    #[test]
    fn preview_never_trips_the_auto_kill_switch() {
        // cap 3 ETH, 2.5 already spent: a 1 ETH tx breaches.
        let e = engine_with(10 * ETH, 3 * ETH, 2_500_000_000_000_000_000, false, false);

        for _ in 0..5 {
            let p = e.preview(&req(ADDR, ETH));
            assert!(!p.authorized);
            assert_eq!(p.reject_code.as_deref(), Some(reject_code::HARD_CAP));
        }
        let st = e.get_status().unwrap();
        assert!(!st.kill_switch, "preview must never engage the kill switch");
        assert_eq!(st.spent_wei, 2_500_000_000_000_000_000);
    }

    #[test]
    fn preview_writes_nothing_to_disk() {
        let path = state_path("preview-no-write");
        let e = EnvelopeEngine::with_store(path.clone());
        e.create_envelope(envelope_at(3600, 0, false));
        let before = std::fs::read(&path).unwrap();

        for _ in 0..5 {
            let _ = e.preview(&req(ADDR, ETH));
            let _ = e.preview(&req(ADDR, 100 * ETH));
        }
        assert_eq!(std::fs::read(&path).unwrap(), before, "preview persisted something");

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    /// The divergence guard. Every guard, every ordering: preview's verdict and
    /// the real authorisation's verdict must be the same. Two engines built
    /// identically, so the consuming call cannot pollute the preview.
    #[test]
    fn preview_agrees_with_check_and_authorize_on_every_guard() {
        let other = "0x1111111111111111111111111111111111111111";
        let half = 2_500_000_000_000_000_000u128;

        // (label, per_tx, hard_cap, spent, kill, expired, to, value, expected code)
        let cases: Vec<(&str, u128, u128, u128, bool, bool, &str, u128, Option<&str>)> = vec![
            ("allowed",        2 * ETH, 5 * ETH, 0,    false, false, ADDR,  ETH,      None),
            ("kill switch",    2 * ETH, 5 * ETH, 0,    true,  false, ADDR,  ETH,      Some(reject_code::KILL_SWITCH)),
            ("expired",        2 * ETH, 5 * ETH, 0,    false, true,  ADDR,  ETH,      Some(reject_code::EXPIRED)),
            ("out of scope",   2 * ETH, 5 * ETH, 0,    false, false, other, ETH,      Some(reject_code::OUT_OF_SCOPE)),
            ("per-tx ceiling", 1 * ETH, 5 * ETH, 0,    false, false, ADDR,  2 * ETH,  Some(reject_code::PER_TX_CEILING)),
            ("hard cap",       10 * ETH, 3 * ETH, half, false, false, ADDR, ETH,      Some(reject_code::HARD_CAP)),
            ("exactly at cap", 10 * ETH, 3 * ETH, 2 * ETH, false, false, ADDR, ETH,   None),
            ("at ceiling",     ETH,      5 * ETH, 0,    false, false, ADDR, ETH,      None),
            ("zero value",     ETH,      5 * ETH, 0,    false, false, ADDR, 0,        None),
            // Kill switch outranks a scope violation — order is part of the contract.
            ("kill beats scope", 2 * ETH, 5 * ETH, 0,  true,  false, other, ETH,      Some(reject_code::KILL_SWITCH)),
        ];

        for (label, per_tx, cap, spent, kill, expired, to, value, expected) in cases {
            let previewer = engine_with(per_tx, cap, spent, kill, expired);
            let authorizer = engine_with(per_tx, cap, spent, kill, expired);

            let p = previewer.preview(&req(to, value));
            let real = authorizer.check_and_authorize(&req(to, value));

            assert_eq!(
                p.authorized,
                real.is_ok(),
                "[{label}] preview said authorized={}, real said {:?}",
                p.authorized,
                real
            );
            assert_eq!(p.reject_code.as_deref(), expected, "[{label}] wrong reject code");
            if let Err(e) = &real {
                assert_eq!(
                    p.reject_detail.as_deref(),
                    Some(format!("{e:?}").as_str()),
                    "[{label}] reject_detail must match what check_transaction reports"
                );
            }
        }
    }

    #[test]
    fn preview_reports_the_limits_a_caller_needs_to_explain_a_refusal() {
        let e = engine_with(ETH, 5 * ETH, 2 * ETH, false, false);
        let p = e.preview(&req(ADDR, 3 * ETH));

        assert!(!p.authorized);
        assert_eq!(p.reject_code.as_deref(), Some(reject_code::PER_TX_CEILING));
        // Everything needed to render "3 ETH is over your 1 ETH per-tx limit;
        // you have 3 ETH of headroom left" without deriving anything.
        assert_eq!(p.per_tx_ceiling_wei.as_deref(), Some("1000000000000000000"));
        assert_eq!(p.hard_cap_wei.as_deref(), Some("5000000000000000000"));
        assert_eq!(p.spent_wei.as_deref(), Some("2000000000000000000"));
        assert_eq!(p.remaining_wei.as_deref(), Some("3000000000000000000"));
        assert_eq!(p.value_wei, "3000000000000000000");
        assert!(p.envelope_active);
        assert!(p.in_scope, "the destination is in scope; the ceiling is what refused");
        let reason = p.reject_reason.unwrap();
        assert!(reason.contains("per-transaction ceiling"), "reason was: {reason}");
    }

    #[test]
    fn preview_with_no_envelope_says_so_without_panicking() {
        let e = EnvelopeEngine::new();
        let p = e.preview(&req(ADDR, ETH));
        assert!(!p.authorized);
        assert!(!p.envelope_active);
        assert_eq!(p.reject_code.as_deref(), Some(reject_code::NO_ENVELOPE));
        assert!(p.per_tx_ceiling_wei.is_none());
        assert!(p.remaining_wei.is_none());
        assert!(p.expires_at.is_none());
    }

    #[test]
    fn preview_flags_an_out_of_scope_destination_even_when_something_else_refuses_first() {
        // Kill switch is what refuses, but the address is also wrong; a UI
        // should be able to say both.
        let e = engine_with(2 * ETH, 5 * ETH, 0, true, false);
        let p = e.preview(&req("0x1111111111111111111111111111111111111111", ETH));
        assert_eq!(p.reject_code.as_deref(), Some(reject_code::KILL_SWITCH));
        assert!(!p.in_scope);
        assert!(p.kill_switch);
    }

    #[test]
    fn status_exposes_the_per_tx_ceiling() {
        // It was absent, which is why a caller could not check it.
        let e = engine_with(2 * ETH, 5 * ETH, 0, false, false);
        assert_eq!(e.get_status().unwrap().per_tx_ceiling_wei, 2 * ETH);
    }

    // ── Persistence ───────────────────────────────────────────────────────────
    //
    // The envelope used to live only in memory: closing the app reset the spend
    // counter and disengaged the kill switch, i.e. a restart silently cleared a
    // *safety* limit. These tests pin the restart semantics.

    fn state_path(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-env-{tag}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("envelope-state.json")
    }

    fn envelope_at(now_offset: i64, spent: u128, kill: bool) -> Envelope {
        let now = Utc::now().timestamp();
        Envelope {
            id: Uuid::new_v4(),
            created_at: now,
            expires_at: now + now_offset,
            per_tx_ceiling_wei: 2 * ETH,
            hard_cap_wei: 5 * ETH,
            spent_wei: spent,
            scope: vec![ADDR.to_string()],
            kill_switch_active: kill,
        }
    }

    #[test]
    fn envelope_round_trips_across_a_restart() {
        let path = state_path("roundtrip");
        let original = envelope_at(3600, 0, false);
        let (id, expires_at) = (original.id, original.expires_at);

        let first = EnvelopeEngine::with_store(path.clone());
        first.create_envelope(original);
        drop(first);

        // "Restart": a brand-new engine reading the same file.
        let second = EnvelopeEngine::with_store(path.clone());
        let restored = second.envelope.lock().unwrap().clone().expect("envelope was not restored");
        assert_eq!(restored.id, id);
        assert_eq!(restored.expires_at, expires_at);
        assert_eq!(restored.per_tx_ceiling_wei, 2 * ETH);
        assert_eq!(restored.hard_cap_wei, 5 * ETH);
        assert_eq!(restored.scope, vec![ADDR.to_string()]);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn spent_wei_survives_a_restart() {
        let path = state_path("spent");
        let first = EnvelopeEngine::with_store(path.clone());
        first.create_envelope(envelope_at(3600, 0, false));
        assert!(first.check_and_authorize(&req(ADDR, ETH)).is_ok());
        assert!(first.check_and_authorize(&req(ADDR, ETH)).is_ok());
        assert_eq!(first.get_status().unwrap().spent_wei, 2 * ETH);
        drop(first);

        let second = EnvelopeEngine::with_store(path.clone());
        assert_eq!(
            second.get_status().unwrap().spent_wei,
            2 * ETH,
            "a restart must not hand the hard cap back"
        );

        // The remaining 3 ETH of the 5 ETH cap is still all that is left: a
        // 2 ETH tx is fine, and the one after it breaches.
        assert!(second.check_and_authorize(&req(ADDR, 2 * ETH)).is_ok());
        let err = second.check_and_authorize(&req(ADDR, 2 * ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::HardCapExceeded { .. }));

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn expired_envelope_is_not_restored() {
        let path = state_path("expired");
        let first = EnvelopeEngine::with_store(path.clone());
        // Already expired when it was written.
        first.create_envelope(envelope_at(-10, 0, false));
        assert!(first.get_status().is_some());
        drop(first);

        let second = EnvelopeEngine::with_store(path.clone());
        assert!(
            second.get_status().is_none(),
            "an expired envelope must not come back as active"
        );
        let err = second.check_and_authorize(&req(ADDR, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::NoScopeDefined));

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn kill_switch_stays_engaged_across_a_restart() {
        let path = state_path("killswitch");
        let first = EnvelopeEngine::with_store(path.clone());
        first.create_envelope(envelope_at(3600, 0, false));
        first.activate_kill_switch();
        assert!(first.get_status().unwrap().kill_switch);
        drop(first);

        let second = EnvelopeEngine::with_store(path.clone());
        assert!(
            second.get_status().unwrap().kill_switch,
            "fail closed: a kill switch engaged at shutdown must still be engaged"
        );
        let err = second.check_and_authorize(&req(ADDR, ETH)).unwrap_err();
        assert!(matches!(err, EnvelopeError::KillSwitchActive));

        // And releasing it persists too, otherwise the user could never recover.
        second.deactivate_kill_switch();
        drop(second);
        let third = EnvelopeEngine::with_store(path.clone());
        assert!(!third.get_status().unwrap().kill_switch);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn auto_kill_switch_from_a_hard_cap_breach_is_persisted() {
        let path = state_path("autokill");
        let first = EnvelopeEngine::with_store(path.clone());
        let mut env = envelope_at(3600, 0, false);
        env.per_tx_ceiling_wei = 10 * ETH;
        env.hard_cap_wei = 3 * ETH;
        env.spent_wei = 2_500_000_000_000_000_000;
        first.create_envelope(env);
        assert!(first.check_and_authorize(&req(ADDR, ETH)).is_err());
        drop(first);

        let second = EnvelopeEngine::with_store(path.clone());
        assert!(second.get_status().unwrap().kill_switch);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn revoking_clears_the_persisted_envelope() {
        let path = state_path("revoke");
        let first = EnvelopeEngine::with_store(path.clone());
        first.create_envelope(envelope_at(3600, 0, false));
        first.revoke();
        drop(first);

        let second = EnvelopeEngine::with_store(path.clone());
        assert!(second.get_status().is_none());

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn memory_only_engine_writes_nothing() {
        // `new()` must stay side-effect free so tests (and any future embedded
        // use) cannot stomp on the real user's envelope file.
        let e = EnvelopeEngine::new();
        assert!(e.store.is_none());
        e.create_envelope(envelope_at(3600, 0, false));
        assert!(e.get_status().is_some());
    }
}
