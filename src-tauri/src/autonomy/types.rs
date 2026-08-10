use serde::{Deserialize, Serialize};

use crate::envelope::types::u128_as_string;

/// How much autonomy a wallet's policy grants. `Autonomous` is a ceiling on
/// what CAN auto-execute, never a blanket auto-approval — see `engine.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutonomyMode {
    Manual,
    Assisted,
    Autonomous,
}

/// v1 action taxonomy. Kept as a closed enum, not free text, so the hard v1
/// bans (see `docs/WALLET_AUTONOMY_POLICY_BRIEF.md`) are enforced by
/// exhaustive matching in `engine.rs` rather than by string comparison.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    ReadOnly,
    Mint,
    TransferNative,
    TransferErc20,
    TransferErc721,
    TransferErc1155,
    MarketplaceList,
    MarketplaceBidOrOffer,
    MarketplaceCancel,
    ContractCallKnown,
    ContractCallUnknown,
    Erc20Approve,
    SetApprovalForAll,
    PermitOrPermit2,
    TypedDataSign,
    PersonalMessageSign,
    WalletManagement,
    PolicyManagement,
}

/// Whether a matching rule allows or blocks an action. An explicit `Deny`
/// always outranks a matching `Allow` — enforced in `engine.rs`, not here.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RuleEffect {
    Allow,
    Deny,
}

/// One constraint inside a `WalletPolicy`. All monetary fields are wei
/// integers, never floats — see `u128_as_string`, reused from
/// `envelope::types` rather than re-defined here.
///
/// Fields beyond the ones a Phase (a) caller strictly needs to pass in
/// (`enabled`, `effect`) exist because the rule-precedence chain in
/// `engine.rs` cannot be expressed without them: a rule cannot be "matched
/// and skipped because it's off" or "an explicit deny" without them. See the
/// design-decision notes in this phase's handoff.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutonomyRule {
    pub enabled: bool,
    pub effect: RuleEffect,
    pub action_type: ActionType,
    /// Largest single action this rule authorizes, in wei.
    #[serde(with = "u128_as_string")]
    pub per_tx_cap_wei: u128,
    /// Running total this rule authorizes across its lifetime, in wei.
    #[serde(with = "u128_as_string")]
    pub total_budget_cap_wei: u128,
    /// Unix seconds UTC. `None` means the rule never expires by itself —
    /// still bounded by the owning `WalletPolicy`'s own state.
    pub expires_at: Option<i64>,
    /// Normalized contract addresses this rule's `Mint` actions may target.
    /// Empty for action types that are not contract-scoped.
    pub allowed_contracts: Vec<String>,
    /// `None` means no rate limit is configured for this rule.
    pub rate_limit_max_executions: Option<u32>,
    pub rate_limit_window_seconds: Option<i64>,
}

/// A wallet's autonomy configuration. Chain scope is Ethereum mainnet (`1`)
/// only in v1 — `engine.rs` rejects any other `chain_id` unconditionally,
/// this struct does not validate it (mirrors `envelope::types::Envelope`,
/// which is pure data with no embedded validation logic).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletPolicy {
    /// Normalized (lowercase) wallet address this policy belongs to.
    pub wallet_address: String,
    pub mode: AutonomyMode,
    pub enabled: bool,
    pub chain_id: u64,
    pub rules: Vec<AutonomyRule>,
}

/// A request to perform an action, as submitted to the policy engine.
/// Mirrors `envelope::types::TransactionRequest`'s shape where it overlaps,
/// but carries the action classification the envelope module doesn't need.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionProposal {
    pub action_type: ActionType,
    pub wallet_address: String,
    /// `None` for actions with no on-chain destination (e.g. a message sign).
    pub target_contract: Option<String>,
    /// Hex-encoded calldata, when applicable.
    pub calldata: Option<String>,
    #[serde(with = "u128_as_string")]
    pub value_wei: u128,
    pub chain_id: u64,
}

/// The engine's verdict for one `ActionProposal`. `Allow` is deliberately as
/// narrow a variant as `Deny`/`RequiresApproval` — every branch carries a
/// human-readable `reason` so a caller never has to re-derive why a decision
/// came out the way it did (same rationale as `envelope::engine::describe`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum AutonomyDecision {
    Allow { reason: String },
    Deny { reason: String },
    RequiresApproval { reason: String },
}

/// Structured failure modes distinct from a normal `AutonomyDecision`.
///
/// `evaluate()` never returns this: every guard failure it finds resolves to
/// a `Deny`/`RequiresApproval` decision instead — mirrors
/// `envelope::engine`'s own pure guard function, which never panics and
/// always hands the caller a value it can act on, not an exception path.
///
/// `check_and_authorize` is the only place this type is actually
/// constructed in Phase (a), and only as `BudgetOverflow`: the one thing
/// `preview_proposal` never does is commit budget/rate-limit counters, so
/// committing is the only step that can fail this way.
///
/// The other variants are not constructed anywhere in this module today.
/// They exist as a stable, typed vocabulary for later callers (Tauri
/// commands, the audit log) to report the same categories `AutonomyDecision`
/// already covers in human-readable form — exactly the role
/// `envelope::types::EnvelopeError::KeychainError`/`SigningError` play today:
/// defined for callers outside `evaluate()`, never produced by it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AutonomyError {
    /// Committing a rule's running budget/rate-limit counters after an
    /// `Allow` decision would overflow. Fails closed: no counter is
    /// partially updated.
    BudgetOverflow,
    NoPolicy,
    KillSwitchActive,
    ChainMismatch { expected: u64, requested: u64 },
    HardBannedActionType { action_type: ActionType },
}
