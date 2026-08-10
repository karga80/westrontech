//! Per-wallet persistence for `WalletPolicy` records.
//!
//! One JSON file per wallet under `autonomy_policies/`, keyed by the
//! lowercased wallet address — not one shared blob. Editing one wallet's
//! policy must never require rewriting every other wallet's policy file.
//!
//! This module adds no new file-I/O primitives: every read/write goes
//! through `crate::persist`'s existing atomic-write-0600 helpers, the same
//! ones `EnvelopeEngine` and the snipe scheduler already use. The
//! `_in(dir, ...)` / default-location split mirrors
//! `EnvelopeEngine::with_store` vs `EnvelopeEngine::load_or_new`: the
//! `_in` variants are the actually-tested logic, the default-location
//! wrappers are a thin, effectively-untested pointer at the real app-data
//! directory (tests must never write into a user's real
//! `~/Library/Application Support/Westron`).

use std::path::{Path, PathBuf};

use crate::autonomy::types::{AutonomyMode, WalletPolicy};

const POLICIES_DIR: &str = "autonomy_policies";

/// `~/Library/Application Support/Westron/autonomy_policies/` on macOS, the
/// platform data dir equivalent elsewhere. Creates the directory if it does
/// not exist.
fn default_dir() -> Result<PathBuf, String> {
    // `persist::app_file` creates `.../Westron/` and returns
    // `.../Westron/autonomy_policies` as a path — it does not create that
    // last segment as a directory, since normally it names a file. Here we
    // want it to be a directory, so we create it ourselves.
    let dir = crate::persist::app_file(POLICIES_DIR)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// The safe default for any wallet that has no policy file yet: `Manual`
/// mode, disabled, no rules, mainnet-scoped. A wallet with nothing on disk
/// must resolve to "cannot act autonomously", never to an implicit grant.
pub fn default_policy(wallet_address: &str) -> WalletPolicy {
    WalletPolicy {
        wallet_address: wallet_address.to_lowercase(),
        mode: AutonomyMode::Manual,
        enabled: false,
        chain_id: 1,
        rules: Vec::new(),
    }
}

fn policy_path(dir: &Path, wallet_address: &str) -> PathBuf {
    dir.join(format!("{}.json", wallet_address.to_lowercase()))
}

/// Read a wallet's policy from `dir`. A missing file is `Ok(None)` —
/// "never configured" — distinct from a corrupt file, which is `Err`.
/// Mirrors `persist::read_json`'s own contract; this function adds nothing
/// beyond resolving the per-wallet path.
pub fn load(dir: &Path, wallet_address: &str) -> Result<Option<WalletPolicy>, String> {
    crate::persist::read_json::<WalletPolicy>(&policy_path(dir, wallet_address))
}

/// `load`, but a corrupt file resolves to the safe default instead of
/// propagating the error — loudly logged first, never silent. Mirrors
/// `EnvelopeEngine::with_store`'s precedent: unreadable persisted state is
/// treated as "no authorisation", never as "no limits". Callers that must
/// distinguish "never configured" from "on-disk state is corrupt" (e.g. to
/// surface a corruption warning in the UI) should call `load` directly.
pub fn load_or_default_in(dir: &Path, wallet_address: &str) -> WalletPolicy {
    match load(dir, wallet_address) {
        Ok(Some(policy)) => policy,
        Ok(None) => default_policy(wallet_address),
        Err(e) => {
            log::error!(
                "could not read autonomy policy for {wallet_address} ({e}); falling back to \
                 the safe default (Manual, disabled) rather than treating this wallet as \
                 unrestricted"
            );
            default_policy(wallet_address)
        }
    }
}

/// `load_or_default_in` against the standard app-data location. Never
/// errors, never blocks a caller that just wants "the policy in effect
/// right now" — the one thing every existing flow for a wallet that
/// predates this feature must be able to call unconditionally.
pub fn load_or_default(wallet_address: &str) -> WalletPolicy {
    match default_dir() {
        Ok(dir) => load_or_default_in(&dir, wallet_address),
        Err(e) => {
            log::error!(
                "autonomy policy persistence unavailable ({e}); using the safe default \
                 (Manual, disabled) for {wallet_address}"
            );
            default_policy(wallet_address)
        }
    }
}

/// Atomically write `policy` to its own file under `dir`, keyed by its
/// (lowercased) `wallet_address`.
pub fn save_in(dir: &Path, policy: &WalletPolicy) -> Result<(), String> {
    crate::persist::write_json(&policy_path(dir, &policy.wallet_address), policy)
}

/// `save_in` against the standard app-data location.
pub fn save(policy: &WalletPolicy) -> Result<(), String> {
    let dir = default_dir()?;
    save_in(&dir, policy)
}

/// Every wallet that has an on-disk policy file under `dir`, parsed. A
/// wallet that never called `save`/`save_in` simply has no entry here —
/// callers that want "every wallet including ones still on the safe
/// default" must combine this with their own wallet list (this module has
/// no concept of "every wallet that exists," only "every wallet that has
/// been configured").
///
/// A single corrupt file is logged and skipped rather than failing the
/// whole listing — one wallet's bad file must not hide every other
/// wallet's policy from a UI that lists them all. This mirrors
/// `load_or_default_in`'s fail-closed-per-wallet posture rather than
/// `load`'s fail-loud-per-wallet posture, because there is no single
/// caller-supplied wallet address here to report the error against
/// individually.
pub fn list_all_in(dir: &Path) -> Result<Vec<WalletPolicy>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };

    let mut policies = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match crate::persist::read_json::<WalletPolicy>(&path) {
            Ok(Some(policy)) => policies.push(policy),
            Ok(None) => {} // race: file listed then removed before read
            Err(e) => log::error!("skipping unreadable autonomy policy file {path:?}: {e}"),
        }
    }
    // Stable, deterministic ordering for the UI regardless of directory
    // iteration order.
    policies.sort_by(|a, b| a.wallet_address.cmp(&b.wallet_address));
    Ok(policies)
}

/// `list_all_in` against the standard app-data location.
pub fn list_all() -> Result<Vec<WalletPolicy>, String> {
    let dir = default_dir()?;
    list_all_in(&dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::autonomy::types::{ActionType, AutonomyRule, RuleEffect};

    const WALLET: &str = "0x000000000000000000000000000000000000dead";
    const CONTRACT: &str = "0x00000000000000000000000000000000c0ffee";

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-autonomy-store-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample_policy(wallet_address: &str) -> WalletPolicy {
        WalletPolicy {
            wallet_address: wallet_address.to_lowercase(),
            mode: AutonomyMode::Autonomous,
            enabled: true,
            chain_id: 1,
            rules: vec![AutonomyRule {
                enabled: true,
                effect: RuleEffect::Allow,
                action_type: ActionType::Mint,
                per_tx_cap_wei: 2_000_000_000_000_000_000,
                total_budget_cap_wei: 5_000_000_000_000_000_000,
                expires_at: Some(1_900_000_000),
                allowed_contracts: vec![CONTRACT.to_string()],
                rate_limit_max_executions: Some(3),
                rate_limit_window_seconds: Some(3600),
            }],
        }
    }

    fn assert_policies_eq(a: &WalletPolicy, b: &WalletPolicy) {
        assert_eq!(a.wallet_address, b.wallet_address);
        assert_eq!(a.mode, b.mode);
        assert_eq!(a.enabled, b.enabled);
        assert_eq!(a.chain_id, b.chain_id);
        assert_eq!(a.rules.len(), b.rules.len());
        for (ra, rb) in a.rules.iter().zip(b.rules.iter()) {
            assert_eq!(ra.enabled, rb.enabled);
            assert_eq!(ra.effect, rb.effect);
            assert_eq!(ra.action_type, rb.action_type);
            assert_eq!(ra.per_tx_cap_wei, rb.per_tx_cap_wei);
            assert_eq!(ra.total_budget_cap_wei, rb.total_budget_cap_wei);
            assert_eq!(ra.expires_at, rb.expires_at);
            assert_eq!(ra.allowed_contracts, rb.allowed_contracts);
            assert_eq!(ra.rate_limit_max_executions, rb.rate_limit_max_executions);
            assert_eq!(ra.rate_limit_window_seconds, rb.rate_limit_window_seconds);
        }
    }

    // ── Safe default ────────────────────────────────────────────────────

    #[test]
    fn default_policy_is_manual_and_disabled_never_an_implicit_grant() {
        let p = default_policy(WALLET);
        assert_eq!(p.mode, AutonomyMode::Manual);
        assert!(!p.enabled);
        assert!(p.rules.is_empty());
        assert_eq!(p.chain_id, 1);
    }

    // ── Round trip / missing file ──────────────────────────────────────

    #[test]
    fn missing_file_is_ok_none_from_load() {
        let dir = tmp_dir("missing");
        assert!(load(&dir, WALLET).unwrap().is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_file_resolves_to_safe_default_via_load_or_default_in() {
        let dir = tmp_dir("missing-default");
        let p = load_or_default_in(&dir, WALLET);
        assert_eq!(p.mode, AutonomyMode::Manual);
        assert!(!p.enabled);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn round_trips_a_saved_policy() {
        let dir = tmp_dir("roundtrip");
        let original = sample_policy(WALLET);

        save_in(&dir, &original).unwrap();
        let loaded = load(&dir, WALLET).unwrap().expect("policy should exist after save");
        assert_policies_eq(&original, &loaded);

        let via_default = load_or_default_in(&dir, WALLET);
        assert_policies_eq(&original, &via_default);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn overwrite_replaces_the_previous_policy() {
        let dir = tmp_dir("overwrite");
        save_in(&dir, &sample_policy(WALLET)).unwrap();

        let mut updated = sample_policy(WALLET);
        updated.enabled = false;
        updated.mode = AutonomyMode::Manual;
        save_in(&dir, &updated).unwrap();

        let loaded = load(&dir, WALLET).unwrap().unwrap();
        assert!(!loaded.enabled);
        assert_eq!(loaded.mode, AutonomyMode::Manual);

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Corrupt file ─────────────────────────────────────────────────────

    #[test]
    fn corrupt_file_is_error_not_silent_reset_from_load() {
        let dir = tmp_dir("corrupt");
        std::fs::write(policy_path(&dir, WALLET), b"{not json").unwrap();
        assert!(load(&dir, WALLET).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_file_fails_closed_to_safe_default_via_load_or_default_in() {
        let dir = tmp_dir("corrupt-default");
        std::fs::write(policy_path(&dir, WALLET), b"{not json").unwrap();
        let p = load_or_default_in(&dir, WALLET);
        // Fails closed: corruption never resolves to an autonomous/enabled
        // policy, even though a real corrupted file might have last held one.
        assert_eq!(p.mode, AutonomyMode::Manual);
        assert!(!p.enabled);
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Per-wallet isolation ────────────────────────────────────────────

    #[test]
    fn different_wallets_get_independent_files() {
        let dir = tmp_dir("isolation");
        const WALLET_B: &str = "0x00000000000000000000000000000000000beef";

        let mut policy_a = sample_policy(WALLET);
        policy_a.enabled = true;
        let mut policy_b = sample_policy(WALLET_B);
        policy_b.wallet_address = WALLET_B.to_string();
        policy_b.enabled = false;
        policy_b.mode = AutonomyMode::Manual;

        save_in(&dir, &policy_a).unwrap();
        save_in(&dir, &policy_b).unwrap();

        // Rewriting wallet A must not disturb wallet B's file.
        let mut policy_a_v2 = policy_a.clone();
        policy_a_v2.enabled = false;
        save_in(&dir, &policy_a_v2).unwrap();

        let loaded_a = load(&dir, WALLET).unwrap().unwrap();
        let loaded_b = load(&dir, WALLET_B).unwrap().unwrap();
        assert!(!loaded_a.enabled);
        assert!(!loaded_b.enabled);
        assert_eq!(loaded_b.mode, AutonomyMode::Manual);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wallet_address_is_normalized_to_lowercase_in_the_filename() {
        let dir = tmp_dir("case");
        let mixed_case = "0x000000000000000000000000000000000000DEAD";
        let mut policy = sample_policy(mixed_case);
        policy.wallet_address = mixed_case.to_string();

        save_in(&dir, &policy).unwrap();

        // Same file regardless of the case used to look it up.
        assert!(load(&dir, WALLET).unwrap().is_some());
        assert!(load(&dir, mixed_case).unwrap().is_some());
        assert_eq!(
            policy_path(&dir, WALLET),
            policy_path(&dir, mixed_case),
            "lowercased and mixed-case addresses must resolve to the same file"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── list_all_in ─────────────────────────────────────────────────────

    #[test]
    fn list_all_in_returns_empty_vec_when_directory_does_not_exist_yet() {
        let dir = std::env::temp_dir().join(format!("westron-autonomy-store-nonexistent-{}", uuid::Uuid::new_v4()));
        assert!(list_all_in(&dir).unwrap().is_empty());
    }

    #[test]
    fn list_all_in_returns_every_saved_policy_sorted_by_wallet_address() {
        let dir = tmp_dir("list-all");
        const WALLET_B: &str = "0x00000000000000000000000000000000000beef";

        save_in(&dir, &sample_policy(WALLET_B)).unwrap();
        save_in(&dir, &sample_policy(WALLET)).unwrap();

        let all = list_all_in(&dir).unwrap();
        assert_eq!(all.len(), 2);
        let addresses: Vec<&str> = all.iter().map(|p| p.wallet_address.as_str()).collect();
        let mut expected = vec![WALLET, WALLET_B];
        expected.sort();
        assert_eq!(addresses, expected, "list_all_in must return records sorted by wallet_address");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_all_in_skips_a_corrupt_file_instead_of_failing_the_whole_listing() {
        let dir = tmp_dir("list-all-corrupt");
        const WALLET_B: &str = "0x00000000000000000000000000000000000beef";

        save_in(&dir, &sample_policy(WALLET)).unwrap();
        std::fs::write(policy_path(&dir, WALLET_B), b"{not json").unwrap();

        let all = list_all_in(&dir).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].wallet_address, WALLET);

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── File permissions ────────────────────────────────────────────────

    #[cfg(unix)]
    #[test]
    fn policy_file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tmp_dir("mode");
        save_in(&dir, &sample_policy(WALLET)).unwrap();

        let path = policy_path(&dir, WALLET);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "policy file mode was {mode:o}, expected 600");

        // The atomic rewrite path must not widen it either.
        save_in(&dir, &sample_policy(WALLET)).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "after rewrite the mode was {mode:o}, expected 600");

        std::fs::remove_dir_all(&dir).ok();
    }
}
