//! Per-wallet persistence for proposals stuck at `RequiresApproval`.
//!
//! `AutonomyEngine::evaluate` never turns `RequiresApproval` into `Allow` by
//! itself — Manual/Assisted mode always requires a human, and Autonomous
//! mode never auto-executes a hard-banned action type (see `engine.rs`).
//! Before this module existed, a `RequiresApproval` decision was simply a
//! dead end: the caller got an error and the proposal was gone. This module
//! is the missing piece — it gives a `RequiresApproval` proposal somewhere to
//! live until a human explicitly approves or rejects it.
//!
//! Same file-per-wallet convention as `store.rs`/`audit.rs`: one JSON file
//! under `autonomy_pending/`, keyed by the lowercased wallet address, holding
//! that wallet's list of pending proposals. Unlike `store.rs` (one policy
//! object) or `audit.rs` (an append-only log), entries here are mutated in
//! place — a proposal's `status` moves from `Pending` to `Approved`/
//! `Rejected` — so the file holds a small `Vec`, rewritten atomically on
//! every change via the same `persist::write_json` helper everything else in
//! this module already uses.
//!
//! `find_by_id_in`/`resolve_in` deliberately do NOT take a `wallet_address`:
//! `approve_action_proposal(id)`/`reject_action_proposal(id)` only have an
//! id to work with (that is the command shape the frontend needs — a user
//! approving from a flat "pending actions" list should not have to also
//! supply which wallet it belongs to). Scanning every wallet's small pending
//! file to find one id is trivial at this scale and preserves the same
//! per-wallet file isolation `store.rs` already established: resolving one
//! wallet's proposal never rewrites another wallet's file.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::autonomy::types::ActionProposal;
use crate::marketplace::types::OrderResult;
use crate::nft::TokenStandard;

const PENDING_DIR: &str = "autonomy_pending";

/// How long a `RequiresApproval` proposal stays approvable after it was
/// created.
///
/// Approving a stale request is its own risk, distinct from whether it was
/// safe when it was proposed: a marketplace listing/bid carries a price that
/// can go stale as the market moves, and even a plain transfer approved long
/// after the fact is a decision the user may no longer actually endorse — a
/// click made hours ago under different circumstances. 24 hours is a
/// deliberately simple, uniform v1 answer: long enough that a user checking
/// their phone once a day still has time to act, short enough that nothing
/// sits in "pending" indefinitely waiting for a decision the surrounding
/// context has already moved past. It is intentionally the same for every
/// action type in v1 rather than tuned per `ActionType` — that is a
/// reasonable place to add nuance later if a single window proves wrong in
/// practice, not a gap to silently paper over now.
pub const PENDING_TTL_SECONDS: i64 = 24 * 60 * 60;

/// `~/Library/Application Support/Westron/autonomy_pending/` on macOS, the
/// platform data dir equivalent elsewhere.
///
/// `pub(crate)` (not private) so `lib.rs` can pass the real directory into
/// `approve_action_proposal_in` while tests pass an isolated tmp dir instead
/// — same reason every `_in` function here takes a `dir` parameter.
pub(crate) fn default_dir() -> Result<PathBuf, String> {
    let dir = crate::persist::app_file(PENDING_DIR)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn pending_path(dir: &Path, wallet_address: &str) -> PathBuf {
    dir.join(format!("{}.json", wallet_address.to_lowercase()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingStatus {
    Pending,
    Approved,
    Rejected,
    /// Never written by a background sweep — this module never mutates a
    /// file just because time passed. It is only ever produced by
    /// `PendingActionProposal::effective_status`, computed at read time, so
    /// listing/approving a stale proposal cannot race a sweep that also
    /// wants to write the same file.
    Expired,
}

/// Everything needed to actually perform the original action later — not
/// just enough to describe it. Deliberately excludes any API key or private
/// key: those are re-fetched fresh from the Keychain at approval time
/// (`wallet::keychain::fetch_alchemy_key`/`fetch_opensea_key`), exactly like
/// every other signing/marketplace command already does. A credential
/// sitting in a plaintext pending-proposal file on disk for up to 24 hours
/// is a needless new exposure this design avoids entirely by never writing
/// one there in the first place.
///
/// Also deliberately excludes nonce and gas price: those are read live by
/// `LocalSigner::sign_and_send` at the moment of signing, never cached here,
/// so an approval that lands hours after the proposal was queued can never
/// broadcast against a stale nonce or gas price — the same freshness
/// guarantee an immediate send already had.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingActionPayload {
    SendEth {
        to: String,
        /// Decimal wei string — see `ActionProposal::value_wei`'s own
        /// rationale for never using a float here.
        value_wei: String,
    },
    TransferNft {
        contract_address: String,
        token_id: String,
        to: String,
        token_standard: TokenStandard,
        amount: Option<String>,
    },
    MarketplaceList {
        contract_address: String,
        token_id: String,
        price_eth: f64,
        marketplace: String,
        expiry_hours: u64,
    },
    MarketplaceBid {
        contract_address: String,
        price_eth: f64,
        quantity: u32,
        marketplace: String,
        expiry_hours: u64,
    },
    MarketplaceCancel {
        order_hash: String,
        marketplace: String,
    },
}

/// What executing an approved proposal actually produced — the two shapes
/// `send_eth`/`transfer_nft` (a tx hash) and the marketplace commands (an
/// `OrderResult`) already return today, unified so `approve_action_proposal`
/// has one return type regardless of which kind of proposal it resolved.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ApprovalResult {
    TxSent { tx_hash: String },
    OrderCompleted { result: OrderResult },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingActionProposal {
    pub id: String,
    pub wallet_address: String,
    pub proposal: ActionProposal,
    /// The `RequiresApproval` decision's own `reason` — why the policy
    /// engine could not decide this by itself.
    pub reason: String,
    pub payload: PendingActionPayload,
    pub created_at: i64,
    pub status: PendingStatus,
}

impl PendingActionProposal {
    /// `status` as stored, except a `Pending` entry older than
    /// `PENDING_TTL_SECONDS` reports as `Expired` — computed on the fly, not
    /// persisted, so reading/listing pending proposals is never a write.
    pub fn effective_status(&self, now: i64) -> PendingStatus {
        if self.status == PendingStatus::Pending && now - self.created_at > PENDING_TTL_SECONDS {
            PendingStatus::Expired
        } else {
            self.status
        }
    }
}

/// A wallet's pending proposals, oldest first. A wallet with no pending file
/// yet returns `Ok(vec![])`, matching this project's "empty result is not an
/// error" rule.
pub fn list_in(dir: &Path, wallet_address: &str) -> Result<Vec<PendingActionProposal>, String> {
    let items = crate::persist::read_json::<Vec<PendingActionProposal>>(&pending_path(dir, wallet_address))?
        .unwrap_or_default();
    Ok(items)
}

pub fn list(wallet_address: &str) -> Result<Vec<PendingActionProposal>, String> {
    list_in(&default_dir()?, wallet_address)
}

fn save_list_in(dir: &Path, wallet_address: &str, items: &[PendingActionProposal]) -> Result<(), String> {
    crate::persist::write_json(&pending_path(dir, wallet_address), &items.to_vec())
}

/// Append a new pending proposal to its wallet's file.
///
/// This is NOT best-effort like an audit-log append: the pending file is the
/// only record of the user's queued request, so a failure here must be a
/// loud error back to whoever tried to queue the action, not a logged
/// warning that leaves the caller believing the request was saved when it
/// was not.
pub fn add_in(dir: &Path, item: PendingActionProposal) -> Result<(), String> {
    let mut items = list_in(dir, &item.wallet_address)?;
    items.push(item.clone());
    save_list_in(dir, &item.wallet_address, &items)
}

pub fn add(item: PendingActionProposal) -> Result<(), String> {
    add_in(&default_dir()?, item)
}

/// Scan every wallet's pending file for `id`. `Ok(None)` if no wallet has a
/// proposal with that id — distinct from a corrupt file, which is logged and
/// skipped exactly like `store::list_all_in` does, so one unreadable
/// wallet's file cannot hide every other wallet's proposals from this scan.
pub fn find_by_id_in(dir: &Path, id: &str) -> Result<Option<PendingActionProposal>, String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match crate::persist::read_json::<Vec<PendingActionProposal>>(&path) {
            Ok(Some(items)) => {
                if let Some(found) = items.into_iter().find(|p| p.id == id) {
                    return Ok(Some(found));
                }
            }
            Ok(None) => {}
            Err(e) => log::error!("skipping unreadable pending-proposal file {path:?}: {e}"),
        }
    }
    Ok(None)
}

pub fn find_by_id(id: &str) -> Result<Option<PendingActionProposal>, String> {
    find_by_id_in(&default_dir()?, id)
}

/// Move proposal `id` from `Pending` to `new_status` (`Approved` or
/// `Rejected`) and persist it. Refuses — with a message naming the actual
/// current state — unless `effective_status(now)` is exactly `Pending`:
/// an already-resolved proposal cannot be resolved a second time, and an
/// expired one cannot be approved or rejected at all (rejecting an expired
/// proposal is a no-op with extra steps; the caller already knows it will
/// never execute).
///
/// Callers are responsible for everything *else* that "approving" implies —
/// re-checking the kill switch and the wallet's current policy, actually
/// performing the action, and rolling back on failure — this function only
/// owns the pending-proposal record's own state transition.
pub fn resolve_in(
    dir: &Path,
    id: &str,
    new_status: PendingStatus,
    now: i64,
) -> Result<PendingActionProposal, String> {
    let Some(found) = find_by_id_in(dir, id)? else {
        return Err(format!("No pending action proposal found with id {id}"));
    };
    let current = found.effective_status(now);
    if current != PendingStatus::Pending {
        return Err(format!(
            "Pending action proposal {id} is already {current:?} and cannot be resolved again"
        ));
    }

    let mut items = list_in(dir, &found.wallet_address)?;
    let Some(slot) = items.iter_mut().find(|p| p.id == id) else {
        return Err(format!("No pending action proposal found with id {id}"));
    };
    slot.status = new_status;
    let resolved = slot.clone();
    save_list_in(dir, &found.wallet_address, &items)?;
    Ok(resolved)
}

pub fn resolve(id: &str, new_status: PendingStatus, now: i64) -> Result<PendingActionProposal, String> {
    resolve_in(&default_dir()?, id, new_status, now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::autonomy::types::ActionType;

    fn tmp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("westron-pending-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const WALLET: &str = "0x000000000000000000000000000000000000dead";

    fn sample(id: &str, wallet: &str, created_at: i64) -> PendingActionProposal {
        PendingActionProposal {
            id: id.to_string(),
            wallet_address: wallet.to_string(),
            proposal: ActionProposal {
                action_type: ActionType::TransferNative,
                wallet_address: wallet.to_string(),
                target_contract: Some("0x00000000000000000000000000000000000beef".to_string()),
                calldata: None,
                value_wei: 1_000_000_000_000_000_000,
                chain_id: 1,
            },
            reason: "manual mode always requires approval".to_string(),
            payload: PendingActionPayload::SendEth {
                to: "0x00000000000000000000000000000000000beef".to_string(),
                value_wei: "1000000000000000000".to_string(),
            },
            created_at,
            status: PendingStatus::Pending,
        }
    }

    #[test]
    fn list_in_returns_empty_vec_for_a_wallet_with_no_pending_file_yet() {
        let dir = tmp_dir("empty");
        assert!(list_in(&dir, WALLET).unwrap().is_empty());
    }

    #[test]
    fn add_in_then_list_in_round_trips() {
        let dir = tmp_dir("roundtrip");
        add_in(&dir, sample("p1", WALLET, 1000)).unwrap();
        add_in(&dir, sample("p2", WALLET, 2000)).unwrap();

        let all = list_in(&dir, WALLET).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].id, "p1");
        assert_eq!(all[1].id, "p2");
    }

    #[test]
    fn find_by_id_in_locates_a_proposal_across_wallet_files() {
        let dir = tmp_dir("find");
        const OTHER_WALLET: &str = "0x00000000000000000000000000000000000beef";
        add_in(&dir, sample("p1", WALLET, 1000)).unwrap();
        add_in(&dir, sample("p2", OTHER_WALLET, 1000)).unwrap();

        let found = find_by_id_in(&dir, "p2").unwrap().expect("p2 must be found");
        assert_eq!(found.wallet_address, OTHER_WALLET);
        assert!(find_by_id_in(&dir, "does-not-exist").unwrap().is_none());
    }

    #[test]
    fn effective_status_reports_expired_after_ttl_without_mutating_the_stored_status() {
        let item = sample("p1", WALLET, 0);
        assert_eq!(item.effective_status(PENDING_TTL_SECONDS - 1), PendingStatus::Pending);
        assert_eq!(item.effective_status(PENDING_TTL_SECONDS + 1), PendingStatus::Expired);
        // The stored field itself never changes just from asking.
        assert_eq!(item.status, PendingStatus::Pending);
    }

    #[test]
    fn resolve_in_transitions_pending_to_approved_and_persists() {
        let dir = tmp_dir("resolve-approve");
        add_in(&dir, sample("p1", WALLET, 1000)).unwrap();

        let resolved = resolve_in(&dir, "p1", PendingStatus::Approved, 1500).unwrap();
        assert_eq!(resolved.status, PendingStatus::Approved);

        // Persisted, not just returned in-memory.
        let reloaded = find_by_id_in(&dir, "p1").unwrap().unwrap();
        assert_eq!(reloaded.status, PendingStatus::Approved);
    }

    #[test]
    fn resolve_in_refuses_to_resolve_an_already_resolved_proposal() {
        let dir = tmp_dir("resolve-twice");
        add_in(&dir, sample("p1", WALLET, 1000)).unwrap();
        resolve_in(&dir, "p1", PendingStatus::Rejected, 1500).unwrap();

        let err = resolve_in(&dir, "p1", PendingStatus::Approved, 1600).unwrap_err();
        assert!(err.contains("Rejected"), "error should name the current status, got: {err}");

        // Rejecting it did not silently flip to approved afterwards.
        let reloaded = find_by_id_in(&dir, "p1").unwrap().unwrap();
        assert_eq!(reloaded.status, PendingStatus::Rejected);
    }

    #[test]
    fn resolve_in_refuses_to_approve_an_expired_proposal() {
        let dir = tmp_dir("resolve-expired");
        add_in(&dir, sample("p1", WALLET, 0)).unwrap();

        let now = PENDING_TTL_SECONDS + 1;
        let err = resolve_in(&dir, "p1", PendingStatus::Approved, now).unwrap_err();
        assert!(err.contains("Expired"), "error should name Expired, got: {err}");

        // The stored status is untouched — still literally `Pending` on disk,
        // it is only the TTL comparison that made it un-approvable.
        let reloaded = find_by_id_in(&dir, "p1").unwrap().unwrap();
        assert_eq!(reloaded.status, PendingStatus::Pending);
    }

    #[test]
    fn resolve_in_reports_a_clear_error_for_an_unknown_id() {
        let dir = tmp_dir("resolve-unknown");
        let err = resolve_in(&dir, "does-not-exist", PendingStatus::Approved, 0).unwrap_err();
        assert!(err.contains("does-not-exist"));
    }
}
