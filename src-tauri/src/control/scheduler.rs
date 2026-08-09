use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::envelope::engine::EnvelopeEngine;
use crate::sniping;

/// File that holds the scheduler's armed flag and cadence across restarts.
pub const STATE_FILE: &str = "scheduler-state.json";

/// Default cadence for the snipe loop, in seconds.
pub const DEFAULT_INTERVAL_SECS: u64 = 15;
/// Clamp bounds so a bad `/scheduler` call cannot spin the loop or park it forever.
pub const MIN_INTERVAL_SECS: u64 = 5;
pub const MAX_INTERVAL_SECS: u64 = 3600;

/// Outcome of the most recent scheduler cycle — surfaced verbatim on `/status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleSummary {
    pub checked_at: String,
    pub active_rules: u32,
    pub expired_deactivated: u32,
    /// Rules switched off this cycle because they hit `max_total_spend_eth`.
    pub spend_capped_deactivated: u32,
    pub triggered: u32,
    /// Set when the cycle did no work (no key, no rules, kill switch, error).
    pub skipped_reason: Option<String>,
    /// Per-rule outcome including the floor price seen this cycle.
    pub results: Vec<sniping::SnipeResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchedulerStatus {
    pub enabled: bool,
    pub interval_secs: u64,
    pub last_check_at: Option<String>,
    pub last_cycle: Option<CycleSummary>,
    /// Cycles attempted since app start (including skipped ones).
    pub cycles_run: u64,
}

impl SchedulerStatus {
    /// Plain-language summary aimed at an LLM caller reading `/status`.
    ///
    /// The loop ships DISABLED (see `control::start`): Westron runs on a free
    /// Alchemy tier where bursts of calls have already caused real 429s, and an
    /// always-on floor poll would spend that quota from first launch for a
    /// feature that currently only produces a simulated tx hash. The cost of
    /// that default is someone creating a rule and assuming it is armed, so the
    /// hint has to say so unmistakably.
    pub fn hint(&self) -> String {
        if !self.enabled {
            return "The snipe scheduler is OFF. Rules are stored but NOT checked \
                    automatically — nothing will ever fire on its own. Turn it on with \
                    westron_scheduler {\"enabled\": true} (HTTP: POST /scheduler), or run a \
                    single check by hand with westron_snipe_check_now."
                .to_string();
        }
        let mut hint = format!(
            "The snipe scheduler is ON, checking active rules every {} seconds.",
            self.interval_secs
        );
        if let Some(reason) = self
            .last_cycle
            .as_ref()
            .and_then(|c| c.skipped_reason.as_deref())
        {
            hint.push_str(&format!(" Its last cycle did no work: {reason}."));
        }
        hint
    }
}

/// The subset of scheduler state that outlives the process. Cycle counters and
/// the last cycle summary are deliberately not persisted — they describe this
/// run, and restoring them would misreport a freshly started loop as having
/// just checked something.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedScheduler {
    pub enabled: bool,
    pub interval_secs: u64,
}

/// Shared, mutable scheduler state. Cloned (as an `Arc`) into both the loop and
/// the control server so `/status` and `/scheduler` see the same thing.
pub struct SchedulerHandle {
    state: Mutex<SchedulerStatus>,
    /// Where the armed flag is persisted. `None` means memory-only (tests).
    store: Option<PathBuf>,
}

impl SchedulerHandle {
    /// Memory-only handle — nothing it does touches the state file.
    pub fn new(enabled: bool) -> Self {
        SchedulerHandle {
            state: Mutex::new(SchedulerStatus {
                enabled,
                interval_secs: DEFAULT_INTERVAL_SECS,
                last_check_at: None,
                last_cycle: None,
                cycles_run: 0,
            }),
            store: None,
        }
    }

    /// Handle backed by `path`, restoring the armed flag and cadence from a
    /// previous run. `default_enabled` applies only when nothing is stored yet.
    ///
    /// Before this, the flag reset to off on every restart: a user who armed
    /// the loop found it silently disarmed the next morning.
    pub fn with_store(path: PathBuf, default_enabled: bool) -> Self {
        let (enabled, interval_secs) =
            match crate::persist::read_json::<PersistedScheduler>(&path) {
                Ok(Some(p)) => (
                    p.enabled,
                    p.interval_secs.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS),
                ),
                Ok(None) => (default_enabled, DEFAULT_INTERVAL_SECS),
                Err(e) => {
                    // Unreadable state falls back to the safe default (off),
                    // never to "on".
                    log::error!("could not read persisted scheduler state ({e}); starting disabled");
                    (false, DEFAULT_INTERVAL_SECS)
                }
            };

        let handle = SchedulerHandle {
            state: Mutex::new(SchedulerStatus {
                enabled,
                interval_secs,
                last_check_at: None,
                last_cycle: None,
                cycles_run: 0,
            }),
            store: Some(path),
        };
        handle.persist(&handle.state.lock().unwrap());
        handle
    }

    /// Handle backed by the standard app-data location, falling back to
    /// memory-only if the data directory cannot be determined.
    pub fn load_or_new(default_enabled: bool) -> Self {
        match crate::persist::app_file(STATE_FILE) {
            Ok(path) => Self::with_store(path, default_enabled),
            Err(e) => {
                log::error!("scheduler persistence disabled — {e}");
                Self::new(default_enabled)
            }
        }
    }

    /// Best-effort write; a failure is logged, never propagated.
    fn persist(&self, current: &SchedulerStatus) {
        let Some(path) = self.store.as_ref() else { return };
        let snapshot = PersistedScheduler {
            enabled: current.enabled,
            interval_secs: current.interval_secs,
        };
        if let Err(e) = crate::persist::write_json(path, &snapshot) {
            log::error!("could not persist scheduler state: {e}");
        }
    }

    pub fn snapshot(&self) -> SchedulerStatus {
        self.state.lock().unwrap().clone()
    }

    /// Apply a partial config update from `POST /scheduler`; returns the new state.
    pub fn configure(&self, enabled: Option<bool>, interval_secs: Option<u64>) -> SchedulerStatus {
        let mut guard = self.state.lock().unwrap();
        if let Some(e) = enabled {
            guard.enabled = e;
        }
        if let Some(i) = interval_secs {
            guard.interval_secs = i.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS);
        }
        self.persist(&guard);
        guard.clone()
    }

    fn record(&self, summary: CycleSummary) {
        let mut guard = self.state.lock().unwrap();
        guard.last_check_at = Some(summary.checked_at.clone());
        guard.last_cycle = Some(summary);
        guard.cycles_run += 1;
    }
}

fn skipped(reason: &str, active_rules: u32, expired: u32) -> CycleSummary {
    CycleSummary {
        checked_at: Utc::now().to_rfc3339(),
        active_rules,
        expired_deactivated: expired,
        spend_capped_deactivated: 0,
        triggered: 0,
        skipped_reason: Some(reason.to_string()),
        results: Vec::new(),
    }
}

/// Split the guardrail deactivations this cycle produced into (expired, spend-capped).
pub fn count_deactivations(results: &[sniping::SnipeResult]) -> (u32, u32) {
    let count = |code: &str| {
        results
            .iter()
            .filter(|r| r.deactivated_reason.as_deref() == Some(code))
            .count() as u32
    };
    (
        count(sniping::db::DEACTIVATED_EXPIRED),
        count(sniping::db::DEACTIVATED_SPEND_CAP),
    )
}

/// Run one scheduler cycle. Never panics — every failure is recorded as a
/// `skipped_reason` so `/status` explains why nothing happened.
pub async fn run_cycle(
    handle: &Arc<SchedulerHandle>,
    envelope: &Arc<EnvelopeEngine>,
    app: &tauri::AppHandle,
) {
    let db_path = match sniping::ensure_db() {
        Ok(p) => p,
        Err(e) => {
            handle.record(skipped(&format!("sniping DB unavailable: {e}"), 0, 0));
            return;
        }
    };

    // Guardrail: retire rules past their TTL before anything else.
    let expired = sniping::db::deactivate_expired_rules(&db_path).unwrap_or(0);

    let active = match sniping::db::count_active_rules(&db_path) {
        Ok(n) => n,
        Err(e) => {
            handle.record(skipped(&format!("could not count rules: {e}"), 0, expired));
            return;
        }
    };
    if active == 0 {
        handle.record(skipped("no active rules", 0, expired));
        return;
    }

    // Kill switch stops the loop from even attempting a trigger.
    if envelope.get_status().map(|s| s.kill_switch).unwrap_or(false) {
        handle.record(skipped("kill switch active", active, expired));
        return;
    }

    let api_key = match crate::wallet::keychain::fetch_alchemy_key() {
        Ok(k) if !k.trim().is_empty() => k,
        _ => {
            handle.record(skipped(
                "no Alchemy API key configured — add it in Westron Settings",
                active,
                expired,
            ));
            return;
        }
    };

    let engine = sniping::engine::SnipingEngine::new(db_path);
    match engine.check_snipe_rules(&api_key, envelope, app).await {
        Ok(results) => {
            let triggered = results.iter().filter(|r| r.triggered).count() as u32;
            let (expired_now, capped_now) = count_deactivations(&results);
            handle.record(CycleSummary {
                checked_at: Utc::now().to_rfc3339(),
                active_rules: active,
                expired_deactivated: expired + expired_now,
                spend_capped_deactivated: capped_now,
                triggered,
                skipped_reason: None,
                results,
            });
        }
        Err(e) => {
            handle.record(skipped(&format!("snipe check failed: {e}"), active, expired));
        }
    }
}

/// Spawn the snipe loop. Re-reads its config every tick so `POST /scheduler`
/// takes effect without a restart.
pub fn spawn(
    handle: Arc<SchedulerHandle>,
    envelope: Arc<EnvelopeEngine>,
    app: tauri::AppHandle,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            let (enabled, interval) = {
                let s = handle.snapshot();
                (s.enabled, s.interval_secs)
            };
            tokio::time::sleep(tokio::time::Duration::from_secs(
                interval.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS),
            ))
            .await;
            if !enabled {
                continue;
            }
            run_cycle(&handle, &envelope, &app).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configure_applies_partial_updates_and_clamps() {
        let h = SchedulerHandle::new(true);
        let s = h.configure(Some(false), None);
        assert!(!s.enabled);
        assert_eq!(s.interval_secs, DEFAULT_INTERVAL_SECS);

        let s = h.configure(None, Some(1));
        assert_eq!(s.interval_secs, MIN_INTERVAL_SECS);
        assert!(!s.enabled, "enabled must be untouched when omitted");

        let s = h.configure(Some(true), Some(999_999));
        assert_eq!(s.interval_secs, MAX_INTERVAL_SECS);
        assert!(s.enabled);
    }

    #[test]
    fn scheduler_ships_disabled_and_the_hint_says_how_to_start_it() {
        // Product decision: free Alchemy tier + "automation last" sequencing.
        let h = SchedulerHandle::new(false);
        let off = h.snapshot();
        assert!(!off.enabled, "the loop must ship disabled");
        let hint = off.hint();
        assert!(hint.contains("OFF"), "hint was: {hint}");
        assert!(hint.contains("westron_scheduler"), "hint must name the tool: {hint}");
        assert!(hint.contains("westron_snipe_check_now"), "hint must offer the manual path: {hint}");

        let on = h.configure(Some(true), None);
        assert_eq!(on.interval_secs, DEFAULT_INTERVAL_SECS, "15s stays the default once enabled");
        assert!(on.hint().contains("ON"));
    }

    #[test]
    fn cycle_summary_separates_expiry_from_spend_cap() {
        let result = |reason: Option<&str>| sniping::SnipeResult {
            rule_id: "r".to_string(),
            collection_slug: "0xabc".to_string(),
            floor_price_eth: 1.0,
            triggered: false,
            tx_hash: None,
            error: None,
            deactivated_reason: reason.map(|s| s.to_string()),
        };
        let results = vec![
            result(Some(crate::sniping::db::DEACTIVATED_EXPIRED)),
            result(Some(crate::sniping::db::DEACTIVATED_SPEND_CAP)),
            result(Some(crate::sniping::db::DEACTIVATED_SPEND_CAP)),
            result(None),
        ];
        assert_eq!(count_deactivations(&results), (1, 2));
    }

    fn state_path(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join(format!("westron-sched-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("scheduler-state.json")
    }

    #[test]
    fn armed_flag_and_interval_survive_a_restart() {
        let path = state_path("roundtrip");

        let first = SchedulerHandle::with_store(path.clone(), false);
        assert!(!first.snapshot().enabled, "no stored state → the safe default");
        first.configure(Some(true), Some(60));
        drop(first);

        // "Restart": a fresh handle over the same file. The default is still
        // `false`, so anything other than `true` here means the flag was lost.
        let second = SchedulerHandle::with_store(path.clone(), false);
        let s = second.snapshot();
        assert!(s.enabled, "an armed scheduler must still be armed after a restart");
        assert_eq!(s.interval_secs, 60);
        // Per-run counters are deliberately not restored.
        assert_eq!(s.cycles_run, 0);
        assert!(s.last_check_at.is_none());

        // Disabling persists too.
        second.configure(Some(false), None);
        drop(second);
        assert!(!SchedulerHandle::with_store(path.clone(), true).snapshot().enabled);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn persisted_interval_is_clamped_on_load() {
        let path = state_path("clamp");
        std::fs::write(
            &path,
            serde_json::json!({ "enabled": true, "interval_secs": 999_999u64 }).to_string(),
        )
        .unwrap();

        let h = SchedulerHandle::with_store(path.clone(), false);
        assert_eq!(h.snapshot().interval_secs, MAX_INTERVAL_SECS);

        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn unreadable_state_starts_disabled() {
        let path = state_path("corrupt");
        std::fs::write(&path, b"{not json").unwrap();
        assert!(
            !SchedulerHandle::with_store(path.clone(), true).snapshot().enabled,
            "a corrupt state file must fail closed, not arm the loop"
        );
        std::fs::remove_dir_all(path.parent().unwrap()).ok();
    }

    #[test]
    fn memory_only_handle_writes_nothing() {
        let h = SchedulerHandle::new(true);
        assert!(h.store.is_none());
        h.configure(Some(false), Some(30));
        assert_eq!(h.snapshot().interval_secs, 30);
    }

    #[test]
    fn recording_a_cycle_updates_last_check() {
        let h = SchedulerHandle::new(true);
        assert!(h.snapshot().last_check_at.is_none());
        h.record(skipped("no active rules", 0, 0));
        let s = h.snapshot();
        assert!(s.last_check_at.is_some());
        assert_eq!(s.cycles_run, 1);
        assert_eq!(
            s.last_cycle.unwrap().skipped_reason.as_deref(),
            Some("no active rules")
        );
    }
}
