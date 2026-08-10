use std::collections::HashMap;
use std::sync::Mutex;

use crate::autonomy::types::*;

/// Ethereum mainnet only — v1 scope, enforced unconditionally.
const MAINNET_CHAIN_ID: u64 = 1;

/// Per-rule running counters. Deliberately not part of `AutonomyRule`
/// (the wire-format domain model): this is Phase (a)'s in-memory-only
/// bookkeeping. Persistence lands in a later phase.
#[derive(Debug, Clone, Copy, Default)]
struct RuleUsage {
    total_spent_wei: u128,
    rate_window_started_at: i64,
    rate_window_count: u32,
}

/// `evaluate()`'s full verdict. `matched_rule` is the index into the
/// policy's `rules` that produced an `Allow`, so `check_and_authorize` knows
/// which counter to update — `preview_proposal` discards it.
struct EvaluationOutcome {
    decision: AutonomyDecision,
    matched_rule: Option<usize>,
}

/// Wallet-level autonomy policy engine. Holds one policy per (normalized)
/// wallet address plus each rule's running usage counters.
///
/// Mirrors `envelope::engine::EnvelopeEngine`'s shape: a single pure,
/// private `evaluate()` backs both the side-effect-free `preview_proposal`
/// and the budget-consuming `check_and_authorize` — duplicating the rule
/// chain between them is exactly the kind of drift this repo's envelope
/// engine already learned not to risk (see this project's CLAUDE.md).
pub struct AutonomyEngine {
    policies: Mutex<HashMap<String, WalletPolicy>>,
    usage: Mutex<HashMap<(String, usize), RuleUsage>>,
}

impl AutonomyEngine {
    pub fn new() -> Self {
        AutonomyEngine {
            policies: Mutex::new(HashMap::new()),
            usage: Mutex::new(HashMap::new()),
        }
    }

    fn normalize(addr: &str) -> String {
        addr.to_lowercase()
    }

    /// Test/setup helper, mirroring `EnvelopeEngine::create_envelope`. Not
    /// part of the decision API — policy mutation commands (with their own
    /// manual-confirmation protocol, per the brief) land in a later phase.
    ///
    /// Replacing a wallet's policy clears its usage counters: a freshly
    /// written policy must not inherit a previous policy's spend/rate
    /// history.
    pub fn set_wallet_policy(&self, policy: WalletPolicy) {
        let key = Self::normalize(&policy.wallet_address);
        let mut policies = self.policies.lock().unwrap();
        let mut usage = self.usage.lock().unwrap();
        usage.retain(|(addr, _), _| addr != &key);
        policies.insert(key, policy);
    }

    /// Populate this wallet's policy from `autonomy::store::load_or_default`
    /// on first access only — a caller (e.g. a signing entry point) can call
    /// this unconditionally before every check without worrying about cost
    /// or about resetting anything.
    ///
    /// Deliberately does **not** reload/overwrite a policy this engine
    /// already holds in memory: unlike `set_wallet_policy`, calling this
    /// repeatedly for a wallet that is already resident must never reset
    /// that wallet's spend/rate-limit usage counters, or every check that
    /// happens to call this first would silently reset a budget cap back to
    /// zero on every single call — defeating the cap entirely. The tradeoff
    /// is that a policy edited on disk after this wallet was first loaded
    /// (there is no command that does that yet) will not be picked up
    /// without an explicit reload path; that is a known follow-up once a
    /// policy-mutation command exists.
    pub fn ensure_policy_loaded(&self, wallet_address: &str) {
        let key = Self::normalize(wallet_address);
        let mut policies = self.policies.lock().unwrap();
        if !policies.contains_key(&key) {
            let policy = crate::autonomy::store::load_or_default(wallet_address);
            policies.insert(key, policy);
        }
    }

    /// How many executions count toward the current rate-limit window, given
    /// stored usage and "now". Shared by the read-only check inside
    /// `evaluate_autonomous_mint` and the commit step in
    /// `check_and_authorize`, so the two can never disagree about whether a
    /// window has rolled over.
    fn count_in_window(usage: RuleUsage, now: i64, window_seconds: i64) -> u32 {
        if now - usage.rate_window_started_at >= window_seconds {
            0
        } else {
            usage.rate_window_count
        }
    }

    fn rule_expired(rule: &AutonomyRule, now: i64) -> bool {
        matches!(rule.expires_at, Some(exp) if now >= exp)
    }

    /// A rule's contract allowlist must be explicit and non-empty. Omission
    /// always means deny, never "unlimited" — see the brief's data-model
    /// requirements.
    fn contract_allowed(rule: &AutonomyRule, proposal: &ActionProposal) -> bool {
        let Some(target) = proposal.target_contract.as_deref() else {
            return false;
        };
        if rule.allowed_contracts.is_empty() {
            return false;
        }
        rule.allowed_contracts
            .iter()
            .any(|c| c.eq_ignore_ascii_case(target))
    }

    /// **The** rule-precedence chain. Pure: no I/O, no locking — reads a
    /// policy snapshot and a per-rule usage snapshot (both already resolved
    /// by the caller) and returns a decision. Both `preview_proposal` and
    /// `check_and_authorize` call this one function; see
    /// `preview_and_authorize_never_diverge` below for the guard that pins
    /// that invariant by construction.
    ///
    /// Step numbers in comments refer to the 10-step precedence chain in
    /// `docs/WALLET_AUTONOMY_POLICY_BRIEF.md` / this phase's spec.
    fn evaluate(
        policy: Option<&WalletPolicy>,
        rule_usage: &[Option<RuleUsage>],
        proposal: &ActionProposal,
        kill_switch_active: bool,
        watch_only: bool,
        now: i64,
    ) -> EvaluationOutcome {
        let deny = |reason: String| EvaluationOutcome {
            decision: AutonomyDecision::Deny { reason },
            matched_rule: None,
        };
        let requires = |reason: String| EvaluationOutcome {
            decision: AutonomyDecision::RequiresApproval { reason },
            matched_rule: None,
        };

        // 1. Global kill switch overrides everything, unconditionally.
        if kill_switch_active {
            return deny(
                "The kill switch is engaged. No autonomous action can be authorized.".into(),
            );
        }

        // 2. No policy, or a disabled policy: this wallet is not opted into
        // the autonomy machinery at all. Distinct from `Manual` mode (which
        // still resolves to `requires_approval`, not `deny` — see below).
        let Some(policy) = policy else {
            return deny("No autonomy policy is configured for this wallet.".into());
        };
        if !policy.enabled {
            return deny("This wallet's autonomy policy is disabled.".into());
        }

        // 3. Watch-only wallets never sign, regardless of mode.
        if watch_only {
            return deny("This wallet is watch-only and can never sign.".into());
        }

        // 4. Chain isolation: policy and proposal chain must both be
        // mainnet, and must match each other. No override, ever.
        if policy.chain_id != MAINNET_CHAIN_ID || proposal.chain_id != policy.chain_id {
            return deny(format!(
                "Chain {} is not authorized; this policy is scoped to chain {}.",
                proposal.chain_id, policy.chain_id
            ));
        }

        // 5 & 6. Hard v1 bans: these action types can never become
        // autonomous, full stop, regardless of any rule. Computed here but
        // only consulted at step 9 below — under `Manual`/`Assisted` (7/8)
        // the outcome is `requires_approval` regardless of action type, so
        // evaluating the ban earlier or later cannot change the result.
        let hard_banned = matches!(
            proposal.action_type,
            ActionType::TransferNative
                | ActionType::TransferErc20
                | ActionType::TransferErc721
                | ActionType::TransferErc1155
                | ActionType::MarketplaceList
                | ActionType::MarketplaceBidOrOffer
                | ActionType::MarketplaceCancel
                | ActionType::ContractCallKnown
                | ActionType::ContractCallUnknown
                | ActionType::Erc20Approve
                | ActionType::SetApprovalForAll
                | ActionType::PermitOrPermit2
                | ActionType::TypedDataSign
                | ActionType::PersonalMessageSign
                | ActionType::WalletManagement
                | ActionType::PolicyManagement
        );

        // 7 & 8. Manual and Assisted: every signable operation always
        // requires a fresh manual approval. Assisted differs from manual
        // only in UI/prep, never in authorization.
        if matches!(policy.mode, AutonomyMode::Manual | AutonomyMode::Assisted) {
            return requires(
                "This wallet is not in autonomous mode; every action requires manual approval."
                    .into(),
            );
        }

        // Mode is Autonomous from here on.

        // 9. Autonomous mode is a ceiling on what CAN auto-execute, never a
        // blanket auto-approval. Only `Mint` (and, eventually, the
        // simulate-only snipe path — untouched by this module) may ever
        // resolve to `Allow`. Everything else — including every hard-banned
        // type — still queues for manual approval; it does not become a
        // hard `Deny`.
        if hard_banned || !matches!(proposal.action_type, ActionType::Mint) {
            return requires(
                "This action type can never execute autonomously in v1; it requires manual \
                 approval."
                    .into(),
            );
        }

        // 10. Autonomous mint validation.
        Self::evaluate_autonomous_mint(policy, rule_usage, proposal, now)
    }

    fn evaluate_autonomous_mint(
        policy: &WalletPolicy,
        rule_usage: &[Option<RuleUsage>],
        proposal: &ActionProposal,
        now: i64,
    ) -> EvaluationOutcome {
        let requires = |reason: String| EvaluationOutcome {
            decision: AutonomyDecision::RequiresApproval { reason },
            matched_rule: None,
        };

        // Explicit deny rules are evaluated first and unconditionally: least
        // privilege wins, a deny rule always beats a matching allow rule,
        // regardless of where either sits in the rule list.
        for rule in policy.rules.iter() {
            if rule.effect != RuleEffect::Deny || !rule.enabled {
                continue;
            }
            if rule.action_type != proposal.action_type {
                continue;
            }
            if Self::rule_expired(rule, now) {
                continue;
            }
            if !Self::contract_allowed(rule, proposal) {
                continue;
            }
            return EvaluationOutcome {
                decision: AutonomyDecision::Deny {
                    reason: "An explicit policy rule denies this action.".into(),
                },
                matched_rule: None,
            };
        }

        // First matching allow-mint rule by action type. Contract/cap/
        // expiry/rate checks below decide whether it is actually eligible.
        let candidate = policy
            .rules
            .iter()
            .enumerate()
            .find(|(_, rule)| rule.effect == RuleEffect::Allow && rule.action_type == ActionType::Mint);

        let Some((idx, rule)) = candidate else {
            return requires(
                "No autonomous rule matches this mint proposal; it requires manual approval."
                    .into(),
            );
        };

        if !rule.enabled {
            return requires(
                "The matching rule is disabled; this mint requires manual approval.".into(),
            );
        }
        if Self::rule_expired(rule, now) {
            return requires(
                "The matching rule has expired; this mint requires manual approval.".into(),
            );
        }
        if !Self::contract_allowed(rule, proposal) {
            return requires(
                "The target contract is not on this rule's allowlist; manual approval required."
                    .into(),
            );
        }
        if proposal.value_wei > rule.per_tx_cap_wei {
            return requires(
                "This mint exceeds the rule's per-transaction cap; manual approval required."
                    .into(),
            );
        }

        let usage = rule_usage.get(idx).copied().flatten().unwrap_or_default();

        // Saturating, not checked: this is the read-only decision path, and
        // `evaluate()` never fails — it only ever produces a decision. Real
        // overflow protection lives in `check_and_authorize`'s commit step,
        // which runs `checked_add` against the actual stored counter and
        // fails closed with `AutonomyError::BudgetOverflow` instead of
        // wrapping. A saturated sum is always >= the true sum, so this check
        // can only be stricter than the real one — it can never let through
        // something the checked commit would reject.
        let new_total = usage.total_spent_wei.saturating_add(proposal.value_wei);
        if new_total > rule.total_budget_cap_wei {
            return requires(
                "This mint would exceed the rule's total budget cap; manual approval required."
                    .into(),
            );
        }

        if let (Some(max_exec), Some(window)) =
            (rule.rate_limit_max_executions, rule.rate_limit_window_seconds)
        {
            if Self::count_in_window(usage, now, window) >= max_exec {
                return requires(
                    "This mint would exceed the rule's rate limit; manual approval required."
                        .into(),
                );
            }
        }

        EvaluationOutcome {
            decision: AutonomyDecision::Allow {
                reason: "Matches an active, unexpired, correctly-scoped mint rule.".into(),
            },
            matched_rule: Some(idx),
        }
    }

    /// Snapshot of each rule's current usage, in the same order as
    /// `policy.rules`, for `evaluate()` to read. Locks `usage` internally
    /// and releases it before returning — `evaluate()` itself never locks
    /// anything.
    fn snapshot_usage(&self, wallet_key: &str, policy: Option<&WalletPolicy>) -> Vec<Option<RuleUsage>> {
        let Some(policy) = policy else {
            return Vec::new();
        };
        let usage = self.usage.lock().unwrap();
        (0..policy.rules.len())
            .map(|idx| usage.get(&(wallet_key.to_string(), idx)).copied())
            .collect()
    }

    /// **Read-only.** Runs exactly the same guard chain `check_and_authorize`
    /// runs and reports the verdict without touching any counter — mirrors
    /// `EnvelopeEngine::preview`.
    pub fn preview_proposal(
        &self,
        proposal: &ActionProposal,
        kill_switch_active: bool,
        watch_only: bool,
        now: i64,
    ) -> AutonomyDecision {
        let key = Self::normalize(&proposal.wallet_address);
        let policies = self.policies.lock().unwrap();
        let policy = policies.get(&key);
        let usage_snapshot = self.snapshot_usage(&key, policy);
        Self::evaluate(policy, &usage_snapshot, proposal, kill_switch_active, watch_only, now)
            .decision
    }

    /// **Consumes budget on `Allow` — not a pre-flight check.**
    ///
    /// Calls the exact same `evaluate()` `preview_proposal` calls. If the
    /// result is `Allow`, commits the matched rule's running total and
    /// rate-limit window using checked arithmetic; an overflow fails closed
    /// with `AutonomyError::BudgetOverflow` rather than panicking or
    /// silently saturating (unlike `envelope::engine`'s own overflow
    /// handling, which saturates and lets the cap comparison catch it — this
    /// module chooses to surface overflow explicitly instead, since it is a
    /// state a caller must never treat as "authorized").
    pub fn check_and_authorize(
        &self,
        proposal: &ActionProposal,
        kill_switch_active: bool,
        watch_only: bool,
        now: i64,
    ) -> Result<AutonomyDecision, AutonomyError> {
        // Fail closed if this wallet's hash-chained audit log does not
        // verify. The brief requires a broken chain to lock autonomous
        // execution for that wallet — `verify_chain` itself was already
        // correct and tested, but nothing on the execution path actually
        // called it, so a tampered/corrupted history never stopped a real
        // authorization. Checked first, before `evaluate()` runs at all:
        // `evaluate()` has no way to express "this wallet's history cannot
        // be trusted" in its own vocabulary (Allow/Deny/RequiresApproval
        // are all about the proposal, not about the log behind it), so this
        // has to short-circuit ahead of it rather than be folded into it.
        if let Err(e) = crate::autonomy::audit::verify_chain(&proposal.wallet_address) {
            return Ok(AutonomyDecision::Deny {
                reason: format!(
                    "This wallet's audit trail failed integrity verification and autonomous \
                     execution is locked until it is investigated: {e}"
                ),
            });
        }

        let key = Self::normalize(&proposal.wallet_address);
        let policies = self.policies.lock().unwrap();
        let policy = policies.get(&key);
        let usage_snapshot = self.snapshot_usage(&key, policy);
        let outcome =
            Self::evaluate(policy, &usage_snapshot, proposal, kill_switch_active, watch_only, now);

        if let (AutonomyDecision::Allow { .. }, Some(idx)) = (&outcome.decision, outcome.matched_rule) {
            let rule = &policy
                .expect("an Allow decision always comes from a matched policy rule")
                .rules[idx];

            let mut usage = self.usage.lock().unwrap();
            let entry = usage.entry((key.clone(), idx)).or_insert_with(RuleUsage::default);

            let new_total = entry
                .total_spent_wei
                .checked_add(proposal.value_wei)
                .ok_or(AutonomyError::BudgetOverflow)?;

            let new_window_count = if let (Some(_), Some(window)) =
                (rule.rate_limit_max_executions, rule.rate_limit_window_seconds)
            {
                let in_window = Self::count_in_window(*entry, now, window);
                if in_window == 0 {
                    entry.rate_window_started_at = now;
                }
                in_window.checked_add(1).ok_or(AutonomyError::BudgetOverflow)?
            } else {
                entry.rate_window_count
            };

            entry.total_spent_wei = new_total;
            entry.rate_window_count = new_window_count;
        }

        Ok(outcome.decision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WALLET: &str = "0x000000000000000000000000000000000000dead";
    const CONTRACT: &str = "0x00000000000000000000000000000000c0ffee";
    const OTHER_CONTRACT: &str = "0x0000000000000000000000000000000000beef";
    const ETH: u128 = 1_000_000_000_000_000_000;

    fn mint_rule(per_tx_cap: u128, total_cap: u128, expires_at: Option<i64>) -> AutonomyRule {
        AutonomyRule {
            enabled: true,
            effect: RuleEffect::Allow,
            action_type: ActionType::Mint,
            per_tx_cap_wei: per_tx_cap,
            total_budget_cap_wei: total_cap,
            expires_at,
            allowed_contracts: vec![CONTRACT.to_string()],
            rate_limit_max_executions: None,
            rate_limit_window_seconds: None,
        }
    }

    fn deny_rule(action_type: ActionType) -> AutonomyRule {
        AutonomyRule {
            enabled: true,
            effect: RuleEffect::Deny,
            action_type,
            per_tx_cap_wei: 0,
            total_budget_cap_wei: 0,
            expires_at: None,
            allowed_contracts: vec![CONTRACT.to_string()],
            rate_limit_max_executions: None,
            rate_limit_window_seconds: None,
        }
    }

    fn autonomous_policy(rules: Vec<AutonomyRule>) -> WalletPolicy {
        WalletPolicy {
            wallet_address: WALLET.to_string(),
            mode: AutonomyMode::Autonomous,
            enabled: true,
            chain_id: 1,
            rules,
        }
    }

    fn policy_with_mode(mode: AutonomyMode, rules: Vec<AutonomyRule>) -> WalletPolicy {
        WalletPolicy {
            wallet_address: WALLET.to_string(),
            mode,
            enabled: true,
            chain_id: 1,
            rules,
        }
    }

    fn mint_proposal(value: u128) -> ActionProposal {
        ActionProposal {
            action_type: ActionType::Mint,
            wallet_address: WALLET.to_string(),
            target_contract: Some(CONTRACT.to_string()),
            calldata: Some("0xa0712d68".to_string()),
            value_wei: value,
            chain_id: 1,
        }
    }

    fn proposal_of(action_type: ActionType) -> ActionProposal {
        ActionProposal {
            action_type,
            wallet_address: WALLET.to_string(),
            target_contract: Some(CONTRACT.to_string()),
            calldata: Some("0xdeadbeef".to_string()),
            value_wei: 0,
            chain_id: 1,
        }
    }

    fn engine_with(policy: WalletPolicy) -> AutonomyEngine {
        let e = AutonomyEngine::new();
        e.set_wallet_policy(policy);
        e
    }

    // ── Kill switch ─────────────────────────────────────────────────────

    #[test]
    fn kill_switch_denies_everything_regardless_of_mode_or_rules() {
        let now = 1_000_000_i64;
        let cases = vec![
            policy_with_mode(AutonomyMode::Manual, vec![]),
            policy_with_mode(AutonomyMode::Assisted, vec![]),
            autonomous_policy(vec![mint_rule(10 * ETH, 10 * ETH, Some(now + 3600))]),
        ];
        for policy in cases {
            let e = engine_with(policy);
            let decision = e.preview_proposal(&mint_proposal(ETH), true, false, now);
            assert!(
                matches!(decision, AutonomyDecision::Deny { .. }),
                "kill switch must deny, got {decision:?}"
            );
            let authorized = e.check_and_authorize(&mint_proposal(ETH), true, false, now).unwrap();
            assert!(matches!(authorized, AutonomyDecision::Deny { .. }));
        }
    }

    // ── No policy / disabled / watch-only ──────────────────────────────

    #[test]
    fn no_policy_denies() {
        let e = AutonomyEngine::new();
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }));
    }

    #[test]
    fn disabled_policy_denies() {
        let mut policy = autonomous_policy(vec![mint_rule(10 * ETH, 10 * ETH, Some(3600))]);
        policy.enabled = false;
        let e = engine_with(policy);
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }));
    }

    #[test]
    fn watch_only_wallet_denies() {
        let policy = autonomous_policy(vec![mint_rule(10 * ETH, 10 * ETH, Some(3600))]);
        let e = engine_with(policy);
        let decision = e.preview_proposal(&mint_proposal(ETH), false, true, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }));
    }

    // ── Chain isolation ─────────────────────────────────────────────────

    #[test]
    fn non_mainnet_chain_id_always_denied_even_with_valid_autonomous_rule() {
        let mut policy = autonomous_policy(vec![mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000))]);
        policy.chain_id = 5; // some non-mainnet chain
        let e = engine_with(policy);
        let mut proposal = mint_proposal(ETH);
        proposal.chain_id = 5;
        let decision = e.preview_proposal(&proposal, false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }));
    }

    #[test]
    fn proposal_chain_mismatch_with_mainnet_policy_denies() {
        let policy = autonomous_policy(vec![mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000))]);
        let e = engine_with(policy);
        let mut proposal = mint_proposal(ETH);
        proposal.chain_id = 137; // policy is chain 1, proposal claims another chain
        let decision = e.preview_proposal(&proposal, false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }));
    }

    // ── Manual / Assisted always require approval ──────────────────────

    #[test]
    fn manual_mode_always_requires_approval_never_allow_never_deny() {
        let rules = vec![mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000))];
        let e = engine_with(policy_with_mode(AutonomyMode::Manual, rules));
        // Even a "perfect" mint match — manual mode still just queues it.
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));

        for action_type in all_action_types() {
            let decision = e.preview_proposal(&proposal_of(action_type), false, false, 0);
            assert!(
                matches!(decision, AutonomyDecision::RequiresApproval { .. }),
                "manual mode + {action_type:?} must require approval, got {decision:?}"
            );
        }
    }

    #[test]
    fn assisted_mode_always_requires_approval_same_as_manual() {
        let rules = vec![mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000))];
        let e = engine_with(policy_with_mode(AutonomyMode::Assisted, rules));
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));

        for action_type in all_action_types() {
            let decision = e.preview_proposal(&proposal_of(action_type), false, false, 0);
            assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));
        }
    }

    fn all_action_types() -> Vec<ActionType> {
        vec![
            ActionType::ReadOnly,
            ActionType::Mint,
            ActionType::TransferNative,
            ActionType::TransferErc20,
            ActionType::TransferErc721,
            ActionType::TransferErc1155,
            ActionType::MarketplaceList,
            ActionType::MarketplaceBidOrOffer,
            ActionType::MarketplaceCancel,
            ActionType::ContractCallKnown,
            ActionType::ContractCallUnknown,
            ActionType::Erc20Approve,
            ActionType::SetApprovalForAll,
            ActionType::PermitOrPermit2,
            ActionType::TypedDataSign,
            ActionType::PersonalMessageSign,
            ActionType::WalletManagement,
            ActionType::PolicyManagement,
        ]
    }

    // ── Autonomous mode: hard v1 bans ──────────────────────────────────
    //
    // "Unconstrained send / arbitrary contract call / raw calldata /
    // arbitrary EIP-712 / personal_sign". This v1 taxonomy doesn't split
    // "arbitrary contract call" from "raw calldata" into separate action
    // types, so `ContractCallUnknown` stands in for both.

    fn assert_never_allowed_in_autonomous(action_type: ActionType) {
        // A deliberately permissive-looking policy: an allow rule for this
        // exact action type, wide open, matching contract, far future
        // expiry. If the hard ban were bypassable, this rule would trigger
        // it.
        let mut permissive_rule = mint_rule(1_000_000 * ETH, 1_000_000 * ETH, Some(1_000_000_000));
        permissive_rule.action_type = action_type;
        let e = engine_with(autonomous_policy(vec![permissive_rule]));

        let decision = e.preview_proposal(&proposal_of(action_type), false, false, 0);
        assert!(
            matches!(decision, AutonomyDecision::RequiresApproval { .. }),
            "autonomous mode must never Allow {action_type:?}, got {decision:?}"
        );
        let authorized = e
            .check_and_authorize(&proposal_of(action_type), false, false, 0)
            .unwrap();
        assert!(matches!(authorized, AutonomyDecision::RequiresApproval { .. }));
    }

    #[test]
    fn autonomous_mode_never_allows_unconstrained_native_send() {
        assert_never_allowed_in_autonomous(ActionType::TransferNative);
    }

    #[test]
    fn autonomous_mode_never_allows_arbitrary_contract_call_or_raw_calldata() {
        assert_never_allowed_in_autonomous(ActionType::ContractCallUnknown);
    }

    #[test]
    fn autonomous_mode_never_allows_arbitrary_typed_data_signing() {
        assert_never_allowed_in_autonomous(ActionType::TypedDataSign);
    }

    #[test]
    fn autonomous_mode_never_allows_personal_message_signing() {
        assert_never_allowed_in_autonomous(ActionType::PersonalMessageSign);
    }

    // ── Autonomous mode: hard v1 bans on unlimited approvals ───────────

    #[test]
    fn autonomous_mode_never_allows_erc20_approve() {
        assert_never_allowed_in_autonomous(ActionType::Erc20Approve);
    }

    #[test]
    fn autonomous_mode_never_allows_set_approval_for_all() {
        assert_never_allowed_in_autonomous(ActionType::SetApprovalForAll);
    }

    #[test]
    fn autonomous_mode_never_allows_permit_or_permit2() {
        assert_never_allowed_in_autonomous(ActionType::PermitOrPermit2);
    }

    #[test]
    fn autonomous_mode_never_allows_wallet_management_delegation_ownership_or_module_changes() {
        assert_never_allowed_in_autonomous(ActionType::WalletManagement);
    }

    #[test]
    fn autonomous_mode_never_allows_policy_management() {
        assert_never_allowed_in_autonomous(ActionType::PolicyManagement);
    }

    // ── Autonomous mode: valid mint ─────────────────────────────────────

    #[test]
    fn autonomous_mode_allows_a_valid_mint_matching_an_active_rule_with_budget_headroom() {
        let e = engine_with(autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, Some(1_000_000_000))]));
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Allow { .. }), "got {decision:?}");

        let authorized = e.check_and_authorize(&mint_proposal(ETH), false, false, 0).unwrap();
        assert!(matches!(authorized, AutonomyDecision::Allow { .. }));
    }

    // ── Autonomous mode: mint denied/queued variants ────────────────────

    #[test]
    fn expired_mint_rule_requires_approval_not_allow() {
        let e = engine_with(autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, Some(100))]));
        // now (200) is past the rule's expiry (100).
        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 200);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));
    }

    #[test]
    fn wrong_contract_requires_approval_not_allow() {
        let e = engine_with(autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, Some(1_000_000_000))]));
        let mut proposal = mint_proposal(ETH);
        proposal.target_contract = Some(OTHER_CONTRACT.to_string());
        let decision = e.preview_proposal(&proposal, false, false, 0);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));
    }

    #[test]
    fn over_per_tx_cap_requires_approval_not_allow() {
        let e = engine_with(autonomous_policy(vec![mint_rule(ETH, 10 * ETH, Some(1_000_000_000))]));
        let decision = e.preview_proposal(&mint_proposal(2 * ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));
    }

    #[test]
    fn over_total_budget_cap_requires_approval_not_allow() {
        let e = engine_with(autonomous_policy(vec![mint_rule(10 * ETH, ETH, Some(1_000_000_000))]));
        let decision = e.preview_proposal(&mint_proposal(2 * ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::RequiresApproval { .. }));
    }

    #[test]
    fn rate_limit_exceeded_requires_approval_not_allow() {
        let mut rule = mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000));
        rule.rate_limit_max_executions = Some(1);
        rule.rate_limit_window_seconds = Some(3600);
        let e = engine_with(autonomous_policy(vec![rule]));

        let first = e.check_and_authorize(&mint_proposal(ETH), false, false, 0).unwrap();
        assert!(matches!(first, AutonomyDecision::Allow { .. }));

        // Same window (now=0 again, well within the 3600s window).
        let second = e.check_and_authorize(&mint_proposal(ETH), false, false, 0).unwrap();
        assert!(matches!(second, AutonomyDecision::RequiresApproval { .. }));
    }

    // ── Deny beats allow ────────────────────────────────────────────────

    #[test]
    fn explicit_deny_rule_beats_a_matching_allow_rule() {
        // Allow rule first, deny rule second — order must not matter.
        let allow = mint_rule(10 * ETH, 10 * ETH, Some(1_000_000_000));
        let deny = deny_rule(ActionType::Mint);
        let e = engine_with(autonomous_policy(vec![allow, deny]));

        let decision = e.preview_proposal(&mint_proposal(ETH), false, false, 0);
        assert!(matches!(decision, AutonomyDecision::Deny { .. }), "got {decision:?}");
    }

    // ── Preview / authorize divergence guard ───────────────────────────
    //
    // Mirrors envelope::engine's own `preview_agrees_with_check_and_authorize_on_every_guard`
    // test: preview and the real authorization must agree on every case
    // because both call the exact same `evaluate()`.

    #[test]
    fn preview_and_authorize_never_diverge() {
        let far_future = Some(1_000_000_000_i64);
        let expired = Some(100_i64);

        struct Case {
            label: &'static str,
            policy: WalletPolicy,
            proposal: ActionProposal,
            kill_switch: bool,
            watch_only: bool,
            now: i64,
        }

        let cases = vec![
            Case {
                label: "allowed mint",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "kill switch",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: mint_proposal(ETH),
                kill_switch: true,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "watch only",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: true,
                now: 0,
            },
            Case {
                label: "manual mode",
                policy: policy_with_mode(AutonomyMode::Manual, vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "assisted mode",
                policy: policy_with_mode(AutonomyMode::Assisted, vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "hard banned type in autonomous mode",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: proposal_of(ActionType::Erc20Approve),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "expired rule",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, expired)]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 200,
            },
            Case {
                label: "wrong contract",
                policy: autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]),
                proposal: {
                    let mut p = mint_proposal(ETH);
                    p.target_contract = Some(OTHER_CONTRACT.to_string());
                    p
                },
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "over per-tx cap",
                policy: autonomous_policy(vec![mint_rule(ETH, 10 * ETH, far_future)]),
                proposal: mint_proposal(2 * ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "explicit deny beats allow",
                policy: autonomous_policy(vec![
                    mint_rule(10 * ETH, 10 * ETH, far_future),
                    deny_rule(ActionType::Mint),
                ]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "no policy",
                policy: policy_with_mode(AutonomyMode::Autonomous, vec![]),
                proposal: mint_proposal(ETH),
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
            Case {
                label: "non-mainnet chain",
                policy: {
                    let mut p = autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, far_future)]);
                    p.chain_id = 5;
                    p
                },
                proposal: {
                    let mut p = mint_proposal(ETH);
                    p.chain_id = 5;
                    p
                },
                kill_switch: false,
                watch_only: false,
                now: 0,
            },
        ];

        for case in cases {
            let previewer = engine_with(case.policy.clone());
            let authorizer = engine_with(case.policy);

            let preview_decision = previewer.preview_proposal(
                &case.proposal,
                case.kill_switch,
                case.watch_only,
                case.now,
            );
            let authorize_decision = authorizer
                .check_and_authorize(&case.proposal, case.kill_switch, case.watch_only, case.now)
                .unwrap_or_else(|e| panic!("[{}] check_and_authorize errored: {e:?}", case.label));

            assert_eq!(
                std::mem::discriminant(&preview_decision),
                std::mem::discriminant(&authorize_decision),
                "[{}] preview and authorize disagree: preview={:?} authorize={:?}",
                case.label,
                preview_decision,
                authorize_decision
            );
        }
    }

    // ── Overflow: checked arithmetic, no panic ─────────────────────────

    #[test]
    fn budget_overflow_fails_closed_without_panicking() {
        let rule = mint_rule(u128::MAX, u128::MAX, Some(1_000_000_000));
        let e = engine_with(autonomous_policy(vec![rule]));

        // First call pushes the rule's running total to u128::MAX - 1.
        let first = e
            .check_and_authorize(&mint_proposal(u128::MAX - 1), false, false, 0)
            .unwrap();
        assert!(matches!(first, AutonomyDecision::Allow { .. }));

        // A second mint of 2 wei would overflow total_spent_wei's checked_add.
        // Must not panic; must surface as an explicit error, never silently
        // succeed.
        let second = e.check_and_authorize(&mint_proposal(2), false, false, 0);
        assert_eq!(second, Err(AutonomyError::BudgetOverflow));
    }

    // ── Audit chain integrity gates execution (fail closed) ────────────
    //
    // `autonomy::audit::verify_chain` always ran against the real app-data
    // location — it is not directory-injectable (there is exactly one
    // "real" audit trail per wallet in production, and `check_and_authorize`
    // must check that one). This test therefore writes to and cleans up a
    // real file on disk for a wallet address that belongs to no other test
    // and no real wallet, so it cannot race or collide with anything else.

    const TAMPER_WALLET: &str = "0x00000000000000000000000000000000beefcafe0";

    #[test]
    fn tampered_audit_chain_denies_check_and_authorize_instead_of_proceeding() {
        let dir = crate::autonomy::audit::default_dir()
            .expect("real audit dir must resolve in the test environment");
        let path = crate::autonomy::audit::log_path(&dir, TAMPER_WALLET);
        std::fs::remove_file(&path).ok(); // in case a previous run left one behind

        let mut policy = autonomous_policy(vec![mint_rule(2 * ETH, 5 * ETH, Some(1_000_000_000))]);
        policy.wallet_address = TAMPER_WALLET.to_string();
        let e = engine_with(policy);

        let mut proposal = mint_proposal(ETH);
        proposal.wallet_address = TAMPER_WALLET.to_string();

        // Baseline: with no audit log yet (a trivially valid empty chain),
        // this proposal authorizes normally. Establishes that any Deny seen
        // after tampering below is caused by the corruption, not by some
        // other guard already blocking this wallet.
        let baseline = e.check_and_authorize(&proposal, false, false, 0).unwrap();
        assert!(
            matches!(baseline, AutonomyDecision::Allow { .. }),
            "sanity baseline before corruption should Allow, got {baseline:?}"
        );

        // Append one real, valid record, then corrupt it on disk — same
        // technique `autonomy::audit`'s own tamper-detection tests use.
        crate::autonomy::audit::append(
            TAMPER_WALLET,
            crate::autonomy::audit::AuditRecordKind::Decision {
                outcome: AutonomyDecision::Allow { reason: "test".into() },
                matched_rule_index: Some(0),
            },
            1000,
        )
        .unwrap();

        let contents = std::fs::read_to_string(&path).unwrap();
        let mut tampered: serde_json::Value = serde_json::from_str(contents.trim()).unwrap();
        // Change a field that feeds the content hash without touching the
        // stored `hash` itself — exactly what an attacker editing history
        // in place would do.
        tampered["timestamp"] = serde_json::json!(9999);
        std::fs::write(&path, format!("{tampered}\n")).unwrap();

        let after_tamper = e.check_and_authorize(&proposal, false, false, 1).unwrap();
        assert!(
            matches!(after_tamper, AutonomyDecision::Deny { .. }),
            "a tampered audit chain must deny, not proceed, got {after_tamper:?}"
        );
        if let AutonomyDecision::Deny { reason } = after_tamper {
            assert!(
                reason.contains("audit trail failed integrity verification"),
                "deny reason should name the audit-chain failure, got: {reason}"
            );
        }

        std::fs::remove_file(&path).ok();
    }
}
