# Claude Code implementation brief: Wallet-based autonomy policies

## Mission

Implement a **wallet-level autonomy policy system** for Westron. Users must be
able to decide, independently for every wallet, which actions the application
may execute automatically and which actions always require an explicit manual
approval.

Primary example:

- A **mint wallet** may autonomously mint only from explicitly approved
  contracts, within strict ETH/gas/time/rate limits.
- A **vault wallet** may be used for monitoring and transaction preparation,
  but **every signable operation must require manual approval**.

This is a safety-critical feature. The correct default is deny-by-default. Do
not silently broaden an existing permission, reuse an approval for a different
payload, or make security/usability trade-offs without documenting them.

---

## Product outcome

Ship a wallet policy experience that makes the following statements true:

1. A user can mark each managed wallet as `manual`, `assisted`, or
   `autonomous`.
2. A wallet in `manual` mode can never sign or broadcast a state-changing
   operation without a fresh user confirmation.
3. A wallet in `assisted` mode may monitor, discover opportunities, prepare
   decoded transactions, and simulate them, but it still waits for one
   transaction-specific approval before signing.
4. A wallet in `autonomous` mode can execute **only** actions that match an
   active, unexpired, explicit policy rule and pass all global guardrails.
5. Autonomy is scoped per wallet; granting autonomy to a mint wallet never
   affects a vault, trading, or watch-only wallet.
6. The global kill switch overrides every wallet policy immediately.
7. Every proposal, decision, confirmation, denial, broadcast, replacement,
   finalization, and policy change is recorded in an auditable local log.

Do not enable autonomous sending as a side effect of adding a wallet, importing
a private key, creating a rule, or updating the app.

---

## Repository context and constraints

This repository is a macOS Tauri application with a Next.js frontend and a Rust
backend. Before changing code:

1. Read `AGENTS.md` and the relevant installed Next.js documentation under
   `node_modules/next/dist/docs/` before editing frontend code.
2. Inspect the existing envelope engine, signing flow, nonce manager, control
   API, keychain layer, sniping rules, and Tauri command boundary.
3. Preserve the existing security model: private keys stay on device and are
   never sent to a server.
4. Preserve Ethereum-mainnet-only scope unless a change is explicitly required.
5. Do not change the subscription Worker or API-key architecture as part of
   this feature unless strictly necessary for a tested local implementation.

Likely integration points include:

- `src-tauri/src/envelope/` — spend caps, whitelist, expiry, kill switch, audit
- `src-tauri/src/signing/` — signing, send path, gas estimate, nonce handling
- `src-tauri/src/wallet/` — wallet identity/key access
- `src-tauri/src/control/` — loopback control API and scheduler
- `src-tauri/src/sniping/` — automated opportunity source
- `src-tauri/src/lib.rs` — Tauri command registration
- `src/lib/tauri.ts` — typed frontend bridge
- `src/app/settings/` and wallet-detail UI — policy configuration and history

Use existing persistence and error conventions where appropriate. Do not store
private keys, seed phrases, provider keys, raw session tokens, or full signed
payloads in UI logs.

---

## Non-negotiable safety invariants

Implement these as code-level invariants, not UI-only checks.

1. **Default deny.** If no exact active rule authorizes an action, deny it.
2. **Global override.** An engaged kill switch blocks all autonomous execution.
   It must be checked at proposal creation and immediately before signing.
3. **Wallet isolation.** A policy belongs to exactly one normalized wallet
   address. It cannot authorize another wallet.
4. **Chain isolation.** A policy applies only to the configured chain id. For
   the current product that is Ethereum mainnet (`1`). Reject any mismatch.
5. **No generic autonomous signing.** An autonomous policy cannot permit an
   unconstrained `eth_sendTransaction`, arbitrary contract call, raw calldata,
   arbitrary EIP-712 typed-data signature, or `personal_sign` request.
6. **No unlimited approvals.** ERC-20 `approve`, ERC-721/1155
   `setApprovalForAll`, Permit/Permit2, delegation, ownership transfer, proxy
   upgrade, safe/module management, and account-abstraction authorization are
   manual-only in v1.
7. **No policy self-escalation.** Creating, relaxing, enabling, importing,
   cloning, or deleting a policy always requires a fresh manual confirmation
   from the relevant wallet owner. An autonomous action can never alter policy
   data, caps, allowlists, or kill-switch state.
8. **Immutable approval binding.** A manual confirmation applies to one exact
   action digest: chain id, wallet, operation type, destination, calldata hash,
   value, fee ceiling, nonce (if known), policy version, and expiry. Any change
   invalidates it.
9. **Limits are reserved before broadcast.** Caps, quotas, and nonce allocation
   must be committed atomically before signing/broadcasting so concurrent jobs
   cannot overspend.
10. **Fail closed.** Provider error, stale state, simulation failure, unknown
    ABI/function selector, parse failure, clock uncertainty, database failure,
    or reboot recovery ambiguity must block autonomous execution and surface a
    reason to the user.
11. **Least privilege wins.** If multiple policies/rules match, apply the most
    restrictive result; a deny rule wins over an allow rule.
12. **Watch-only wallets never sign.** They may use `manual`/`assisted` UI
    semantics for planning, but no execution path may obtain a signer for them.
13. **A confirmation is a capability, never a caller-provided boolean.** Rust
    issues a one-time, short-lived manual-confirmation challenge bound to the
    wallet, canonical policy diff or canonical unsigned transaction, previous
    policy version, and expiry. Rust consumes it atomically after local
    user-authentication succeeds. UI, local HTTP, and MCP callers cannot forge,
    replay, or extend it.
14. **Only the authorized executor can sign.** Make raw private-key access and
    raw transaction broadcast private to a single Rust executor. It accepts an
    opaque, unforgeable final-authorization object produced by the policy
    engine; no Tauri/control/scheduler path may call a raw signer directly.

---

## Terminology and policy precedence

Use the following terms consistently in code, UI, and API responses.

### Modes

| Mode | Allowed behavior |
| --- | --- |
| `manual` | Read, monitor, simulate, and prepare. Every signable operation requires a fresh manual approval. This is the default. |
| `assisted` | Same as manual, plus rule/opportunity automation and queued proposals. The user approves each exact transaction. |
| `autonomous` | The app may sign and broadcast only an operation that exactly matches an active allow rule and all safety checks. |
| `watch_only` | A wallet capability, not an autonomy level. No signing regardless of the displayed mode. |

### Decision precedence

For every proposed action, evaluate in this exact order:

1. Wallet exists, is normalized, is a signing-capable wallet, and has the
   configured chain id.
2. Global kill switch is off.
3. Wallet is not locally locked, quarantined, deleted, or in recovery state.
4. Policy exists, is enabled, is not expired, and belongs to this wallet.
5. Policy mode is evaluated.
6. Explicit deny rules are evaluated; any match denies.
7. Action type is classified and decoded. Unknown/ambiguous action denies.
8. Allowlist, recipient, asset, selector, value, gas, rate, schedule, and
   budget constraints are evaluated.
9. Fresh chain state, simulation, price/slippage checks (when relevant), and
   nonce reservation pass.
10. The system returns exactly one result: `deny`, `requires_manual_approval`,
    or `allow_autonomous_execution`.

Never let a caller choose the result directly. The Rust policy engine is the
sole authority; frontend and control/MCP clients may only request a proposal.

### Policy mutation confirmation protocol

Policy creation, enabling, relaxing, import, clone, deletion, and mode changes
are security-sensitive mutations. Implement this protocol instead of accepting
`manual_confirmation: true` from any caller:

1. Rust canonicalizes the requested policy draft and calculates a
   `policy_change_digest` over wallet, chain id, full new policy, full prior
   policy/version, operation type, and short expiry.
2. Rust creates a single-use challenge bound to that digest and asks the local
   UI to perform local re-authentication/OS authentication where available.
3. The UI returns only the challenge response; it never supplies a trusted
   policy digest or “approved” flag.
4. Rust verifies the response, checks the prior version has not changed,
   persists the exact canonical draft, increments its version, consumes the
   challenge atomically, and appends the audit record.
5. Any replay, timeout, wallet mismatch, canonical-draft mismatch, or
   prior-version mismatch denies the change.

Do not expose policy mutation through MCP in v1. A control API request may at
most ask the local UI to open the change-review screen.

---

## v1 action taxonomy

Create a strongly typed `ActionType`/`OperationKind` instead of relying on free
text. At minimum distinguish:

```text
read_only
mint
transfer_native
transfer_erc20
transfer_erc721
transfer_erc1155
marketplace_list
marketplace_bid_or_offer
marketplace_cancel
contract_call_known
contract_call_unknown
erc20_approve
set_approval_for_all
permit_or_permit2
typed_data_sign
personal_message_sign
wallet_management
policy_management
```

### Autonomous allowlist for v1

Only these operations may become autonomous after full validation:

1. **Mint** from an allowlisted contract and exact allowlisted function selector
   with a bounded ETH value, recipient equal to the policy wallet, bounded
   quantity, gas cap, allowlisted call parameters, and active time/rate budget.
2. **Simulated sniping action** only if the product remains in its current
   simulation-only state. It may produce a proposal/audit event but must not
   create a real purchase as part of this feature.
3. Future autonomous operations must be separately designed, decoded, and
   added to the taxonomy. Do not make `contract_call_known` broadly autonomous
   merely because an ABI is available.

### Manual-only in v1

The following require a manual approval even for an autonomous wallet:

- native/ERC-20/ERC-721/ERC-1155 transfers
- marketplace listing, bid/offer, and cancellation
- all ERC-20 approvals, including zero-value/revoke approvals
- all NFT operator approvals
- permits, Permit2, delegation, and typed-data signatures
- message signatures
- contract deployment, upgrade, ownership/admin roles, Safe/module changes,
  ERC-4337/session-key configuration, bridging, swapping, staking, lending,
  wrapping, and unknown contract calls
- policy lifecycle changes and all key/wallet changes

This is intentionally conservative. Build extensibility for future operation
types, but do not broaden v1 scope.

---

## Data model

Persist a versioned policy per wallet. A suggested Rust-domain shape follows;
adapt names to project conventions but preserve its semantics.

```rust
enum AutonomyMode { Manual, Assisted, Autonomous }

struct WalletPolicy {
    id: String,
    wallet_address: String,          // normalized checksum/lowercase convention
    chain_id: u64,                   // must be 1 in v1
    mode: AutonomyMode,
    enabled: bool,
    version: u64,                    // increment on every change
    created_at: i64,
    updated_at: i64,
    expires_at: Option<i64>,         // policy-level expiry; required for autonomous mode
    daily_payable_value_cap_wei: Option<String>,
    lifetime_payable_value_cap_wei: Option<String>,
    daily_total_cost_cap_wei: Option<String>,
    lifetime_total_cost_cap_wei: Option<String>,
    max_pending_actions: u32,
    max_actions_per_hour: u32,
    require_simulation: bool,
    require_healthy_rpc: bool,
    rules: Vec<AutonomyRule>,
}

struct AutonomyRule {
    id: String,
    enabled: bool,
    effect: RuleEffect,              // Allow or Deny
    action_type: ActionType,
    contract_address: Option<String>,
    function_selector: Option<[u8; 4]>,
    recipient_constraint: RecipientConstraint,
    asset_constraints: AssetConstraints,
    value_cap_wei: Option<String>,
    gas_limit_cap: Option<u64>,
    max_fee_per_gas_cap_wei: Option<String>,
    max_priority_fee_per_gas_cap_wei: Option<String>,
    max_total_fee_wei: Option<String>,
    quantity_cap: Option<u64>,
    allowed_parameter_hashes: Vec<String>,
    not_before: Option<i64>,
    expires_at: Option<i64>,
    max_executions: Option<u32>,
    max_value_wei: Option<String>,
    executions_used: u32,
    payable_value_reserved_wei: String,
    payable_value_finalized_wei: String,
    total_cost_reserved_wei: String,
    total_cost_finalized_wei: String,
}

struct ActionProposal {
    id: String,
    wallet_address: String,
    policy_id: Option<String>,
    policy_version: Option<u64>,
    action_digest: String,
    action_type: ActionType,
    decision: Decision,
    explanation: Vec<String>,
    created_at: i64,
    approval_expires_at: Option<i64>,
    status: ProposalStatus,
}
```

### Data-model requirements

- Use integer wei strings or integer numeric types for all monetary values;
  never use floating point for authorization or accounting.
- Normalize/validate all addresses before storage and comparison.
- Store policy and rule expiry in Unix seconds UTC; reject invalid clock ranges.
- Require a finite `expires_at` for an autonomous policy. Default to 24 hours
  and enforce a maximum of exactly 7 days (`604_800` seconds) in Rust. Any
  longer duration must be rejected, not silently clamped.
- `max_executions`, value caps, rate caps, and pending-action limits must be
  positive, finite, and enforced atomically.
- Autonomous-policy activation must fail unless every active mint rule has all
  mandatory constraints: exact destination contract, destination code hash,
  function selector, canonical ABI schema hash, recipient=self, full canonical
  argument hash/constraint, value cap, daily/lifetime total-cost caps, quantity
  cap, gas-limit/max-fee/max-priority/total-fee caps, time window, expiry,
  rate/max-execution caps, required simulation, and required RPC health.
  Omission always means deny; it can never mean unlimited.
- A rule's parameter authorization is the domain-separated hash of the exact
  canonical ABI function signature/schema and fully ABI-encoded argument list.
  A selector alone is insufficient. Dynamic arguments, proofs, arrays, or
  bytes are autonomous only when the implementation verifies their exact
  canonical representation against an approved hash; otherwise they are
  manual-only.
- Define separate caps for `payable value` and `total cost`. `total cost` is
  payable value plus gas. Daily/lifetime/rule/envelope authorization uses total
  cost; actual gas is charged even if the transaction reverts. Reserve the
  maximum total cost, settle actual value/gas after finality, and retain the
  reservation until reconciliation completes.
- Preserve policy versions and audit history; do not overwrite historical
  records in place.
- A cloned policy must be disabled by default and require manual confirmation
  before activation.
- Deleting/revoking a policy must cancel queued autonomous actions immediately.

---

## Policy templates and UI requirements

Implement templates only as safe starting points. The user must review and
manually activate them.

### Vault template

```text
Mode: manual
Rules: none
Automatic execution: impossible
Monitoring, alerting, and simulation: allowed
```

### Mint wallet template

```text
Mode: autonomous (but initially disabled)
Only action: mint
Only approved contract(s) and selector(s)
Recipient: policy wallet only
Maximum value per mint: required
Maximum total/daily value: required
Maximum quantity: required
Maximum gas and fee: required
Time window and expiry: required
Simulation: required
Rate limit and maximum executions: required
```

### Trading wallet template

For v1, start in `assisted` mode. It may discover listings/offers and prepare
orders, but marketplace signing remains manual-only. Do not label it
“autonomous trading” until that separate design exists.

### Required UI states

1. Wallet detail shows mode, policy enabled/disabled state, expiry, last
   decision, daily/lifetime cap usage, and a prominent kill-switch status.
2. Mode changes use a warning dialog explaining what becomes possible; changing
   to `autonomous` requires an additional typed/re-auth confirmation.
3. The policy editor presents a human-readable sentence and a technical
   decoded summary. Example: “This wallet may mint from Contract X through
   `publicMint(uint256)` up to 0.05 ETH, once per hour, until 18:00 UTC.”
4. A “test policy”/dry-run screen accepts a proposed transaction and returns
   the exact policy decision and each matched/failed constraint without signing.
5. Manual-approval screen shows wallet, chain, action type, contract/recipient,
   decoded method and parameters, ETH value, token/NFT effect when known, max
   gas fee, simulation result, warnings, policy match, and expiry.
6. Manual approval expires quickly (recommend 60 seconds) and becomes invalid
   on any payload, gas-ceiling, policy-version, chain, or nonce change.
7. Use explicit language: “Automatic execution enabled” rather than vague
   terms such as “smart mode.”
8. Provide a one-click per-wallet pause and global kill switch. Pausing must
   take effect before the next signing step, not merely hide UI controls.
9. Policy history is append-only from the user's perspective: show who/what
   changed it locally, when, old/new values, and why.

Do not expose raw private-key values in this UI. Do not make an accidental
single-click enablement path.

---

## Proposal, approval, and execution workflow

Implement a single pipeline for UI, scheduler, control API, and MCP callers.

```text
Trigger/event
  → build normalized ActionProposal
  → classify + decode operation
  → evaluate policy and global envelope
  → simulate + fetch fresh chain state
  → reserve caps/rate/nonce atomically
  → [deny | queue manual approval | sign and broadcast autonomously]
  → track pending transaction
  → finalize/reconcile/release reservation
  → append audit event
```

### Rules for all entry points

- Frontend, scheduler, local HTTP control API, and MCP must all call the same
  Rust authorization pipeline. No bypass path is acceptable.
- Only trusted in-app sources may originate an executable autonomous proposal
  in v1: the internal mint-event workflow and the existing simulation-only
  snipe scheduler. Each source must have its own typed source identity,
  allowlisted event schema, and source-to-action constraints. A generic UI,
  loopback HTTP, or MCP caller may create a dry-run or request a manual prompt,
  but may not enqueue an autonomously executable proposal.
- The loopback control API remains bearer-authenticated and is capability
  scoped: read/status/dry-run/prompt capabilities are distinct from scheduler
  control, and none grants autonomous-execution origination or raw signing.
- The policy engine returns structured, machine-readable denial codes as well
  as safe human-readable explanations.
- A proposal must be idempotent. Replayed triggers, duplicate webhooks, and
  reconnects must not create duplicate broadcasts.
- Bind a proposal to a stable idempotency key derived from event source,
  wallet, policy version, decoded action, and intended nonce where applicable.
- Re-evaluate immediately before signing. Do not sign a proposal that was
  approved/simulated under stale state.
- If a manual approval is required, no cap/nonce reservation may remain held
  indefinitely. Use a short reservation expiry and safely release it on timeout.
- A manual confirmation must not auto-approve a replacement transaction with a
  higher fee or a different nonce/payload.

### Exact manual transaction approval protocol

Allocate the nonce and construct the complete canonical unsigned transaction
**before** showing the approval UI. The approval digest must include:

```text
from, chain_id, transaction_type, nonce, to, value, calldata,
gas_limit, max_fee_per_gas, max_priority_fee_per_gas, access_list,
blob/versioned-hash fields when applicable, policy version, and expiry
```

Rust stores the canonical serialized transaction and its digest. Immediately
before signing it rebuilds the transaction from the stored data, byte-compares
it against the approved canonical serialization, verifies the reservation and
authorization fence, and only then signs. Any different nonce, fee, transaction
type, access list, blob field, destination, value, calldata, policy version, or
expired approval requires a new approval. “Nonce if known” is not acceptable.

### Exact autonomous transaction authorization

Autonomous execution uses the **same complete canonical unsigned-transaction
binding** as manual approval. After final simulation and before reservation,
the executor constructs the exact unsigned transaction, including nonce and
fee fields, persists its canonical serialization and digest, and stores that
digest inside the authorization lease. Immediately before signing, Rust rebuilds
the transaction and byte-compares it to the fenced serialization. Any changed
nonce, fee, transaction type, access list/blob field, calldata, value,
destination, policy version, or expiry invalidates the lease and requires a
complete re-evaluation, re-simulation, new reservation, and new lease. An
`action_digest` that omits any of these fields must never authorize signing.

### Authorization lease / fence

Policy evaluation is not sufficient on its own because a policy can be paused
or revoked after evaluation. In the same durable transaction that reserves
budget and nonce, create an authorization lease containing policy version,
wallet generation, global kill-switch generation, action digest, and a short
expiry. The executor must hold and validate this fence immediately before
signing and through broadcast submission. Policy edit/disable/delete, wallet
pause, and kill-switch activation must increment their generation and invalidate
all affected leases. If a lease is invalid, expired, or cannot be atomically
validated, do not sign.

### Autonomous mint validation

Before automatic mint execution, verify all of the following:

1. Chain id is exactly 1.
2. Wallet is the policy wallet and has a valid local signer.
3. Policy and exact rule are enabled and unexpired.
4. Destination contract matches the normalized contract allowlist.
5. Calldata selector matches an approved mint selector.
6. ABI decode succeeds; unsupported overloads or dynamic parameters deny.
7. Every decoded parameter matches rule constraints, including quantity,
   allowlist/proof semantics, and recipient. The recipient must be the policy
   wallet in v1.
8. Native value is non-negative and below per-rule, daily, lifetime, envelope,
   and user-defined caps.
9. Estimated gas, max fee, priority fee, and total possible cost stay below
   policy limits. Treat worst-case payable value + maximum fee as reserved cost.
10. Rule time window, execution count, and rate limits pass.
11. Contract bytecode is present; if the policy stores a contract-code hash,
    it matches. In v1 the code hash is mandatory, not optional. Reject proxy,
    minimal-proxy, delegatecall-router, and upgradeable destinations from
    autonomous minting unless a separately designed implementation-address and
    storage-slot verification scheme is added. A changed code hash denies and
    requires a manual review.
12. `eth_call`/simulation succeeds using the current state. Revert, unknown
    result, stale RPC, or untrusted simulation response denies.
13. Nonce is allocated through the existing nonce manager and reservation is
    committed atomically with policy accounting.
14. Kill switch, wallet pause, and policy version are checked again after
    reservation and immediately before signing.

### Manual approval validation

The manual path must still apply the global envelope, chain validation,
simulation warnings, nonce safety, and transaction decoding. “Manual” means
user intent is present; it does not mean safety checks are skipped.

For manual-only operations that cannot be safely decoded, show a high-risk
warning and require the user to explicitly acknowledge that the app cannot
fully determine the economic effect.

### RPC freshness, simulation, and finality rules

For v1, make these rules concrete and enforce them in Rust:

- Use only configured/allowlisted RPC endpoints and verify `chainId == 1` on
  startup and before autonomous execution.
- Capture the simulation block number and block hash. Re-fetch latest block and
  re-simulate immediately before reservation/signing; the final simulation may
  be no older than 10 seconds and may not be more than 2 blocks behind the
  latest observed head.
- Treat an RPC as unhealthy when latest block timestamp is older than 90
  seconds, the request errors/times out, chain id changes, or returned data is
  internally inconsistent. Healthy is a hard requirement, not a display label.
- If two independent configured RPC providers are available, require matching
  chain id, head within 2 blocks, and matching destination code hash. If only
  one is configured, do not claim quorum; use the conservative single-provider
  checks and fail closed on any uncertainty.
- Record a transaction as final only after 12 mainnet confirmations. Before
  finality, retain the full reservation and status as pending/reorg-sensitive.
- Any state change between simulation and broadcast is unavoidable; the short
  final re-simulation, authorization fence, code-hash check, and bounded
  expiration are the required mitigation. Never retry a changed transaction
  automatically without full re-evaluation.

---

## Budget, nonce, and transaction-lifecycle edge cases

Cover each case with an implementation and tests.

### Concurrency and caps

- Two simultaneous triggers must never both consume the same remaining cap.
- Reserve `value + maximum transaction fee` before signing; settle to actual
  gas cost after receipt and release unused fee reserve.
- A dropped, replaced, reverted, or expired transaction requires explicit
  reconciliation. Never blindly treat it as success or immediately re-spend
  the full reservation without checking chain state.
- Enforce policy caps and existing envelope caps together; the tighter cap wins.
- If daily boundary/clock is ambiguous, deny automatic execution. Use a clearly
  documented UTC day boundary.

### Nonce and mempool behavior

- Use the existing nonce manager; do not obtain nonces independently in another
  autonomy path.
- Do not reuse a nonce with a different action after restart until chain and
  local pending state are reconciled.
- Replacement/cancel transactions are manual-only in v1.
- If an externally submitted transaction advances the nonce, invalidate stale
  proposals/reservations and notify the user.
- On RPC timeout after broadcast, mark as `broadcast_unknown`; query the
  transaction hash and account nonce before retrying. Never automatically send
  a duplicate.

### Chain/RPC problems

- Wrong chain, unsupported chain, block lag beyond a defined threshold, RPC
  disagreement, rate limiting, simulation timeout, or inability to estimate
  gas must fail closed for autonomous actions.
- Reorgs: retain audit history, mark affected action `reorg_pending`, and wait
  for a documented confirmation threshold before final settlement.
- App restart: load pending proposals/reservations, reconcile each against
  chain state, and keep autonomy paused for an affected wallet until resolved.
- Offline mode: never autonomously sign/broadcast. Manual preparation may be
  allowed, but final approval must run fresh validation when online.

### Policy changes while work is queued

- Every queued proposal references a policy version.
- Any policy edit, disable, expiry, wallet pause, or kill-switch activation
  invalidates queued proposals created under the previous state.
- Changing a cap upward, expanding an allowlist, changing recipient rules, or
  enabling autonomy must not preserve old manual approvals.
- Tightening a policy may retain an existing queue only after re-evaluation;
  otherwise invalidate it.

### Asset and contract edge cases

- Reject zero address, malformed address, duplicate allowlist entries, ENS-like
  strings, and mixed-chain addresses in authorization data.
- Reject proxy/implementation ambiguity unless the exact destination and
  code-hash strategy are explicitly supported.
- Treat calldata with unknown selector, multicall, delegatecall, batch executor,
  router, proxy, or arbitrary target as manual-only in v1.
- Do not infer a mint call from a function name alone; selector + ABI + decoded
  argument constraints must match.
- Do not grant automated value transfer because a mint call contains an ETH
  payment. It is authorized only under the dedicated mint rule.
- Handle contract paused/mint sold out/revert as failed action; do not retry in a
  tight loop. Apply exponential backoff and a bounded retry count where retries
  are explicitly allowed.

---

## Audit and privacy requirements

Create a durable, tamper-evident local audit trail. Each record must include the
previous record hash and its own canonical-record hash; verify the chain at app
startup and before export. A verification failure locks autonomous execution for
the affected wallet and asks the user to review/recover. At minimum log:

- event/proposal id and idempotency key
- wallet and chain id
- policy/rule id and version
- classified action type
- safe transaction summary: destination, selector, value, fee cap, nonce, and
  calldata hash (not necessarily full sensitive calldata)
- evaluation inputs and decision code(s)
- manual approval/rejection metadata when applicable
- simulation result and provider health outcome
- reservation, broadcast tx hash, receipt, final/reorg/replaced status
- timestamps and any retry/reconciliation actions

Do not log private keys, seed phrases, raw bearer tokens, API keys, complete
signed transactions before broadcast, or sensitive allowlist/proof data unless
the user explicitly exports diagnostics.

Provide an exportable redacted JSON/CSV audit report for support and debugging,
including the hash-chain verification result and document version.

---

## Tauri, control API, and frontend contract

### Rust commands

Add typed commands rather than exposing persistence internals. Suggested
operations:

```text
get_wallet_policy(wallet)
list_wallet_policies()
create_or_update_wallet_policy(policy_draft, manual_confirmation)
set_wallet_autonomy_mode(wallet, mode, manual_confirmation)
set_wallet_policy_enabled(wallet, enabled, manual_confirmation)
pause_wallet_autonomy(wallet)
evaluate_action_proposal(proposal_input)
list_action_proposals(wallet, filters)
approve_action_proposal(proposal_id, approval_digest)
reject_action_proposal(proposal_id)
list_autonomy_audit(wallet, filters)
```

Names may differ, but preserve these boundaries:

- Commands must never accept a client-supplied “allow autonomous” boolean.
- Policy mutation commands must validate and persist in Rust before reporting
  success.
- `approve_action_proposal` must derive/re-validate the action digest in Rust;
  never trust a UI-supplied digest alone.
- Return structured error/decision codes suitable for UI and MCP use.

### Local control API / MCP

Do not make policy creation, autonomous enablement, key management, or actual
transaction signing available to a generic MCP caller in v1. MCP may:

- read policy status and audit summaries;
- request a dry-run evaluation;
- list pending manual proposals;
- request that the local UI display a confirmation prompt.

The local user must still perform confirmation in the app. If a future MCP
write path is proposed, require a separate explicit security design.

The same restriction applies to the loopback HTTP control API: it can expose
read-only policy/audit/dry-run endpoints and a request to show a local approval
prompt, but it cannot submit a generic executable proposal, issue/consume a
confirmation challenge, mutate policy, or access raw signing.

### Frontend

- Keep all authorization decisions in Rust; TypeScript types are for display
  and transport only.
- Ensure the UI cannot display an “enabled” state before the Rust persistence
  operation succeeds.
- Surface exact denial reasons without exposing secrets.
- Add accessible warnings and keyboard-safe confirmation UI.
- Require a deliberate confirmation for `autonomous`, ideally typed text plus
  local re-authentication/OS authentication if available.

---

## Migration and backward compatibility

1. Existing wallets must migrate to `manual` mode with no rules and autonomy
   disabled.
2. Existing spend envelopes remain active according to their existing semantics
   but do not imply wallet autonomy.
3. Existing snipe rules remain simulation-only and must not gain signing
   authority after this feature ships.
4. Add database migration/versioning and a safe rollback path.
5. If migration cannot be completed, leave the affected wallet in a locked,
   manual-only state and explain the remediation path.
6. Do not remove legacy audit entries; associate new autonomy records by wallet
   and timestamps.

---

## Required tests

Write tests before declaring the feature complete. Prefer unit tests for the
pure policy engine, then integration tests around persistence/signing boundary,
then UI/command tests for critical flows.

### Policy-engine tests

- no policy → deny
- disabled/expired policy → deny
- manual mode → manual approval for every signable action
- assisted mode → queue manual approval, never auto-sign
- autonomous mode with exact mint match → eligible only after all checks
- wrong wallet/chain/recipient/contract/selector/parameter hash → deny
- explicit deny rule overrides allow rule
- unknown selector/ABI decode failure/multicall/delegatecall → deny
- transfer, approval, permit, typed-data, marketplace, and generic call →
  manual-only even in autonomous mode
- per-action, hourly, daily, lifetime, policy, and envelope cap boundaries
- policy/rule expiry boundary including exact time behavior
- policy version change invalidates queued proposal/approval
- duplicate trigger/idempotency key does not create a second action

### Transaction and persistence tests

- concurrent requests cannot overspend cap or reuse nonce
- reserve → broadcast → success settles actual cost correctly
- reserve → revert/drop/timeout/replacement/reorg releases/reconciles correctly
- restart recovery reconciles pending action and blocks duplicate broadcast
- global kill switch or wallet pause between evaluation and signing blocks send
- external nonce change invalidates stale proposal
- watch-only wallet cannot reach a signing method
- audit log contains every transition and excludes secrets

### UI/command tests

- all existing wallets initially show manual mode
- enabling autonomous mode requires deliberate confirmation
- vault template cannot be configured to bypass manual approval through UI
- mint template rejects missing contract/selector/caps/expiry/fee cap
- test-policy view shows a precise deny explanation
- manual approval invalidates when proposal payload or policy version changes
- one-click wallet pause and global kill switch are reflected immediately
- control API/MCP cannot bypass local manual approval

### Regression tests

Run the existing Rust, frontend, and MCP smoke tests. Fix any test harness
issues encountered; do not mask failures by skipping tests.

---

## Definition of done

Do not call this complete until all items below are true:

- [ ] Every wallet defaults to manual, disabled autonomy.
- [ ] A mint wallet can be configured with a narrow, expiring, bounded policy.
- [ ] A vault wallet always requires manual confirmation for every signable
      action, including actions initiated through scheduler/control/MCP paths.
- [ ] Rust is the sole decision-maker for authorization.
- [ ] Policy/envelope/kill-switch/nonce checks execute immediately before
      signing, and reservations are atomic.
- [ ] Unsupported, malformed, stale, offline, and ambiguous cases fail closed.
- [ ] No automatic approvals, permits, transfers, generic calls, marketplace
      signatures, or policy changes exist in v1.
- [ ] Audit history and clear user-facing explanations exist for every decision.
- [ ] Existing wallets and snipe rules do not gain autonomous signing authority.
- [ ] Unit, integration, UI, and regression tests pass.
- [ ] Documentation explains modes, limits, manual-only operations, recovery,
      policy expiry, and kill-switch behavior in plain language.

---

## Claude Code working instructions

1. Start by summarizing the existing envelope/signing/nonce/persistence paths
   and propose a file-by-file implementation plan. Do not write code until the
   plan identifies every signing entry point and confirms how each will use the
   shared authorization pipeline.
2. Implement the pure Rust policy domain and tests first. Keep evaluation
   deterministic and independent of UI/network calls where possible.
3. Add persistence/migrations and audit records next, then integrate the
   signing pipeline, then Tauri commands/types, then UI.
4. Prefer small, reviewable changes. Do not refactor unrelated modules.
5. Do not weaken current envelope checks. The new policy system supplements
   them; it never replaces them.
6. Stop and ask for direction before adding support for any autonomous action
   beyond the explicitly constrained mint operation above.
7. At handoff, provide: changed files, migration behavior, security decisions,
   known limitations, test commands/results, and any remaining manual QA steps.
