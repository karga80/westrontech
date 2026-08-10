//! Hash-chained, tamper-evident audit log for wallet-autonomy decisions.
//!
//! This is a **new** module, deliberately not a retrofit of
//! `envelope::audit::AuditLog`: that path is already proven and is not
//! hash-chained, and the brief (`docs/WALLET_AUTONOMY_POLICY_BRIEF.md`,
//! "Audit and privacy requirements") requires hash-chaining specifically for
//! the autonomy system. Retrofitting the envelope log would risk
//! destabilizing an already-working, unrelated audit path for no benefit.
//!
//! On-disk format mirrors `envelope::audit::AuditLog`'s mechanics — one
//! JSONL line per record, opened with `create().append(true)`, `0600` mode
//! set at creation, `sync_all()` after every write, so the log stays
//! streamable/append-friendly rather than being one giant JSON array. Layout
//! follows `autonomy::store`'s per-wallet convention instead of one shared
//! file, for the same reason: one wallet's activity must never require
//! rewriting another wallet's history. Directory resolution reuses
//! `persist::app_file` exactly as `store.rs` does.
//!
//! Each record carries its own content hash and the previous record's hash
//! (`prev_hash`), computed with `alloy::primitives::keccak256` — already a
//! direct dependency and already used this way elsewhere in this codebase
//! (`nft::mod`, `marketplace::seaport`, `marketplace::client`), so no new
//! hashing crate is introduced. The first record in a wallet's chain links
//! to the fixed `GENESIS_HASH` rather than a real previous record.

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::autonomy::types::{ActionType, AutonomyDecision, AutonomyMode};
use crate::envelope::types::u128_as_string;

const AUDIT_DIR: &str = "autonomy_audit";

/// Fixed "previous hash" for the first record in any wallet's chain. 32
/// zero bytes, hex-encoded — deliberately not a real `keccak256` output, so
/// it can never collide with an actual record hash.
pub const GENESIS_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

// `GENESIS_HASH` must be exactly 64 hex chars (32 bytes), matching every
// real `keccak256` digest this module ever produces — enforced at compile
// time so a typo above cannot silently shrink the genesis value.
const _: () = assert!(GENESIS_HASH.len() == 64);

/// A structured description of what changed in a `PolicyChanged` record.
/// Kept minimal per the brief's "don't over-build the lease concept"
/// guidance applied consistently: enough structure to reconstruct what
/// happened, no more.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "change", rename_all = "snake_case")]
pub enum PolicyChangeKind {
    ModeChanged { from: AutonomyMode, to: AutonomyMode },
    Enabled,
    Disabled,
    RuleCreated { rule_index: usize },
    RuleUpdated { rule_index: usize },
    RuleDeleted { rule_index: usize },
    KillSwitchPaused,
    KillSwitchResumed,
}

/// One variant per audit-trail event required by the brief: every
/// proposal/decision/approve/deny/confirm/sign/broadcast/replacement/
/// finalization/policy-change must be recorded. Modeled as a tagged enum
/// per this codebase's "model states as enums" convention (mirrors
/// `AutonomyDecision`, `envelope::types::AuditEvent`).
///
/// Deliberately does not carry raw calldata, private keys, or full signed
/// transactions — the brief explicitly forbids logging those. Where a
/// record needs to reference calldata, it carries a hash of it instead.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum AuditRecordKind {
    ProposalCreated {
        action_type: ActionType,
        target_contract: Option<String>,
        #[serde(with = "u128_as_string")]
        value_wei: u128,
        chain_id: u64,
    },
    /// The engine's verdict for a proposal — `AutonomyDecision` is reused
    /// verbatim rather than re-encoded, so the audit record and the
    /// decision the engine actually returned can never drift apart.
    Decision {
        outcome: AutonomyDecision,
        matched_rule_index: Option<usize>,
    },
    /// Minimal stub: Phase (a) did not define a lease concept. An id and an
    /// expiry are enough to reconstruct what a caller granted itself
    /// permission to do and until when; a fuller lease model, if one is
    /// ever needed, is out of scope here.
    LeaseCreated { lease_id: String, expires_at: i64 },
    Approved { note: Option<String> },
    Denied { reason: String },
    /// Covers both "user/engine confirmed" and "transaction was signed" —
    /// never carries the signed transaction itself, only a hash of the
    /// calldata that was signed, per the brief's no-raw-calldata rule.
    Signed { calldata_hash: Option<String> },
    Broadcast { tx_hash: String },
    /// A nonce bump / speed-up / cancel-replace.
    Replaced {
        old_tx_hash: String,
        new_tx_hash: String,
        reason: String,
    },
    Finalized { tx_hash: String, confirmations: u32 },
    PolicyChanged { change: PolicyChangeKind },
}

/// One entry in a wallet's hash-chained audit log.
///
/// `hash` is `keccak256` over the canonical JSON encoding of every other
/// field (see `compute_hash`) — it is never itself part of what it hashes.
/// `prev_hash` is either the previous record's `hash`, or `GENESIS_HASH` for
/// the first record in the chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditRecord {
    pub wallet_address: String,
    /// 0-based, strictly increasing per wallet. Lets `verify_chain` detect
    /// a deleted/reordered record even if an attacker also patched the hash
    /// fields consistently around the deletion.
    pub sequence: u64,
    pub timestamp: i64,
    pub kind: AuditRecordKind,
    pub prev_hash: String,
    pub hash: String,
}

/// Why `verify_chain`/`verify_chain_in` rejected a wallet's audit log.
/// `at_sequence` is the sequence number of the first record found to be
/// wrong — either malformed, out of order, mis-linked, or content-tampered.
#[derive(Debug, Clone, PartialEq)]
pub struct ChainVerificationError {
    pub at_sequence: u64,
    pub reason: String,
}

impl std::fmt::Display for ChainVerificationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "audit chain broken at sequence {}: {}", self.at_sequence, self.reason)
    }
}

/// `pub(crate)` (not private): `autonomy::engine`'s test module needs to
/// locate and deliberately corrupt a wallet's real on-disk log to prove
/// `check_and_authorize` fails closed against it — same reasoning as
/// `pending::default_dir`.
pub(crate) fn default_dir() -> Result<PathBuf, String> {
    let dir = crate::persist::app_file(AUDIT_DIR)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn log_path(dir: &Path, wallet_address: &str) -> PathBuf {
    dir.join(format!("{}.jsonl", wallet_address.to_lowercase()))
}

/// `keccak256(canonical_json_of(prev_hash, wallet_address, sequence,
/// timestamp, kind))`, hex-encoded. Every field that ends up in the stored
/// record except `hash` itself feeds the hash, so tampering with any of
/// them — including `prev_hash`, which is what actually creates the chain
/// — is detectable.
fn compute_hash(
    prev_hash: &str,
    wallet_address: &str,
    sequence: u64,
    timestamp: i64,
    kind: &AuditRecordKind,
) -> String {
    #[derive(Serialize)]
    struct HashInput<'a> {
        prev_hash: &'a str,
        wallet_address: &'a str,
        sequence: u64,
        timestamp: i64,
        kind: &'a AuditRecordKind,
    }
    let input = HashInput { prev_hash, wallet_address, sequence, timestamp, kind };
    // `AuditRecordKind` and the primitive fields alongside it always
    // serialize; this cannot fail for any value this module constructs.
    let bytes = serde_json::to_vec(&input).expect("AuditRecordKind always serializes");
    let digest = alloy::primitives::keccak256(&bytes);
    hex::encode(digest.as_slice())
}

/// Append one JSONL line to `path`, creating it (mode 0600, set at creation
/// — never widened afterward) if it does not exist. `sync_all()` after
/// every write, matching `envelope::audit::AuditLog::write_entry`'s
/// durability guarantee: a crash mid-write must not leave a torn record
/// this module's own chain would later flag as corrupt.
fn append_line(path: &Path, record: &AuditRecord) -> Result<(), String> {
    let mut options = std::fs::OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| e.to_string())?;
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    writeln!(file, "{line}").map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    Ok(())
}

/// The last record in a wallet's log, or `None` if the log does not exist
/// yet or is empty. A last line that fails to parse is `Err`, not `None` —
/// silently treating unparsable history as "no history" would let
/// `append_in` build a fresh chain on top of tampered data without saying
/// so.
fn read_last_record(path: &Path) -> Result<Option<AuditRecord>, String> {
    let contents = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    match contents.lines().rev().find(|l| !l.trim().is_empty()) {
        None => Ok(None),
        Some(line) => serde_json::from_str::<AuditRecord>(line)
            .map(Some)
            .map_err(|e| format!("last audit record for this wallet is not valid JSON: {e}")),
    }
}

/// Append a new record to `wallet_address`'s chain under `dir`, computing
/// its `sequence`/`prev_hash`/`hash` from whatever is currently the last
/// record on disk (or the genesis state, if this is the first record).
/// Returns the record actually written, hash included, so a caller never
/// has to recompute it to know what was just persisted.
pub fn append_in(
    dir: &Path,
    wallet_address: &str,
    kind: AuditRecordKind,
    timestamp: i64,
) -> Result<AuditRecord, String> {
    let wallet_address = wallet_address.to_lowercase();
    let path = log_path(dir, &wallet_address);

    let (prev_hash, sequence) = match read_last_record(&path)? {
        Some(last) => (last.hash, last.sequence + 1),
        None => (GENESIS_HASH.to_string(), 0),
    };

    let hash = compute_hash(&prev_hash, &wallet_address, sequence, timestamp, &kind);
    let record = AuditRecord { wallet_address, sequence, timestamp, kind, prev_hash, hash };

    append_line(&path, &record)?;
    Ok(record)
}

/// `append_in` against the standard app-data location.
pub fn append(wallet_address: &str, kind: AuditRecordKind, timestamp: i64) -> Result<AuditRecord, String> {
    let dir = default_dir()?;
    append_in(&dir, wallet_address, kind, timestamp)
}

/// Walk `wallet_address`'s full log under `dir` and confirm every record's
/// `sequence`, `prev_hash`, and content `hash` are internally consistent.
/// A missing log file is a trivially valid (empty) chain. The brief
/// requires this to run at startup and before export, and requires a
/// verification failure to lock autonomous execution for the affected
/// wallet — wiring that lockout into the engine/startup path is follow-up
/// work; this function only makes the check itself correct and testable.
pub fn verify_chain_in(dir: &Path, wallet_address: &str) -> Result<(), ChainVerificationError> {
    let path = log_path(dir, wallet_address);
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(ChainVerificationError {
                at_sequence: 0,
                reason: format!("could not read audit log: {e}"),
            })
        }
    };

    let mut expected_prev_hash = GENESIS_HASH.to_string();
    let mut expected_sequence: u64 = 0;

    for (line_no, line) in contents.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let record: AuditRecord = serde_json::from_str(line).map_err(|e| ChainVerificationError {
            at_sequence: expected_sequence,
            reason: format!("line {} is not valid JSON: {e}", line_no + 1),
        })?;

        if record.sequence != expected_sequence {
            return Err(ChainVerificationError {
                at_sequence: expected_sequence,
                reason: format!(
                    "expected sequence {expected_sequence}, found {} — a record was deleted, \
                     reordered, or duplicated",
                    record.sequence
                ),
            });
        }
        if record.prev_hash != expected_prev_hash {
            return Err(ChainVerificationError {
                at_sequence: record.sequence,
                reason: "prev_hash does not match the previous record's hash — chain link is \
                         broken"
                    .to_string(),
            });
        }

        let recomputed = compute_hash(
            &record.prev_hash,
            &record.wallet_address,
            record.sequence,
            record.timestamp,
            &record.kind,
        );
        if recomputed != record.hash {
            return Err(ChainVerificationError {
                at_sequence: record.sequence,
                reason: "record content hash does not match its stored hash — record was \
                         tampered with or corrupted"
                    .to_string(),
            });
        }

        expected_prev_hash = record.hash;
        expected_sequence += 1;
    }

    Ok(())
}

/// `verify_chain_in` against the standard app-data location.
pub fn verify_chain(wallet_address: &str) -> Result<(), ChainVerificationError> {
    match default_dir() {
        Ok(dir) => verify_chain_in(&dir, wallet_address),
        Err(e) => Err(ChainVerificationError {
            at_sequence: 0,
            reason: format!("audit persistence unavailable: {e}"),
        }),
    }
}

/// Every record in `wallet_address`'s log under `dir`, oldest first. A
/// missing log is `Ok(vec![])` — "no history yet" is not an error, mirrors
/// this codebase's "empty result is `Ok`, not `Err`" convention. A line that
/// fails to parse is `Err`, not silently dropped: unlike `store::list_all_in`
/// (which lists independent wallets and can afford to skip one bad file),
/// skipping a bad line here would silently break the sequence numbering a
/// viewer relies on to reason about the chain.
pub fn list_records_in(dir: &Path, wallet_address: &str) -> Result<Vec<AuditRecord>, String> {
    let path = log_path(dir, wallet_address);
    let contents = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    contents
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<AuditRecord>(line)
                .map_err(|e| format!("audit record is not valid JSON: {e}"))
        })
        .collect()
}

/// `list_records_in` against the standard app-data location.
pub fn list_records(wallet_address: &str) -> Result<Vec<AuditRecord>, String> {
    let dir = default_dir()?;
    list_records_in(&dir, wallet_address)
}

/// Combined view for a UI/audit viewer: every record plus whether the chain
/// still verifies. Bundled into one type so a caller can never show the
/// records without also being handed (and having to consciously ignore) the
/// verification result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLogView {
    pub records: Vec<AuditRecord>,
    pub chain_valid: bool,
    /// `None` when `chain_valid` is true; the human-readable reason
    /// otherwise.
    pub chain_error: Option<String>,
}

/// `list_records_in` + `verify_chain_in`, combined. A records-read failure
/// (corrupt JSON) still propagates as `Err` — there is nothing useful to
/// show. A chain-verification failure does not: the records themselves are
/// still returned so a viewer can display them and point at exactly where
/// the tampering was detected via `chain_error`.
pub fn wallet_audit_view_in(dir: &Path, wallet_address: &str) -> Result<AuditLogView, String> {
    let records = list_records_in(dir, wallet_address)?;
    match verify_chain_in(dir, wallet_address) {
        Ok(()) => Ok(AuditLogView { records, chain_valid: true, chain_error: None }),
        Err(e) => Ok(AuditLogView { records, chain_valid: false, chain_error: Some(e.to_string()) }),
    }
}

/// `wallet_audit_view_in` against the standard app-data location.
pub fn wallet_audit_view(wallet_address: &str) -> Result<AuditLogView, String> {
    let dir = default_dir()?;
    wallet_audit_view_in(&dir, wallet_address)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALLET: &str = "0x000000000000000000000000000000000000dead";

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-autonomy-audit-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn decision_record(matched_rule_index: Option<usize>) -> AuditRecordKind {
        AuditRecordKind::Decision {
            outcome: AutonomyDecision::Allow { reason: "test".to_string() },
            matched_rule_index,
        }
    }

    // ── Empty chain ──────────────────────────────────────────────────────

    #[test]
    fn empty_log_verifies_trivially_true() {
        let dir = tmp_dir("empty");
        assert!(verify_chain_in(&dir, WALLET).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Genesis linkage ─────────────────────────────────────────────────

    #[test]
    fn first_record_links_to_the_genesis_hash() {
        let dir = tmp_dir("genesis");
        let record = append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        assert_eq!(record.sequence, 0);
        assert_eq!(record.prev_hash, GENESIS_HASH);
        assert!(verify_chain_in(&dir, WALLET).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Normal chain of several records ────────────────────────────────

    #[test]
    fn a_chain_of_several_records_verifies_clean() {
        let dir = tmp_dir("chain");
        let r0 = append_in(&dir, WALLET, decision_record(Some(0)), 1000).unwrap();
        let r1 = append_in(
            &dir,
            WALLET,
            AuditRecordKind::Approved { note: Some("manual ok".into()) },
            1001,
        )
        .unwrap();
        let r2 = append_in(
            &dir,
            WALLET,
            AuditRecordKind::Broadcast { tx_hash: "0xabc".into() },
            1002,
        )
        .unwrap();
        let r3 = append_in(
            &dir,
            WALLET,
            AuditRecordKind::Finalized { tx_hash: "0xabc".into(), confirmations: 12 },
            1003,
        )
        .unwrap();

        assert_eq!(r0.sequence, 0);
        assert_eq!(r1.sequence, 1);
        assert_eq!(r2.sequence, 2);
        assert_eq!(r3.sequence, 3);
        assert_eq!(r1.prev_hash, r0.hash);
        assert_eq!(r2.prev_hash, r1.hash);
        assert_eq!(r3.prev_hash, r2.hash);

        assert!(verify_chain_in(&dir, WALLET).is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn jsonl_format_is_one_record_per_line() {
        let dir = tmp_dir("jsonl");
        for i in 0..3 {
            append_in(&dir, WALLET, decision_record(None), 1000 + i).unwrap();
        }
        let path = log_path(&dir, WALLET);
        let contents = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = contents.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(lines.len(), 3);
        for line in lines {
            // Each line must be independently parseable JSON (not one big array).
            assert!(serde_json::from_str::<AuditRecord>(line).is_ok());
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Tamper detection ────────────────────────────────────────────────

    #[test]
    fn tampering_a_middle_record_content_is_detected() {
        let dir = tmp_dir("tamper-content");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, AuditRecordKind::Broadcast { tx_hash: "0xabc".into() }, 1001).unwrap();
        append_in(&dir, WALLET, AuditRecordKind::Finalized { tx_hash: "0xabc".into(), confirmations: 1 }, 1002)
            .unwrap();

        let path = log_path(&dir, WALLET);
        let contents = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<String> = contents.lines().map(String::from).collect();

        // Rewrite record 1's content (tx_hash) without touching its stored
        // hash field — simulates an attacker editing history in place.
        let mut tampered: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
        tampered["kind"]["tx_hash"] = serde_json::json!("0xdeadbeef");
        lines[1] = serde_json::to_string(&tampered).unwrap();

        std::fs::write(&path, lines.join("\n") + "\n").unwrap();

        let result = verify_chain_in(&dir, WALLET);
        assert!(result.is_err(), "tampered record must fail verification");
        let err = result.unwrap_err();
        assert_eq!(err.at_sequence, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn tampering_the_prev_hash_field_is_detected() {
        let dir = tmp_dir("tamper-prev-hash");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, decision_record(None), 1001).unwrap();

        let path = log_path(&dir, WALLET);
        let contents = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<String> = contents.lines().map(String::from).collect();

        let mut tampered: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
        tampered["prev_hash"] = serde_json::json!(
            "1111111111111111111111111111111111111111111111111111111111111111111111111111"
        );
        lines[1] = serde_json::to_string(&tampered).unwrap();
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();

        let result = verify_chain_in(&dir, WALLET);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().at_sequence, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn deleting_a_middle_record_breaks_the_sequence_and_is_detected() {
        let dir = tmp_dir("tamper-delete");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, decision_record(None), 1001).unwrap();
        append_in(&dir, WALLET, decision_record(None), 1002).unwrap();

        let path = log_path(&dir, WALLET);
        let contents = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = contents.lines().collect();
        // Drop the middle record entirely.
        let rewritten = format!("{}\n{}\n", lines[0], lines[2]);
        std::fs::write(&path, rewritten).unwrap();

        let result = verify_chain_in(&dir, WALLET);
        assert!(result.is_err(), "a deleted record must break the chain, not pass silently");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn corrupt_json_line_is_detected_not_silently_skipped() {
        let dir = tmp_dir("tamper-corrupt-json");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        let path = log_path(&dir, WALLET);
        let mut file = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(file, "{{not valid json").unwrap();

        let result = verify_chain_in(&dir, WALLET);
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_after_a_corrupt_last_record_fails_loudly_instead_of_building_on_top_of_it() {
        let dir = tmp_dir("append-after-corrupt");
        let path = log_path(&dir, WALLET);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, "{not valid json\n").unwrap();

        let result = append_in(&dir, WALLET, decision_record(None), 2000);
        assert!(result.is_err(), "must not silently start a fresh chain on top of corrupt history");
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── Per-wallet isolation ────────────────────────────────────────────

    #[test]
    fn different_wallets_get_independent_chains() {
        let dir = tmp_dir("isolation");
        const WALLET_B: &str = "0x00000000000000000000000000000000000beef";

        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET_B, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, decision_record(None), 1001).unwrap();

        assert!(verify_chain_in(&dir, WALLET).is_ok());
        assert!(verify_chain_in(&dir, WALLET_B).is_ok());

        let a_contents = std::fs::read_to_string(log_path(&dir, WALLET)).unwrap();
        let b_contents = std::fs::read_to_string(log_path(&dir, WALLET_B)).unwrap();
        assert_eq!(a_contents.lines().filter(|l| !l.trim().is_empty()).count(), 2);
        assert_eq!(b_contents.lines().filter(|l| !l.trim().is_empty()).count(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── list_records_in / wallet_audit_view_in ─────────────────────────

    #[test]
    fn list_records_in_returns_empty_vec_for_a_wallet_with_no_log_yet() {
        let dir = tmp_dir("list-empty");
        assert_eq!(list_records_in(&dir, WALLET).unwrap(), Vec::new());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn list_records_in_returns_every_record_oldest_first() {
        let dir = tmp_dir("list-records");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, AuditRecordKind::Broadcast { tx_hash: "0xabc".into() }, 1001).unwrap();

        let records = list_records_in(&dir, WALLET).unwrap();
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].sequence, 0);
        assert_eq!(records[1].sequence, 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wallet_audit_view_in_reports_valid_chain_with_all_records() {
        let dir = tmp_dir("view-valid");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();

        let view = wallet_audit_view_in(&dir, WALLET).unwrap();
        assert!(view.chain_valid);
        assert!(view.chain_error.is_none());
        assert_eq!(view.records.len(), 1);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn wallet_audit_view_in_still_returns_records_when_chain_is_tampered() {
        let dir = tmp_dir("view-tampered");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        append_in(&dir, WALLET, AuditRecordKind::Broadcast { tx_hash: "0xabc".into() }, 1001).unwrap();

        let path = log_path(&dir, WALLET);
        let contents = std::fs::read_to_string(&path).unwrap();
        let mut lines: Vec<String> = contents.lines().map(String::from).collect();
        let mut tampered: serde_json::Value = serde_json::from_str(&lines[1]).unwrap();
        tampered["kind"]["tx_hash"] = serde_json::json!("0xdeadbeef");
        lines[1] = serde_json::to_string(&tampered).unwrap();
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();

        let view = wallet_audit_view_in(&dir, WALLET).unwrap();
        assert!(!view.chain_valid);
        assert!(view.chain_error.is_some());
        // Records are still surfaced so a viewer can show them alongside the warning.
        assert_eq!(view.records.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    // ── File permissions ────────────────────────────────────────────────

    #[cfg(unix)]
    #[test]
    fn audit_file_is_created_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp_dir("mode");
        append_in(&dir, WALLET, decision_record(None), 1000).unwrap();
        let path = log_path(&dir, WALLET);
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "audit file mode was {mode:o}, expected 600");
        std::fs::remove_dir_all(&dir).ok();
    }
}
