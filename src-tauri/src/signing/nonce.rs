//! Per-address nonce allocation.
//!
//! The defect this exists to fix: `sign_and_send` read the nonce with
//! `eth_getTransactionCount(addr, "latest")` and used it immediately. Two sends
//! issued before the first was mined therefore got the *same* nonce, and the
//! second **replaced** the first on the network. The user saw two transaction
//! hashes and believed two transfers had gone out; one silently never happened.
//! On a wallet manager whose entire job is moving money, that is the worst
//! class of bug — a loss with a success message on top of it.
//!
//! Three things together fix it:
//!
//! 1. **`"pending"` instead of `"latest"`.** `latest` counts only mined
//!    transactions, so anything sitting in the mempool is invisible to it.
//! 2. **A per-from-address lock**, held across read-nonce → sign → broadcast.
//!    `pending` on its own is still racy: two tasks can both read it before
//!    either has broadcast.
//! 3. **An in-process record of the last nonce used**, because even a serialised
//!    second send can observe a stale `pending` (the node has not yet counted
//!    the transaction we broadcast a millisecond ago). Consecutive sends then
//!    increment instead of colliding.
//!
//! The allocation rule is `max(cached_next, chain_pending)`: trust our own
//! record when the node is behind, and trust the node when it is ahead — which
//! is what happens when the same key is used from another wallet client, or
//! after a restart when we have no record at all.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

/// In-process view of the next nonce to use for one address.
#[derive(Debug, Default)]
pub struct AddressNonce {
    /// The nonce to use next, if we have successfully broadcast before.
    next: Option<u64>,
    /// The highest nonce we have ever *committed* (successfully broadcast) for
    /// this address. Kapı-2 / M1: `invalidate()` must never let the record fall
    /// below this, otherwise a failed send that interleaves a burst can reset
    /// the record and hand a later send a nonce we already used — silently
    /// replacing an in-flight transaction. This is the high-water floor.
    highest_committed: Option<u64>,
}

impl AddressNonce {
    pub fn new() -> Self {
        Self { next: None, highest_committed: None }
    }

    /// Choose the nonce for the next transaction from this address.
    ///
    /// Takes whichever is higher: what the chain reports pending, or what we
    /// know we already used. Never goes backwards, which is the only way to
    /// replace a transaction the user did not ask to replace.
    pub fn allocate(&mut self, chain_pending: u64) -> u64 {
        match self.next {
            Some(cached) if cached > chain_pending => cached,
            _ => chain_pending,
        }
    }

    /// Record a successful broadcast. The next send uses `used + 1`.
    pub fn commit(&mut self, used: u64) {
        self.next = Some(used.saturating_add(1));
        self.highest_committed = Some(match self.highest_committed {
            Some(h) => h.max(used),
            None => used,
        });
    }

    /// Drop our forward record after a failed send, but never below the
    /// high-water mark of nonces we have already committed.
    ///
    /// Called after *any* failed send, not just nonce faults: a transport error
    /// or timeout can hide a transaction that actually reached the mempool, so
    /// on the next allocate we still want to re-read `pending` (the chain may
    /// have advanced). But we must NOT forget nonces we already committed —
    /// Kapı-2 / M1: resetting all the way to `None` let a failed send that
    /// interleaves a burst hand a later send a nonce a prior committed send is
    /// still holding in the mempool, silently replacing it. So we fall back to
    /// `highest_committed + 1`, and `allocate` still takes `max(that, pending)`:
    /// the chain wins if it has moved ahead (a hidden send landed), our floor
    /// wins if the node is merely behind. A nonce that failed *without* ever
    /// committing (e.g. this very send) is below the floor and gets reused —
    /// which is correct, it never reached anyone.
    pub fn invalidate(&mut self) {
        self.next = self.highest_committed.map(|h| h.saturating_add(1));
    }

    /// The cached next nonce, for tests and diagnostics.
    pub fn peek(&self) -> Option<u64> {
        self.next
    }
}

/// One lock per from-address, shared process-wide.
pub type NonceSlot = Arc<tokio::sync::Mutex<AddressNonce>>;

fn registry() -> &'static Mutex<HashMap<String, NonceSlot>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, NonceSlot>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The nonce slot for `address`, creating it on first use.
///
/// Addresses are keyed case-insensitively: EIP-55 checksummed and all-lowercase
/// spellings of one address are the same account, and treating them as two
/// would hand out the same nonce twice — reintroducing the exact bug.
pub fn slot_for(address: &str) -> NonceSlot {
    let key = address.trim().to_lowercase();
    let mut map = registry().lock().unwrap();
    Arc::clone(map.entry(key).or_insert_with(|| Arc::new(tokio::sync::Mutex::new(AddressNonce::new()))))
}

/// A send failure that is specifically about the nonce.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NonceFault {
    /// The account has already moved past this nonce — it was mined elsewhere.
    TooLow,
    /// A transaction with this nonce is pending and our fee does not beat it.
    /// Critically, this means we were about to REPLACE it.
    ReplacementUnderpriced,
    /// This exact transaction is already in the mempool.
    AlreadyKnown,
}

/// Recognise the node's nonce-related rejections.
///
/// Geth, Erigon and Alchemy all phrase these slightly differently and none of
/// them use a stable error code for it, so matching on the message text is the
/// available option. Matching is case-insensitive and substring-based.
pub fn classify_send_error(message: &str) -> Option<NonceFault> {
    let m = message.to_lowercase();
    if m.contains("nonce too low") || m.contains("nonce is too low") {
        return Some(NonceFault::TooLow);
    }
    if m.contains("replacement transaction underpriced")
        || m.contains("replacement fee too low")
        || m.contains("could not replace existing tx")
    {
        return Some(NonceFault::ReplacementUnderpriced);
    }
    if m.contains("already known") {
        return Some(NonceFault::AlreadyKnown);
    }
    None
}

/// Turn a nonce fault into something a user can act on.
///
/// `chain_pending` is what the chain says *after* the failure, re-read on
/// purpose: the whole point is to report where the account actually is rather
/// than silently retrying and possibly replacing a pending transaction.
pub fn describe_fault(
    fault: NonceFault,
    attempted: u64,
    chain_pending: Option<u64>,
    raw: &str,
) -> String {
    let chain = match chain_pending {
        Some(n) => format!("the chain now reports nonce {n} as next"),
        None => "the chain could not be re-read for the current nonce".to_string(),
    };
    match fault {
        NonceFault::TooLow => format!(
            "Transaction not sent: nonce {attempted} has already been used by this account \
             ({chain}). Nothing was broadcast and nothing was replaced. Retry the send — it \
             will pick up the current nonce. (node said: {raw})"
        ),
        NonceFault::ReplacementUnderpriced => format!(
            "Transaction not sent: another transaction with nonce {attempted} is already \
             pending from this account, and sending this one would have REPLACED it ({chain}). \
             Westron refused rather than cancel a transfer you did not ask to cancel. Wait for \
             the pending transaction to confirm, then retry. (node said: {raw})"
        ),
        NonceFault::AlreadyKnown => format!(
            "This exact transaction is already in the mempool with nonce {attempted} ({chain}); \
             it was not sent twice. Wait for it to confirm. (node said: {raw})"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Allocation ────────────────────────────────────────────────────────────

    #[test]
    fn first_send_takes_the_nonce_from_the_chain() {
        let mut n = AddressNonce::new();
        assert_eq!(n.allocate(7), 7);
        assert!(n.peek().is_none(), "allocate alone must not record anything");
    }

    /// The bug, directly: three sends issued before any is mined. A node that
    /// has not yet counted them keeps reporting the same `pending`.
    #[test]
    fn consecutive_sends_increment_even_when_the_chain_is_stale() {
        let mut n = AddressNonce::new();
        let stale_chain_pending = 7;

        let mut used = Vec::new();
        for _ in 0..3 {
            let nonce = n.allocate(stale_chain_pending);
            n.commit(nonce);
            used.push(nonce);
        }

        assert_eq!(used, vec![7, 8, 9], "sends collided on one nonce");
        let unique: std::collections::HashSet<_> = used.iter().collect();
        assert_eq!(unique.len(), used.len(), "a nonce was handed out twice");
    }

    #[test]
    fn a_chain_that_has_moved_ahead_wins() {
        // The same key used from another wallet client, or transactions mined
        // while we were idle. Our record is stale-low; the chain is right.
        let mut n = AddressNonce::new();
        n.commit(4); // we think 5 is next
        assert_eq!(n.allocate(20), 20);
    }

    #[test]
    fn our_record_wins_when_the_node_is_behind() {
        let mut n = AddressNonce::new();
        n.commit(9); // 10 is next
        assert_eq!(n.allocate(5), 10);
    }

    #[test]
    fn allocate_never_goes_backwards() {
        let mut n = AddressNonce::new();
        let mut last: Option<u64> = None;
        // A node that flaps between values must never make us reuse a nonce.
        for chain in [7u64, 5, 7, 6, 8, 7, 9] {
            let nonce = n.allocate(chain);
            if let Some(prev) = last {
                assert!(nonce > prev, "nonce went from {prev} back to {nonce}");
            }
            n.commit(nonce);
            last = Some(nonce);
        }
    }

    #[test]
    fn invalidate_never_falls_below_the_committed_high_water() {
        // Kapı-2 / M1: after committing 9, invalidate must NOT let a later
        // allocate reuse a nonce ≤ 9 just because the node reports a stale-low
        // pending. The chain still wins if it has genuinely moved ahead.
        let mut n = AddressNonce::new();
        n.commit(9);
        assert_eq!(n.allocate(5), 10);
        n.invalidate();
        assert_eq!(
            n.allocate(5), 10,
            "invalidate must hold the committed floor, not reuse a nonce we already broadcast"
        );
        assert_eq!(
            n.allocate(20), 20,
            "but a chain that has genuinely advanced (a hidden send landed) still wins"
        );
    }

    /// The exact M1 scenario the audit flagged: A commits nonce 7 (in mempool),
    /// send B (nonce 8) fails and invalidates, then C must not be handed 7 and
    /// silently replace A, even though the node still reports pending = 7.
    #[test]
    fn a_failed_send_after_a_commit_cannot_reuse_the_committed_nonce() {
        let mut n = AddressNonce::new();
        let stale_pending = 7;
        // A: allocate + commit 7 (now in mempool; node hasn't counted it yet).
        let a = n.allocate(stale_pending);
        n.commit(a);
        assert_eq!(a, 7);
        // B: allocate 8, then its send fails → invalidate (B never committed).
        let b = n.allocate(stale_pending);
        assert_eq!(b, 8);
        n.invalidate();
        // C: with the node still stale at pending = 7, C must reuse 8 (B's free
        // slot) — never 7, which would replace A.
        let c = n.allocate(stale_pending);
        assert_eq!(c, 8, "C reused a committed nonce and would have replaced an in-flight tx");
    }

    // ── Per-address isolation and serialisation ───────────────────────────────

    #[test]
    fn addresses_get_independent_slots_and_case_does_not_split_them() {
        let a_lower = slot_for("0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa");
        let a_upper = slot_for("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        let b = slot_for("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

        assert!(
            Arc::ptr_eq(&a_lower, &a_upper),
            "two spellings of one address must share a nonce slot"
        );
        assert!(!Arc::ptr_eq(&a_lower, &b));
    }

    /// Concurrency, against the real lock and the real registry: many tasks
    /// racing to send from one address must each receive a distinct nonce.
    #[tokio::test]
    async fn concurrent_sends_from_one_address_never_share_a_nonce() {
        let address = format!("0x{:040x}", 0xC0FFEEu64);
        // A node that never updates — the worst case, and the one that produced
        // the original bug.
        let stale_chain_pending = 100u64;

        let mut handles = Vec::new();
        for _ in 0..25 {
            let addr = address.clone();
            handles.push(tokio::spawn(async move {
                let slot = slot_for(&addr);
                let mut guard = slot.lock().await;
                let nonce = guard.allocate(stale_chain_pending);
                // Stand in for sign + broadcast, so the lock is genuinely held
                // across an await point the way the real send holds it.
                tokio::task::yield_now().await;
                guard.commit(nonce);
                nonce
            }));
        }

        let mut nonces = Vec::new();
        for h in handles {
            nonces.push(h.await.unwrap());
        }
        nonces.sort_unstable();

        let unique: std::collections::HashSet<_> = nonces.iter().copied().collect();
        assert_eq!(unique.len(), nonces.len(), "two sends got the same nonce: {nonces:?}");
        assert_eq!(
            nonces,
            (100..125).collect::<Vec<u64>>(),
            "nonces must be contiguous from the chain's pending value"
        );
    }

    // ── Error classification ─────────────────────────────────────────────────

    #[test]
    fn nonce_faults_are_recognised_across_node_phrasings() {
        assert_eq!(
            classify_send_error("RPC error -32000: nonce too low"),
            Some(NonceFault::TooLow)
        );
        assert_eq!(
            classify_send_error("Nonce is too low: next nonce 12, tx nonce 11"),
            Some(NonceFault::TooLow)
        );
        assert_eq!(
            classify_send_error("replacement transaction underpriced"),
            Some(NonceFault::ReplacementUnderpriced)
        );
        assert_eq!(
            classify_send_error("RPC error -32000: REPLACEMENT FEE TOO LOW"),
            Some(NonceFault::ReplacementUnderpriced)
        );
        assert_eq!(classify_send_error("already known"), Some(NonceFault::AlreadyKnown));
    }

    #[test]
    fn unrelated_failures_are_not_mistaken_for_nonce_faults() {
        for msg in [
            "insufficient funds for gas * price + value",
            "HTTP error: connection closed before message completed",
            "intrinsic gas too low",
            "RPC error -32000: max fee per gas less than block base fee",
        ] {
            assert_eq!(classify_send_error(msg), None, "misclassified: {msg}");
        }
    }

    /// The replacement message is the one that matters: it has to say plainly
    /// that nothing was sent and nothing was cancelled.
    #[test]
    fn fault_messages_say_what_did_and_did_not_happen() {
        let too_low = describe_fault(NonceFault::TooLow, 11, Some(12), "nonce too low");
        assert!(too_low.contains("Nothing was broadcast"), "{too_low}");
        assert!(too_low.contains("12"), "must report where the chain actually is: {too_low}");

        let replaced = describe_fault(
            NonceFault::ReplacementUnderpriced,
            11,
            Some(11),
            "replacement transaction underpriced",
        );
        assert!(replaced.contains("REPLACED"), "{replaced}");
        assert!(replaced.contains("refused"), "{replaced}");

        // A failed re-read must not produce a misleading number.
        let no_chain = describe_fault(NonceFault::TooLow, 11, None, "nonce too low");
        assert!(no_chain.contains("could not be re-read"), "{no_chain}");
    }
}
