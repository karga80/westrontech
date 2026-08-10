'use client';

// Wallet autonomy policy UI — T17 (docs/WALLET_AUTONOMY_POLICY_BRIEF.md).
//
// This screen is the only place a user can see and act on:
//   - a wallet's autonomy mode (manual / assisted / autonomous) and enabled flag
//   - its rule list (contract allowlist, per-tx/budget caps, rate limit, expiry)
//   - its approval queue (RequiresApproval proposals waiting on a human click)
//   - its tamper-evident audit trail
//
// Every authorization decision is made in Rust (`AutonomyEngine::evaluate`).
// Nothing here re-implements or second-guesses that — this file only displays
// what Rust already decided and forwards user intent (mode change, rule
// edit, approve/reject) to the exact Tauri commands in `src/lib/tauri.ts`.
//
// Per this wallet's engine (`src-tauri/src/autonomy/engine.rs`), only `Mint`
// can ever resolve to automatic execution, and only under Autonomous mode —
// every other action type always requires a human click regardless of mode.
// The copy below says this explicitly so "Autonomous" is never read as
// "everything happens automatically".

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { loadOwnedWallets, type StoredWallet } from '@/lib/walletStore';
import { formatWeiToEth, parseEthToWei } from '@/lib/distribute';
import {
  getWalletPolicy,
  setWalletAutonomyMode,
  setWalletPolicyEnabled,
  pauseWalletAutonomy,
  createOrUpdateWalletPolicy,
  listPendingActionProposals,
  approveActionProposal,
  rejectActionProposal,
  listAutonomyAudit,
  getEnvelopeStatus,
  type WalletPolicy,
  type AutonomyRule,
  type AutonomyMode,
  type AutonomyActionType,
  type RuleEffect,
  type PendingActionProposal,
  type PendingActionPayload,
  type AuditRecord,
  type AuditRecordKind,
  type EnvelopeStatus,
} from '@/lib/tauri';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const ETH_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// ─── Shared style helpers (match the rest of this settings page) ────────────

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)',
  width: '140px', flexShrink: 0,
};
const inputStyle: React.CSSProperties = {
  flex: 1, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)',
  padding: '6px 10px', color: 'var(--wr-text)', fontSize: '12px',
  fontFamily: 'var(--font-jetbrains)', outline: 'none',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  padding: '10px 16px', borderBottom: '1px solid var(--wr-border)',
};
const blockHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px',
  padding: '8px 16px', backgroundColor: 'var(--wr-surface-alt)',
  borderBottom: '1px solid var(--wr-border)',
};
const inlineBtn: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
  backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)',
  border: 'none', flexShrink: 0,
};
const dangerBtn: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
  backgroundColor: 'transparent', color: 'var(--wr-danger)',
  border: '1px solid var(--wr-border)', flexShrink: 0,
};
const ghostBtn: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '0.05em', padding: '4px 10px', cursor: 'pointer',
  backgroundColor: 'transparent', color: 'var(--wr-text-3)',
  border: '1px solid var(--wr-border)', flexShrink: 0,
};

// ─── Labels & descriptions ───────────────────────────────────────────────────

const ACTION_TYPE_LABELS: Record<AutonomyActionType, string> = {
  read_only: 'Read only',
  mint: 'Mint',
  transfer_native: 'Send ETH',
  transfer_erc20: 'Send ERC-20',
  transfer_erc721: 'Transfer NFT (ERC-721)',
  transfer_erc1155: 'Transfer NFT (ERC-1155)',
  marketplace_list: 'Marketplace: list',
  marketplace_bid_or_offer: 'Marketplace: bid/offer',
  marketplace_cancel: 'Marketplace: cancel',
  contract_call_known: 'Contract call (known)',
  contract_call_unknown: 'Contract call (unknown)',
  erc20_approve: 'ERC-20 approve',
  set_approval_for_all: 'NFT operator approval',
  permit_or_permit2: 'Permit / Permit2',
  typed_data_sign: 'Typed-data signature',
  personal_message_sign: 'Message signature',
  wallet_management: 'Wallet management',
  policy_management: 'Policy management',
};

// Only Mint can ever auto-execute (src-tauri/src/autonomy/engine.rs, step 9).
// Everything else always queues for manual approval, in every mode.
const CAN_AUTO_EXECUTE: Set<AutonomyActionType> = new Set(['mint']);

const MODE_LABELS: Record<AutonomyMode, string> = {
  manual: 'Manual',
  assisted: 'Assisted',
  autonomous: 'Autonomous',
};

const MODE_EXPLANATION: Record<AutonomyMode, string> = {
  manual:
    'Every signable action for this wallet requires a fresh manual approval. Nothing signs or broadcasts on its own.',
  assisted:
    'This wallet can monitor, prepare, and simulate actions ahead of time, but every transaction still waits for one explicit approval before it signs.',
  autonomous:
    'Only a Mint action that exactly matches an active allow rule below — and passes every safety check — may sign and send without a click. Every other action type (sends, NFT transfers, marketplace list/bid/cancel, approvals, signatures) still requires manual approval even in this mode.',
};

function describeRule(rule: AutonomyRule): string {
  const parts: string[] = [];
  parts.push(rule.effect === 'deny' ? 'Deny' : 'Allow');
  parts.push(ACTION_TYPE_LABELS[rule.action_type]);
  if (rule.effect === 'allow') {
    parts.push(`up to ${formatWeiToEth(BigInt(rule.per_tx_cap_wei))} ETH per tx`);
    parts.push(`${formatWeiToEth(BigInt(rule.total_budget_cap_wei))} ETH total budget`);
  }
  if (rule.allowed_contracts.length > 0) {
    parts.push(`contracts: ${rule.allowed_contracts.map(c => `${c.slice(0, 6)}…${c.slice(-4)}`).join(', ')}`);
  }
  if (rule.rate_limit_max_executions != null && rule.rate_limit_window_seconds != null) {
    parts.push(`max ${rule.rate_limit_max_executions}× / ${rule.rate_limit_window_seconds}s`);
  }
  parts.push(rule.expires_at != null ? `expires ${new Date(rule.expires_at * 1000).toLocaleString()}` : 'no expiry');
  if (!rule.enabled) parts.push('(disabled)');
  return parts.join(' · ');
}

function describePayload(payload: PendingActionPayload): string {
  switch (payload.kind) {
    case 'send_eth':
      return `Send ${formatWeiToEth(BigInt(payload.value_wei))} ETH to ${payload.to.slice(0, 6)}…${payload.to.slice(-4)}`;
    case 'transfer_nft':
      return `Transfer ${payload.token_standard} #${payload.token_id} (${payload.contract_address.slice(0, 6)}…${payload.contract_address.slice(-4)}) to ${payload.to.slice(0, 6)}…${payload.to.slice(-4)}${payload.amount ? ` × ${payload.amount}` : ''}`;
    case 'marketplace_list':
      return `List ${payload.contract_address.slice(0, 6)}…${payload.contract_address.slice(-4)} #${payload.token_id} on ${payload.marketplace} for ${payload.price_eth} ETH (expires in ${payload.expiry_hours}h)`;
    case 'marketplace_bid':
      return `Bid ${payload.price_eth} ETH × ${payload.quantity} on ${payload.contract_address.slice(0, 6)}…${payload.contract_address.slice(-4)} via ${payload.marketplace} (expires in ${payload.expiry_hours}h)`;
    case 'marketplace_cancel':
      return `Cancel order ${payload.order_hash.slice(0, 10)}… on ${payload.marketplace}`;
    default:
      return 'Unknown action';
  }
}

function describeAuditKind(kind: AuditRecordKind): string {
  switch (kind.event) {
    case 'proposal_created':
      return `Proposal created — ${ACTION_TYPE_LABELS[kind.action_type]}${kind.target_contract ? ` → ${kind.target_contract.slice(0, 6)}…${kind.target_contract.slice(-4)}` : ''}, ${formatWeiToEth(BigInt(kind.value_wei))} ETH`;
    case 'decision':
      return `Decision: ${kind.outcome.decision} — ${kind.outcome.reason}`;
    case 'lease_created':
      return `Authorization lease created (expires ${new Date(kind.expires_at * 1000).toLocaleTimeString()})`;
    case 'approved':
      return `Approved${kind.note ? ` — ${kind.note}` : ''}`;
    case 'denied':
      return `Denied — ${kind.reason}`;
    case 'signed':
      return `Signed${kind.calldata_hash ? ` (calldata ${kind.calldata_hash.slice(0, 10)}…)` : ''}`;
    case 'broadcast':
      return `On chain — tx ${kind.tx_hash.slice(0, 10)}…`;
    case 'replaced':
      return `Replaced ${kind.old_tx_hash.slice(0, 10)}… → ${kind.new_tx_hash.slice(0, 10)}… (${kind.reason})`;
    case 'finalized':
      return `Finalized — tx ${kind.tx_hash.slice(0, 10)}… (${kind.confirmations} confirmations)`;
    case 'policy_changed': {
      const c = kind.change;
      switch (c.change) {
        case 'mode_changed': return `Policy changed — mode ${c.from} → ${c.to}`;
        case 'enabled': return 'Policy changed — enabled';
        case 'disabled': return 'Policy changed — disabled';
        case 'rule_created': return `Policy changed — rule #${c.rule_index} created`;
        case 'rule_updated': return `Policy changed — rule #${c.rule_index} updated`;
        case 'rule_deleted': return `Policy changed — rule #${c.rule_index} deleted`;
        case 'kill_switch_paused': return 'Policy changed — autonomy paused';
        case 'kill_switch_resumed': return 'Policy changed — autonomy resumed';
        default: return 'Policy changed';
      }
    }
    default:
      return 'Autonomy event';
  }
}

// ─── datetime-local <-> unix seconds ─────────────────────────────────────────

function toDatetimeLocalValue(sec: number | null): string {
  if (sec == null) return '';
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(v: string): number | null {
  if (!v.trim()) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

// ─── Mode-change confirmation modal ──────────────────────────────────────────

function ModeChangeModal({
  toMode, busy, error, onCancel, onConfirm,
}: {
  toMode: AutonomyMode;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const requiresTyped = toMode === 'autonomous';
  const CONFIRM_WORD = 'AUTONOMOUS';
  // Exact match only — trim surrounding whitespace, nothing else. No case
  // normalization, no prefix/substring matching. A confirmation gate that
  // accepts "close enough" isn't a confirmation gate.
  const canConfirm = !requiresTyped || typed.trim() === CONFIRM_WORD;

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onCancel(); }}
    >
      <div style={{ width: '460px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '15px', fontWeight: 600, color: 'var(--wr-text)' }}>
            Switch to {MODE_LABELS[toMode]}?
          </span>
          <button onClick={onCancel} disabled={busy} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', lineHeight: 1.6 }}>
            {MODE_EXPLANATION[toMode]}
          </div>
          {requiresTyped && (
            <div>
              <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '5px' }}>
                Type {CONFIRM_WORD} to confirm
              </label>
              <input
                value={typed}
                onChange={e => setTyped(e.target.value)}
                placeholder={CONFIRM_WORD}
                autoFocus
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', width: '100%', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '9px 12px', color: 'var(--wr-text)', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          )}
          {error && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onConfirm} disabled={!canConfirm || busy}
              style={{ backgroundColor: 'var(--wr-accent)', color: 'var(--wr-accent-text)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '10px 20px', border: 'none', cursor: (!canConfirm || busy) ? 'not-allowed' : 'pointer', opacity: (!canConfirm || busy) ? 0.5 : 1 }}>
              {busy ? 'Working…' : `Confirm — set to ${MODE_LABELS[toMode]}`}
            </button>
            <button onClick={onCancel} disabled={busy}
              style={{ backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', padding: '10px 16px', border: '1px solid var(--wr-border)', cursor: busy ? 'not-allowed' : 'pointer' }}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Rule editor form (add or edit-by-index) ─────────────────────────────────

interface RuleDraft {
  enabled: boolean;
  effect: RuleEffect;
  action_type: AutonomyActionType;
  perTxCapEth: string;
  totalBudgetCapEth: string;
  expiresAtLocal: string;
  allowedContracts: string;
  rateLimitMaxExecutions: string;
  rateLimitWindowSeconds: string;
}

const BLANK_DRAFT: RuleDraft = {
  enabled: true,
  effect: 'allow',
  action_type: 'mint',
  perTxCapEth: '0',
  totalBudgetCapEth: '0',
  expiresAtLocal: '',
  allowedContracts: '',
  rateLimitMaxExecutions: '',
  rateLimitWindowSeconds: '',
};

function ruleToDraft(rule: AutonomyRule): RuleDraft {
  return {
    enabled: rule.enabled,
    effect: rule.effect,
    action_type: rule.action_type,
    perTxCapEth: formatWeiToEth(BigInt(rule.per_tx_cap_wei)),
    totalBudgetCapEth: formatWeiToEth(BigInt(rule.total_budget_cap_wei)),
    expiresAtLocal: toDatetimeLocalValue(rule.expires_at),
    allowedContracts: rule.allowed_contracts.join(', '),
    rateLimitMaxExecutions: rule.rate_limit_max_executions != null ? String(rule.rate_limit_max_executions) : '',
    rateLimitWindowSeconds: rule.rate_limit_window_seconds != null ? String(rule.rate_limit_window_seconds) : '',
  };
}

/** Returns the built rule, or a user-facing error string. */
function draftToRule(draft: RuleDraft): AutonomyRule | string {
  const perTxWei = parseEthToWei(draft.perTxCapEth);
  if (perTxWei == null) return 'Per-tx cap must be a valid non-negative ETH amount.';
  const totalWei = parseEthToWei(draft.totalBudgetCapEth);
  if (totalWei == null) return 'Total budget cap must be a valid non-negative ETH amount.';

  const contracts = draft.allowedContracts
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0);
  for (const c of contracts) {
    if (!ETH_ADDR_RE.test(c)) return `Invalid contract address: ${c}`;
  }

  let rateMax: number | null = null;
  if (draft.rateLimitMaxExecutions.trim()) {
    const n = Number(draft.rateLimitMaxExecutions);
    if (!Number.isInteger(n) || n <= 0) return 'Rate limit max executions must be a positive integer.';
    rateMax = n;
  }
  let rateWindow: number | null = null;
  if (draft.rateLimitWindowSeconds.trim()) {
    const n = Number(draft.rateLimitWindowSeconds);
    if (!Number.isInteger(n) || n <= 0) return 'Rate limit window must be a positive integer (seconds).';
    rateWindow = n;
  }
  if ((rateMax == null) !== (rateWindow == null)) {
    return 'Rate limit needs both max executions and a window — or leave both blank.';
  }

  return {
    enabled: draft.enabled,
    effect: draft.effect,
    action_type: draft.action_type,
    per_tx_cap_wei: perTxWei.toString(),
    total_budget_cap_wei: totalWei.toString(),
    expires_at: fromDatetimeLocalValue(draft.expiresAtLocal),
    allowed_contracts: contracts,
    rate_limit_max_executions: rateMax,
    rate_limit_window_seconds: rateWindow,
  };
}

function RuleForm({
  draft, setDraft, onSave, onCancel, saving, error, editing,
}: {
  draft: RuleDraft;
  setDraft: (d: RuleDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
  editing: boolean;
}) {
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px', backgroundColor: 'var(--wr-surface-alt)' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Action type</label>
          <select value={draft.action_type} onChange={e => setDraft({ ...draft, action_type: e.target.value as AutonomyActionType })} style={{ ...inputStyle, width: '100%' }}>
            {(Object.keys(ACTION_TYPE_LABELS) as AutonomyActionType[]).map(t => (
              <option key={t} value={t}>{ACTION_TYPE_LABELS[t]}{CAN_AUTO_EXECUTE.has(t) ? '' : ' (manual-only in v1)'}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Effect</label>
          <select value={draft.effect} onChange={e => setDraft({ ...draft, effect: e.target.value as RuleEffect })} style={{ ...inputStyle, width: '100%' }}>
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
          </select>
        </div>
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'flex-end', gap: '6px', paddingBottom: '6px' }}>
          <input id="rule-enabled" type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
          <label htmlFor="rule-enabled" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Enabled</label>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Per-tx cap (ETH)</label>
          <input value={draft.perTxCapEth} onChange={e => setDraft({ ...draft, perTxCapEth: e.target.value })} placeholder="0.05" style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div style={{ flex: '1 1 140px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Total budget cap (ETH)</label>
          <input value={draft.totalBudgetCapEth} onChange={e => setDraft({ ...draft, totalBudgetCapEth: e.target.value })} placeholder="0.2" style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Expires (blank = never)</label>
          <input type="datetime-local" value={draft.expiresAtLocal} onChange={e => setDraft({ ...draft, expiresAtLocal: e.target.value })} style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>

      <div>
        <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Allowed contracts (comma-separated, mint only)</label>
        <input value={draft.allowedContracts} onChange={e => setDraft({ ...draft, allowedContracts: e.target.value })} placeholder="0xabc…, 0xdef…" style={{ ...inputStyle, width: '100%' }} />
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Rate limit — max executions</label>
          <input value={draft.rateLimitMaxExecutions} onChange={e => setDraft({ ...draft, rateLimitMaxExecutions: e.target.value })} placeholder="e.g. 1" style={{ ...inputStyle, width: '100%' }} />
        </div>
        <div style={{ flex: '1 1 160px' }}>
          <label style={{ ...labelStyle, width: 'auto', display: 'block', marginBottom: '4px' }}>Rate limit — window (seconds)</label>
          <input value={draft.rateLimitWindowSeconds} onChange={e => setDraft({ ...draft, rateLimitWindowSeconds: e.target.value })} placeholder="e.g. 3600" style={{ ...inputStyle, width: '100%' }} />
        </div>
      </div>

      {error && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onSave} disabled={saving} style={{ ...inlineBtn, padding: '7px 16px', opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : editing ? 'Save Rule' : 'Add Rule'}
        </button>
        <button onClick={onCancel} disabled={saving} style={{ ...ghostBtn, padding: '7px 16px' }}>Cancel</button>
      </div>
    </div>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export default function AutonomySection() {
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selected, setSelected] = useState<string>('');

  const [policy, setPolicy] = useState<WalletPolicy | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyError, setPolicyError] = useState('');

  const [modeTarget, setModeTarget] = useState<AutonomyMode | null>(null);
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState('');

  const [enabledBusy, setEnabledBusy] = useState(false);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [pauseMsg, setPauseMsg] = useState('');

  const [envelope, setEnvelope] = useState<EnvelopeStatus | null>(null);

  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>(BLANK_DRAFT);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleError, setRuleError] = useState('');

  const [pending, setPending] = useState<PendingActionProposal[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, string>>({});

  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [auditValid, setAuditValid] = useState<boolean | null>(null);
  const [auditChainError, setAuditChainError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');

  useEffect(() => {
    const owned = loadOwnedWallets();
    setWallets(owned);
    if (owned[0]) setSelected(owned[0].address);
  }, []);

  const loadPolicy = useCallback(async (address: string) => {
    if (!isTauri || !address) { setPolicy(null); return; }
    setPolicyLoading(true);
    setPolicyError('');
    try {
      const p = await getWalletPolicy(address);
      setPolicy(p);
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : String(e));
      setPolicy(null);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadPending = useCallback(async (address: string) => {
    if (!isTauri || !address) { setPending([]); return; }
    setPendingLoading(true);
    setPendingError('');
    try {
      setPending(await listPendingActionProposals(address));
    } catch (e) {
      setPendingError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async (address: string) => {
    if (!isTauri || !address) { setAuditRecords([]); setAuditValid(null); return; }
    setAuditLoading(true);
    setAuditError('');
    try {
      const view = await listAutonomyAudit(address);
      setAuditRecords([...view.records].reverse()); // most recent first
      setAuditValid(view.chain_valid);
      setAuditChainError(view.chain_error ?? null);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  const loadEnvelope = useCallback(async () => {
    if (!isTauri) { setEnvelope(null); return; }
    try {
      setEnvelope(await getEnvelopeStatus());
    } catch {
      setEnvelope(null);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    setPauseMsg('');
    loadPolicy(selected);
    loadPending(selected);
    loadAudit(selected);
  }, [selected, loadPolicy, loadPending, loadAudit]);

  useEffect(() => { loadEnvelope(); }, [loadEnvelope]);

  const reloadAll = () => {
    loadPolicy(selected);
    loadPending(selected);
    loadAudit(selected);
  };

  // ── Mode change ──────────────────────────────────────────────────────────

  const confirmModeChange = async () => {
    if (!modeTarget) return;
    setModeBusy(true);
    setModeError('');
    try {
      const updated = await setWalletAutonomyMode(selected, modeTarget);
      setPolicy(updated);
      setModeTarget(null);
      loadAudit(selected);
    } catch (e) {
      setModeError(e instanceof Error ? e.message : String(e));
    } finally {
      setModeBusy(false);
    }
  };

  const toggleEnabled = async () => {
    if (!policy) return;
    setEnabledBusy(true);
    try {
      const updated = await setWalletPolicyEnabled(selected, !policy.enabled);
      setPolicy(updated);
      loadAudit(selected);
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : String(e));
    } finally {
      setEnabledBusy(false);
    }
  };

  const pauseAutonomy = async () => {
    setPauseBusy(true);
    setPauseMsg('');
    try {
      const updated = await pauseWalletAutonomy(selected);
      setPolicy(updated);
      setPauseMsg('Autonomy paused for this wallet — every action now requires manual approval.');
      loadAudit(selected);
    } catch (e) {
      setPauseMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPauseBusy(false);
    }
  };

  // ── Rules ─────────────────────────────────────────────────────────────────

  const openAddRule = () => {
    setEditingIndex(null);
    setRuleDraft(BLANK_DRAFT);
    setRuleError('');
    setShowRuleForm(true);
  };

  const openEditRule = (idx: number) => {
    if (!policy) return;
    setEditingIndex(idx);
    setRuleDraft(ruleToDraft(policy.rules[idx]));
    setRuleError('');
    setShowRuleForm(true);
  };

  const saveRule = async () => {
    if (!policy) return;
    const built = draftToRule(ruleDraft);
    if (typeof built === 'string') { setRuleError(built); return; }

    const nextRules = editingIndex == null
      ? [...policy.rules, built]
      : policy.rules.map((r, i) => (i === editingIndex ? built : r));
    const nextPolicy: WalletPolicy = { ...policy, rules: nextRules };

    setRuleSaving(true);
    setRuleError('');
    try {
      const saved = await createOrUpdateWalletPolicy(nextPolicy);
      setPolicy(saved);
      setShowRuleForm(false);
      setEditingIndex(null);
      loadAudit(selected);
    } catch (e) {
      setRuleError(e instanceof Error ? e.message : String(e));
    } finally {
      setRuleSaving(false);
    }
  };

  const deleteRule = async (idx: number) => {
    if (!policy) return;
    const nextPolicy: WalletPolicy = { ...policy, rules: policy.rules.filter((_, i) => i !== idx) };
    setPolicyError('');
    try {
      const saved = await createOrUpdateWalletPolicy(nextPolicy);
      setPolicy(saved);
      loadAudit(selected);
    } catch (e) {
      setPolicyError(e instanceof Error ? e.message : String(e));
    }
  };

  // ── Approval queue ───────────────────────────────────────────────────────

  const approve = async (id: string) => {
    setActingOn(id);
    setActionResults(prev => ({ ...prev, [id]: '' }));
    try {
      const result = await approveActionProposal(id);
      const msg = result.kind === 'tx_sent'
        ? `Transaction submitted — hash ${result.tx_hash}`
        : `Order completed — ${result.result.status}${result.result.tx_hash ? ` (tx ${result.result.tx_hash})` : ''}${result.result.error ? ` — ${result.result.error}` : ''}`;
      setActionResults(prev => ({ ...prev, [id]: msg }));
      loadPending(selected);
      loadAudit(selected);
    } catch (e) {
      setActionResults(prev => ({ ...prev, [id]: `Approval failed: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setActingOn(null);
    }
  };

  const reject = async (id: string) => {
    setActingOn(id);
    try {
      await rejectActionProposal(id);
      loadPending(selected);
      loadAudit(selected);
    } catch (e) {
      setActionResults(prev => ({ ...prev, [id]: `Reject failed: ${e instanceof Error ? e.message : String(e)}` }));
    } finally {
      setActingOn(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (!isTauri) {
    return (
      <div style={{ flex: 1, padding: '0 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Autonomy</span>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
          Wallet autonomy policies require the desktop app — not available in browser/dev mode.
        </p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, padding: '0 32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Autonomy</span>
      </div>

      {wallets.length === 0 ? (
        <div style={{ border: '1px solid var(--wr-border)', padding: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
          No owned wallets imported yet. Import a wallet under Security before configuring autonomy.
        </div>
      ) : (
        <>
          {/* Wallet selector */}
          <div style={{ ...rowStyle, border: '1px solid var(--wr-border)', marginBottom: '16px' }}>
            <span style={labelStyle}>Wallet</span>
            <select value={selected} onChange={e => setSelected(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
              {wallets.map(w => (
                <option key={w.id} value={w.address}>{w.name} — {w.address.slice(0, 6)}…{w.address.slice(-4)}</option>
              ))}
            </select>
          </div>

          {policyLoading && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '12px' }}>Loading policy…</div>
          )}
          {policyError && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)', marginBottom: '12px' }}>{policyError}</div>
          )}

          {policy && (
            <>
              {/* Mode + status + kill switch block */}
              <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={blockHeaderStyle}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Mode &amp; Status</span>
                </div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Mode</span>
                  <div style={{ flex: 1, display: 'flex', gap: '8px' }}>
                    {(['manual', 'assisted', 'autonomous'] as AutonomyMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => { if (m !== policy.mode) { setModeTarget(m); setModeError(''); } }}
                        style={{
                          fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
                          padding: '6px 12px', cursor: 'pointer',
                          backgroundColor: policy.mode === m ? 'var(--wr-accent)' : 'transparent',
                          color: policy.mode === m ? 'var(--wr-accent-text)' : 'var(--wr-text-3)',
                          border: policy.mode === m ? 'none' : '1px solid var(--wr-border)',
                        }}
                      >
                        {MODE_LABELS[m].toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ padding: '0 16px 10px', borderBottom: '1px solid var(--wr-border)' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', lineHeight: 1.6 }}>{MODE_EXPLANATION[policy.mode]}</span>
                </div>
                <div style={rowStyle}>
                  <span style={labelStyle}>Policy enabled</span>
                  <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                    {policy.enabled ? 'Enabled — this policy is in effect.' : 'Disabled — every action for this wallet requires manual approval regardless of mode.'}
                  </span>
                  <button onClick={toggleEnabled} disabled={enabledBusy} style={{ ...(policy.enabled ? dangerBtn : inlineBtn), opacity: enabledBusy ? 0.6 : 1 }}>
                    {enabledBusy ? 'Working…' : policy.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
                <div style={{ ...rowStyle, borderBottom: 'none' }}>
                  <span style={labelStyle}>Kill switch</span>
                  <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: envelope?.kill_switch ? 'var(--wr-danger)' : 'var(--wr-text-3)' }}>
                    {envelope == null
                      ? 'No spend envelope configured yet — global kill switch has nothing to switch off.'
                      : envelope.kill_switch
                        ? 'ENGAGED — all autonomous execution is blocked for every wallet.'
                        : 'Not engaged.'}
                    {' '}
                    <Link href="/sniping" style={{ color: 'var(--wr-accent)', textDecoration: 'underline' }}>Manage on Sniping &amp; Automation →</Link>
                  </span>
                  <button onClick={pauseAutonomy} disabled={pauseBusy || !policy.enabled} style={{ ...dangerBtn, opacity: (pauseBusy || !policy.enabled) ? 0.5 : 1, cursor: (pauseBusy || !policy.enabled) ? 'not-allowed' : 'pointer' }}>
                    {pauseBusy ? 'Pausing…' : 'Pause this wallet'}
                  </button>
                </div>
                {pauseMsg && (
                  <div style={{ padding: '4px 16px 10px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: pauseMsg.startsWith('Error') ? 'var(--wr-danger)' : 'var(--wr-success)' }}>{pauseMsg}</div>
                )}
              </div>

              {/* Rules block */}
              <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={blockHeaderStyle}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Rules</span>
                  <span style={{ flex: 1 }} />
                  {!showRuleForm && (
                    <button onClick={openAddRule} style={inlineBtn}>+ Add Rule</button>
                  )}
                </div>
                {policy.rules.length === 0 && !showRuleForm && (
                  <div style={{ padding: '12px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
                    No rules configured. With no active allow rule, this wallet can never auto-execute anything, even in Autonomous mode.
                  </div>
                )}
                {policy.rules.map((rule, idx) => (
                  editingIndex === idx && showRuleForm ? (
                    <RuleForm key={idx} draft={ruleDraft} setDraft={setRuleDraft} onSave={saveRule} onCancel={() => { setShowRuleForm(false); setEditingIndex(null); }} saving={ruleSaving} error={ruleError} editing />
                  ) : (
                    <div key={idx} style={rowStyle}>
                      <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: rule.effect === 'deny' ? 'var(--wr-danger)' : 'var(--wr-text)' }}>
                        {describeRule(rule)}
                      </span>
                      <button onClick={() => openEditRule(idx)} style={ghostBtn}>Edit</button>
                      <button onClick={() => deleteRule(idx)} style={dangerBtn}>Delete</button>
                    </div>
                  )
                ))}
                {showRuleForm && editingIndex == null && (
                  <RuleForm draft={ruleDraft} setDraft={setRuleDraft} onSave={saveRule} onCancel={() => setShowRuleForm(false)} saving={ruleSaving} error={ruleError} editing={false} />
                )}
              </div>

              {/* Approval queue block */}
              <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={blockHeaderStyle}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Approval Queue</span>
                  <span style={{ flex: 1 }} />
                  <button onClick={() => loadPending(selected)} disabled={pendingLoading} style={ghostBtn}>{pendingLoading ? 'Loading…' : 'Refresh'}</button>
                </div>
                {pendingError && (
                  <div style={{ padding: '8px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)' }}>{pendingError}</div>
                )}
                {!pendingLoading && pending.length === 0 && !pendingError && (
                  <div style={{ padding: '12px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
                    No pending proposals for this wallet.
                  </div>
                )}
                {pending.map(p => (
                  <div key={p.id} style={{ ...rowStyle, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '260px' }}>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>{describePayload(p.payload)}</div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '3px' }}>
                        {ACTION_TYPE_LABELS[p.proposal.action_type]} · queued {new Date(p.created_at * 1000).toLocaleString()} · status {p.status} · reason: {p.reason}
                      </div>
                      {actionResults[p.id] && (
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: actionResults[p.id].toLowerCase().includes('fail') ? 'var(--wr-danger)' : 'var(--wr-success)', marginTop: '3px' }}>
                          {actionResults[p.id]}
                        </div>
                      )}
                    </div>
                    {p.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                        <button onClick={() => approve(p.id)} disabled={actingOn === p.id} style={{ ...inlineBtn, opacity: actingOn === p.id ? 0.6 : 1 }}>
                          {actingOn === p.id ? 'Working…' : 'Approve'}
                        </button>
                        <button onClick={() => reject(p.id)} disabled={actingOn === p.id} style={{ ...dangerBtn, opacity: actingOn === p.id ? 0.6 : 1 }}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Audit log block */}
              <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={blockHeaderStyle}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Audit Log</span>
                  {auditValid != null && (
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: auditValid ? 'var(--wr-success)' : 'var(--wr-danger)' }}>
                      {auditValid ? 'CHAIN VERIFIED' : `CHAIN BROKEN${auditChainError ? ` — ${auditChainError}` : ''}`}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <button onClick={() => loadAudit(selected)} disabled={auditLoading} style={ghostBtn}>{auditLoading ? 'Loading…' : 'Refresh'}</button>
                </div>
                {auditError && (
                  <div style={{ padding: '8px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)' }}>{auditError}</div>
                )}
                {!auditLoading && auditRecords.length === 0 && !auditError && (
                  <div style={{ padding: '12px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
                    No autonomy events recorded for this wallet yet.
                  </div>
                )}
                {auditRecords.length > 0 && (
                  <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
                    {auditRecords.map((rec, i) => (
                      <div key={`${rec.sequence}-${i}`} style={{ ...rowStyle, borderBottom: i < auditRecords.length - 1 ? '1px solid var(--wr-border)' : 'none' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', width: '150px', flexShrink: 0 }}>
                          {new Date(rec.timestamp * 1000).toLocaleString()}
                        </span>
                        <span style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>
                          #{rec.sequence} — {describeAuditKind(rec.kind)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={reloadAll} style={ghostBtn}>Refresh all</button>
            </>
          )}
        </>
      )}

      {modeTarget && (
        <ModeChangeModal
          toMode={modeTarget}
          busy={modeBusy}
          error={modeError}
          onCancel={() => { setModeTarget(null); setModeError(''); }}
          onConfirm={confirmModeChange}
        />
      )}
    </div>
  );
}
