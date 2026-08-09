'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { invoke } from '@tauri-apps/api/core';
import {
  getNftsForOwner, getWalletPortfolio, getAssetTransfers, loadAlchemyKey,
  getEnvelopeStatus, sendEth, estimateGas, getEthBalance, openExternalUrl,
  getNftPnl, getPnlSummary,
  type OwnedNft, type AssetTransfer, type WalletToken, type WalletPortfolio,
  type EnvelopeStatus, type NftPnlSummary, type PnlSummary,
} from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { parseUnits, formatEther } from 'viem';
import { loadAddressBook, saveAddressEntry, deleteAddressEntry, updateAddressEntry, type AddressEntry } from '@/lib/addressBook';
import { EMPTY_NFTS_RESPONSE, EMPTY_TRANSFERS } from '@/lib/emptyData';
import { Tag, WALLET_TOKEN_VARIANT } from '@/components/Tag';
import DistributeModal from '@/components/DistributeModal';
import NftThumb from '@/components/NftThumb';

// ─── Wallet Detail Client ─────────────────────────────────────────────────────
//
// Data rule for this screen: every number shown is either something a Tauri
// command returned for THIS wallet, or '—'. There are no fixtures, no
// placeholder wallets and no derived-looking values with no source. Where a
// panel has no backing command yet it says so in words instead of drawing
// something plausible.
//
// Quota rule: Alchemy is on the free tier and this app has a live history of
// HTTP 429s blanking the screen. So: the Holdings tab costs two commands on
// mount, Transactions and Analytics fetch once, lazily, the first time they are
// opened, and nothing fans out per row.

type Tab = 'Holdings' | 'Transactions' | 'Analytics' | 'Address Book';

/** Westron is Ethereum-mainnet only, so the chain badge is a constant fact
 *  rather than a per-wallet field someone can get wrong. */
const CHAIN_BADGE = 'ETH';

interface ResolvedWallet {
  id: string;
  name: string;
  address: string;
}

/** Tauri rejects with a plain string; everything else may be an Error. Never
 *  swallow — this text is rendered. */
function errText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await run() }; } catch (e) { return { ok: false, error: errText(e) }; }
}

const EM_DASH = '—';

function fmtUsd(n: number | null | undefined): string {
  return n != null && Number.isFinite(n)
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : EM_DASH;
}

function fmtEth(n: number | null | undefined, dp = 4): string {
  return n != null && Number.isFinite(n) ? `${n.toFixed(dp)} ETH` : EM_DASH;
}

// ── Transaction row styling ───────────────────────────────────────────────────

const TX_STYLE = {
  Receive: { bg: '#06251b', border: '#06251b', text: '#4fe9b4' },
  Send:    { bg: '#2b070c', border: '#2b070c', text: '#ff8a96' },
  Swap:    { bg: '#2a1800', border: '#2a1e05', text: '#ffb020' },
  NFT:     { bg: '#1a0a2e', border: '#3b1a5a', text: '#a855f7' },
} as const;

type TxType = keyof typeof TX_STYLE;

// ── Shared honest-state blocks ────────────────────────────────────────────────

/** One place for "nothing to show, and here is why". `detail` says what would
 *  have to be true for a number to appear here. */
function StateNote({ title, detail, tone = 'muted' }: { title: string; detail?: string; tone?: 'muted' | 'error' }) {
  return (
    <div style={{ padding: '28px 20px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: tone === 'error' ? '#ff8a96' : 'var(--wr-text-3)' }}>
        {title}
      </div>
      {detail && (
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.6, maxWidth: '520px', marginLeft: 'auto', marginRight: 'auto', wordBreak: 'break-word' }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 10 10" fill="none">
      <path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Transfer Modal — real ETH sends ───────────────────────────────────────────
//
// This modal signs and broadcasts REAL Ethereum mainnet transactions via the
// `send_eth` Tauri command (Keychain key → EIP-1559 → eth_sendRawTransaction).
//
// It previously fabricated a Math.random() hash and marked the transfer
// "confirmed" while nothing was signed and no funds moved. Everything below
// exists so that can never be true again:
//   * nothing is sent unless an active spend envelope authorises it;
//   * the destination is shown in full (never truncated) where it is approved;
//   * the only hash ever rendered is the one the backend returned;
//   * "Broadcast" is the terminal success state — this screen never claims a
//     transaction was confirmed, because nothing here reads a receipt.
//
// Envelope pre-flight: `preview_transaction`.
// It runs exactly the guards `check_and_authorize` runs — active envelope, kill
// switch, expiry, scope, per-transaction ceiling, hard-cap headroom — and
// mutates nothing: no `spent_wei`, no kill switch, no audit entry, no persist.
// So it is called with the REAL amount, on every change, and its verdict is the
// single source of truth for whether the confirm action may enable.
//
// `value_wei` crosses as a decimal STRING. Wei does not survive a JS number, and
// a pre-flight that silently re-rounds the amount it is checking is not a check.
// Nothing on this path goes through Number()/parseFloat().
//
// `check_transaction` is deliberately NOT used anywhere in this file: it is the
// consuming call, and using it as a pre-flight charges the hard cap twice for
// one transfer. `send_eth` performs that authorisation itself, exactly once,
// immediately before signing.

function EthIcon() {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
      <path d="M6 0L0 10.2L6 13.6L12 10.2L6 0Z" fill="#627EEA" opacity="0.9"/>
      <path d="M6 0L0 10.2L6 13.6V0Z" fill="#627EEA" opacity="0.6"/>
      <path d="M6 15.2L0 11.8L6 20L12 11.8L6 15.2Z" fill="#627EEA" opacity="0.9"/>
      <path d="M6 15.2L0 11.8L6 20V15.2Z" fill="#627EEA" opacity="0.6"/>
    </svg>
  );
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDR_RE = /^0x0{40}$/;

type SendState = 'queued' | 'submitting' | 'broadcast' | 'failed' | 'skipped';

interface Destination {
  key: string;
  label: string;
  address: string;
  amountRaw: string;
}

interface SendRow extends Destination {
  valueWei: bigint;
  state: SendState;
  hash?: string;
  error?: string;
}

/** Exact decimal-ETH → wei. No floats anywhere on this path. */
function parseAmountWei(raw: string): { wei: bigint } | { error: string } {
  const s = raw.trim();
  if (!s) return { error: 'no amount entered' };
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return { error: `"${s}" is not a plain decimal number` };
  const frac = s.split('.')[1] ?? '';
  if (frac.length > 18) return { error: 'more than 18 decimal places — ETH cannot represent that' };
  let wei: bigint;
  try { wei = parseUnits(s, 18); } catch { return { error: `"${s}" could not be converted to wei` }; }
  if (wei <= BigInt(0)) return { error: 'must be greater than zero' };
  return { wei };
}

/** Read-only envelope verdict. Mirrors `envelope::engine::TransactionPreview`
 *  (plain snake_case; every wei quantity is a decimal string because these do
 *  not fit in a JS number). `src/lib/tauri.ts` has no wrapper for this command
 *  and is not this file's to edit, so it is invoked directly here. */
interface TransactionPreview {
  authorized: boolean;
  reject_code?: string | null;
  reject_reason?: string | null;
  reject_detail?: string | null;
  envelope_active: boolean;
  kill_switch: boolean;
  expires_at?: number | null;
  in_scope: boolean;
  value_wei: string;
  per_tx_ceiling_wei?: string | null;
  hard_cap_wei?: string | null;
  spent_wei?: string | null;
  remaining_wei?: string | null;
}

/** Rust: preview_transaction(to: String, value_wei: String, calldata: Option<String>) */
async function previewTransaction(params: { to: string; valueWei: string; calldata?: string | null }): Promise<TransactionPreview> {
  return invoke<TransactionPreview>('preview_transaction', {
    to: params.to,
    valueWei: params.valueWei,
    calldata: params.calldata ?? null,
  });
}

/** What the user should do about each stable reject_code. The backend's own
 *  `reject_reason` sentence is always shown next to this — it explains what
 *  happened, this says what to do next. Branching on the code rather than
 *  parsing prose. */
function rejectAction(code: string | null | undefined): string | null {
  switch (code) {
    case 'no_envelope': return 'Create a spend envelope whose scope lists this destination address, then try again.';
    case 'kill_switch': return 'Release the kill switch before anything can be sent.';
    case 'expired': return 'Create a new spend envelope — this one has run out of time.';
    case 'no_scope': return 'The envelope has no scope. Recreate it with the destination address included.';
    case 'out_of_scope': return 'Create an envelope that includes this exact address, or send to an address already in scope.';
    case 'per_tx_ceiling': return 'Lower the amount, or create an envelope with a higher per-transaction ceiling.';
    case 'hard_cap': return 'Lower the amount, or create a new envelope — this one has little headroom left.';
    default: return null;
  }
}

/** Adds an actionable hint to an error string returned by `send_eth` itself,
 *  which formats the `EnvelopeError` with `Debug`. Only used on the send-failure
 *  path; the pre-flight branches on `reject_code` instead. */
function envelopeHint(raw: string): string | null {
  if (raw.includes('KillSwitchActive')) return 'The kill switch is engaged. Release it before sending.';
  if (raw.includes('EnvelopeExpired')) return 'The spend envelope has expired. Create a new one.';
  if (raw.includes('NoScopeDefined')) return 'There is no active spend envelope, or it has no scope. Create one that lists this destination.';
  if (raw.includes('AddressOutOfScope')) return 'This destination is not in the envelope scope. Create an envelope that includes this exact address.';
  if (raw.includes('PerTxCeilingExceeded')) return 'The amount is above the envelope per-transaction ceiling. Lower the amount, or create an envelope with a higher ceiling.';
  if (raw.includes('HardCapExceeded')) return 'This would breach the envelope hard cap, and the kill switch has now been engaged. Review the envelope before retrying.';
  return null;
}

function ethFromWei(wei: bigint): string {
  return `${formatEther(wei)} ETH`;
}

function TransferModal({
  walletName, fromAddress, alchemyKey, isTauri, tokenSymbol, onClose,
}: {
  walletName: string;
  /** The real address held in the wallet store — never a display placeholder. */
  fromAddress: string;
  alchemyKey: string;
  isTauri: boolean;
  /** Symbol of the holding the user pressed Transfer on, if any. */
  tokenSymbol: string | null;
  onClose: () => void;
}) {
  type Phase = 'compose' | 'review' | 'authorise' | 'sending' | 'done';
  const [phase, setPhase] = useState<Phase>('compose');

  const managedWallets: Array<{ id: string; name: string; address: string }> =
    loadWallets().filter((w: { address: string }) => w.address?.toLowerCase() !== fromAddress.toLowerCase());
  const addressBookEntries = loadAddressBook();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [abSelected, setAbSelected] = useState<Set<string>>(new Set());
  const [abAmounts, setAbAmounts] = useState<Record<string, string>>({});
  const [externals, setExternals] = useState([{ address: '', amount: '' }]);

  // Envelope + balance, both real, both refreshed rather than cached forever.
  const [envelope, setEnvelope] = useState<EnvelopeStatus | null>(null);
  const [envelopeLoading, setEnvelopeLoading] = useState(true);
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // Gas estimate (units only — no command exposes a gas price, so a fee in ETH
  // would be invented).
  const [gasUnits, setGasUnits] = useState<Record<string, number>>({});
  const [gasErrors, setGasErrors] = useState<Record<string, string>>({});
  const [gasLoading, setGasLoading] = useState(false);

  // Read-only backend verdict, per destination, for the REAL amount.
  const [preview, setPreview] = useState<Record<string, TransactionPreview>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** Which destination/amount set the verdicts in `preview` were fetched for.
   *  A verdict for a different amount must never gate a send. */
  const [previewFor, setPreviewFor] = useState<string | null>(null);

  // Deliberate-confirmation gate.
  const [verified, setVerified] = useState<Set<string>>(new Set());
  const [typedConfirm, setTypedConfirm] = useState('');

  const [sendRows, setSendRows] = useState<SendRow[]>([]);
  const [batchStopped, setBatchStopped] = useState<string | null>(null);
  /** Set only when the send button is clicked while it cannot actually send —
   *  normally unreachable (the button is `disabled`), but a guard must never
   *  fail silently, so this is the visible fallback if it ever is reached. */
  const [sendGuardMessage, setSendGuardMessage] = useState<string | null>(null);
  /** Latched the moment a send starts. Never reset: one modal, one attempt. */
  const sendStartedRef = useRef(false);

  const refreshEnvelope = useCallback(async () => {
    if (!isTauri) { setEnvelopeLoading(false); return; }
    setEnvelopeLoading(true);
    const res = await settle(() => getEnvelopeStatus());
    if (res.ok) { setEnvelope(res.value); setEnvelopeError(null); }
    else { setEnvelope(null); setEnvelopeError(res.error); }
    setEnvelopeLoading(false);
  }, [isTauri]);

  useEffect(() => { void refreshEnvelope(); }, [refreshEnvelope]);

  useEffect(() => {
    if (!isTauri || !alchemyKey || !ADDR_RE.test(fromAddress)) return;
    let cancelled = false;
    (async () => {
      const res = await settle(() => getEthBalance(fromAddress, alchemyKey));
      if (cancelled) return;
      if (res.ok) {
        try { setBalanceWei(BigInt(res.value.wei)); setBalanceError(null); }
        catch { setBalanceError(`Balance came back unreadable: ${res.value.wei}`); }
      } else setBalanceError(res.error);
    })();
    return () => { cancelled = true; };
  }, [isTauri, alchemyKey, fromAddress]);


  // ── Destinations ────────────────────────────────────────────────────────────

  const destinations: Destination[] = [
    ...Array.from(selected).map(wid => {
      const mw = managedWallets.find(w => w.id === wid);
      return { key: `w:${wid}`, label: mw?.name ?? wid, address: (mw?.address ?? '').trim(), amountRaw: amounts[wid] ?? '' };
    }),
    ...Array.from(abSelected).map(id => {
      const ab = addressBookEntries.find((e: AddressEntry) => e.id === id);
      return { key: `b:${id}`, label: ab?.name ?? id, address: (ab?.address ?? '').trim(), amountRaw: abAmounts[id] ?? '' };
    }),
    ...externals.map((e, i) => ({ key: `x:${i}`, label: 'External address', address: e.address.trim(), amountRaw: e.amount }))
      .filter(d => d.address.length > 0),
  ];

  const parsed = destinations.map(d => ({ d, amount: parseAmountWei(d.amountRaw) }));
  const totalWei = parsed.reduce<bigint>((s, p) => ('wei' in p.amount ? s + p.amount.wei : s), BigInt(0));
  const nowSec = Math.floor(Date.now() / 1000);
  // Live envelope verdict for the real amount. `preview_transaction` is
  // read-only and local (no network, no Alchemy quota, no spend consumed), so
  // it is safe to re-run on every edit — which is the point: the user finds out
  // an amount is over the per-transaction ceiling while typing, not by
  // attempting a send.
  const previewSignature = parsed
    .map(p => `${p.d.key}|${p.d.address.toLowerCase()}|${'wei' in p.amount ? p.amount.wei.toString() : '-'}`)
    .join(';');

  useEffect(() => {
    // Any change to the destinations or amounts invalidates both the previous
    // verdicts and any confirmation the user had already given for them.
    setPreview({});
    setPreviewFor(null);
    setVerified(new Set());
    setTypedConfirm('');
    setSendGuardMessage(null);

    if (!isTauri) { setPreviewLoading(false); return; }
    const rows = parsed
      .filter((x): x is { d: Destination; amount: { wei: bigint } } => ADDR_RE.test(x.d.address) && 'wei' in x.amount);
    if (rows.length === 0) { setPreviewLoading(false); setPreviewError(null); return; }

    let cancelled = false;
    setPreviewLoading(true);
    (async () => {
      const out: Record<string, TransactionPreview> = {};
      for (const r of rows) {
        // Decimal string all the way down — never Number()/parseFloat().
        const res = await settle(() => previewTransaction({ to: r.d.address, valueWei: r.amount.wei.toString() }));
        if (cancelled) return;
        if (!res.ok) { setPreviewError(res.error); setPreviewLoading(false); return; }
        out[r.d.key] = res.value;
      }
      if (cancelled) return;
      setPreview(out);
      setPreviewFor(previewSignature);
      setPreviewError(null);
      setPreviewLoading(false);
    })();
    return () => { cancelled = true; };
    // `previewSignature` collapses the destination/amount set into one value;
    // `parsed` is rebuilt every render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTauri, previewSignature]);

  // ── Guards ──────────────────────────────────────────────────────────────────
  // Blockers stop the send. Warnings are shown but do not stop it. Anything
  // that could put funds somewhere unintended is a blocker.

  /** Destinations complete enough for the backend to have an opinion on. */
  const previewableRows = parsed
    .filter(p => ADDR_RE.test(p.d.address) && 'wei' in p.amount)
    .map(p => p.d);

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!isTauri) blockers.push('Sending requires the Westron desktop app — the browser preview has no signer and no Keychain access.');
  if (isTauri && !alchemyKey) blockers.push('No Alchemy API key is stored. Add one in Settings; the signer needs it to read the nonce and broadcast.');
  if (!ADDR_RE.test(fromAddress)) blockers.push('This wallet has no usable address in local storage, so there is nothing to sign with.');

  if (tokenSymbol && tokenSymbol.toUpperCase() !== 'ETH') {
    blockers.push(`Only native ETH transfers are wired to the signer. "${tokenSymbol}" is an ERC-20 — send_eth cannot move it, and sending from here would move ETH instead. Refusing.`);
  }

  if (destinations.length === 0) blockers.push('No destination selected.');
  if (destinations.length > 1) {
    blockers.push(
      'One destination at a time, by design. The underlying nonce-reuse defect that originally forced this has been fixed in the backend, and sends from one address are now serialised — but batch sending is a new capability, not part of what was approved for this screen, so it stays off until the owner asks for it. Remove a destination and send them one after another.',
    );
  }

  for (const { d, amount } of parsed) {
    if (!ADDR_RE.test(d.address)) blockers.push(`${d.label}: "${d.address}" is not a valid Ethereum address (expected 0x + 40 hex characters).`);
    else if (ZERO_ADDR_RE.test(d.address)) blockers.push(`${d.label}: that is the zero address — funds sent there are destroyed.`);
    else if (d.address.toLowerCase() === fromAddress.toLowerCase()) warnings.push(`${d.label}: destination is this same wallet. The transfer would only cost gas.`);
    if ('error' in amount) blockers.push(`${d.label}: amount ${amount.error}.`);
  }

  const dupes = destinations.filter((d, i) => destinations.findIndex(o => o.address.toLowerCase() === d.address.toLowerCase()) !== i);
  if (dupes.length > 0) warnings.push('The same destination address appears more than once.');

  // Envelope guards, entirely from `preview_transaction`. The verdict already
  // carries every limit — active, kill switch, expiry, scope, per-transaction
  // ceiling and hard-cap headroom — so none of them is re-derived here. The old
  // manual BigInt hard-cap comparison is gone with it, and the per-transaction
  // ceiling is now visible BEFORE a send instead of only on rejection.
  if (isTauri) {
    if (previewError) {
      blockers.push(`The spend envelope could not be checked (${previewError}). Refusing to send without a verdict.`);
    } else if (previewLoading || (previewableRows.length > 0 && previewFor !== previewSignature)) {
      blockers.push('Checking the spend envelope…');
    } else {
      for (const d of previewableRows) {
        const v = preview[d.key];
        if (!v) { blockers.push(`${d.label}: no envelope verdict yet.`); continue; }
        if (!v.authorized) {
          const action = rejectAction(v.reject_code);
          blockers.push(`${d.label}: ${v.reject_reason ?? 'the spend envelope refused this transfer.'}${action ? ` ${action}` : ''}`);
        } else if (!v.in_scope) {
          // Belt and braces: authorized implies in scope, so this would be a
          // backend contradiction. Refuse rather than guess which is right.
          blockers.push(`${d.label}: the envelope authorised this transfer but reports the destination as out of scope. Refusing on the contradiction.`);
        }
      }
    }
  }

  // Balance guard: blocking only when the balance is known and too low.
  if (balanceWei !== null && totalWei > balanceWei) {
    blockers.push(`Balance is ${ethFromWei(balanceWei)}, which is less than ${ethFromWei(totalWei)}. Gas is charged on top of the amount.`);
  } else if (balanceWei === null && isTauri) {
    warnings.push(balanceError
      ? `Balance could not be read (${balanceError}), so sufficient funds have not been verified.`
      : 'Reading the wallet balance…');
  } else if (balanceWei !== null) {
    warnings.push('Gas is charged on top of the amount, so the balance must cover both.');
  }

  const previewFailures = previewableRows
    .map(d => ({ d, v: preview[d.key] }))
    .filter(x => x.v && !x.v.authorized);

  const composeReady = destinations.length > 0;

  // ── Steps ───────────────────────────────────────────────────────────────────

  async function enterReview() {
    setPhase('review');
    await refreshEnvelope();
    // Gas estimate: sequential, one per destination (at most a couple of calls).
    if (!isTauri || !alchemyKey) return;
    setGasLoading(true);
    const units: Record<string, number> = {};
    const errs: Record<string, string> = {};
    for (const { d, amount } of parsed) {
      if (!ADDR_RE.test(d.address) || !('wei' in amount)) continue;
      const res = await settle(() => estimateGas(d.address, amount.wei.toString(), undefined, alchemyKey));
      if (res.ok) units[d.key] = res.value; else errs[d.key] = res.error;
    }
    setGasUnits(units);
    setGasErrors(errs);
    setGasLoading(false);
  }

  async function enterAuthorise() {
    setPhase('authorise');
    await refreshEnvelope();
  }

  const allVerified = destinations.length > 0 && destinations.every(d => verified.has(d.key));
  const envelopeReady =
    phase === 'authorise' &&
    blockers.length === 0 &&
    !previewLoading &&
    !previewError &&
    previewFor === previewSignature &&
    previewableRows.length > 0 &&
    previewableRows.every(d => preview[d.key]?.authorized === true);
  const canSend = envelopeReady && allVerified && typedConfirm.trim().toUpperCase() === 'SEND';

  /** Reasons the button is inert that `BlockerList` does not already cover —
   *  the deliberate-confirmation gate itself. Shown only once the envelope
   *  has actually cleared the transfer, so it never contradicts a real
   *  blocker above it. A disabled button with no visible reason is a silent
   *  failure the same as a swallowed error. */
  const confirmGate: string[] = [];
  if (envelopeReady) {
    if (!allVerified) confirmGate.push('Tick the confirmation box on each destination above — the address and amount must be read, not assumed.');
    if (typedConfirm.trim().toUpperCase() !== 'SEND') confirmGate.push('Type SEND in the box above to authorise this transfer.');
  }

  async function runSends() {
    // React state updates are async, so `phase` alone cannot stop a second
    // click landing in the same tick. A ref flips synchronously — without it a
    // double-click could broadcast the same transfer twice.
    if (sendStartedRef.current) return; // already sending or sent — the button is disabled, this is belt and braces
    if (!canSend) {
      // The button is `disabled` whenever this is false, so a real click
      // should never reach here — but a handler that no-ops on a condition
      // it doesn't explain is exactly the silent failure this app forbids.
      // If this ever fires, say why instead of doing nothing.
      setSendGuardMessage(
        confirmGate.length > 0
          ? confirmGate.join(' ')
          : 'This transfer cannot be sent yet — see the messages above.',
      );
      return;
    }
    setSendGuardMessage(null);
    sendStartedRef.current = true;
    const rows: SendRow[] = parsed
      .filter((p): p is { d: Destination; amount: { wei: bigint } } => 'wei' in p.amount)
      .map(p => ({ ...p.d, valueWei: p.amount.wei, state: 'queued' as SendState }));
    if (rows.length === 0) {
      sendStartedRef.current = false;
      setSendGuardMessage('No destination with a valid amount was found to send — add a destination and amount and try again.');
      return;
    }
    setSendRows(rows);
    setPhase('sending');

    for (let i = 0; i < rows.length; i++) {
      setSendRows(prev => prev.map((r, j) => (j === i ? { ...r, state: 'submitting' } : r)));
      const res = await settle(() => sendEth(fromAddress, rows[i].address, rows[i].valueWei.toString(), alchemyKey));
      if (res.ok) {
        const hash = res.value;
        setSendRows(prev => prev.map((r, j) => (j === i ? { ...r, state: 'broadcast', hash } : r)));
      } else {
        setSendRows(prev => prev.map((r, j) =>
          j === i ? { ...r, state: 'failed', error: res.error } : j > i ? { ...r, state: 'skipped' } : r));
        setBatchStopped(res.error);
        break;
      }
    }
    setPhase('done');
    await refreshEnvelope();
  }

  // ── Styles (unchanged) ──────────────────────────────────────────────────────

  const btnPrimary: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#7c5cff', border: 'none', padding: '8px 16px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' };
  const btnSecondary: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 16px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' };
  const inputStyle: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 10px', width: '100%', outline: 'none', boxSizing: 'border-box' };
  const labelSm: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' };
  const fullAddr: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', wordBreak: 'break-all', lineHeight: 1.5 };
  const noteBox: React.CSSProperties = { border: '1px solid rgba(248,113,113,0.35)', backgroundColor: 'rgba(248,113,113,0.06)', padding: '10px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', lineHeight: 1.6, wordBreak: 'break-word' };
  const warnBox: React.CSSProperties = { border: '1px solid rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)', padding: '10px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-warn)', lineHeight: 1.6, wordBreak: 'break-word' };

  const toggleWallet = (wid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(wid)) { next.delete(wid); setAmounts(a => { const n = { ...a }; delete n[wid]; return n; }); }
      else next.add(wid);
      return next;
    });
  };

  const toggleAb = (id: string) => {
    setAbSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); setAbAmounts(a => { const n = { ...a }; delete n[id]; return n; }); }
      else next.add(id);
      return next;
    });
  };

  const updateExternal = (i: number, field: 'address' | 'amount', val: string) =>
    setExternals(prev => prev.map((e, idx) => (idx === i ? { ...e, [field]: val } : e)));

  const addExternal = () => setExternals(prev => [...prev, { address: '', amount: '' }]);

  const hasMonitor = sendRows.length > 0;

  // ── Envelope banner ─────────────────────────────────────────────────────────

  function EnvelopeBanner() {
    if (!isTauri) {
      return <div style={warnBox}>Browser preview — no signer, no Keychain, no envelope. Nothing can be sent from here.</div>;
    }
    if (envelopeLoading) {
      return <div style={{ ...warnBox, color: 'var(--wr-text-3)', borderColor: 'var(--wr-border)', backgroundColor: 'transparent' }}>Reading spend envelope…</div>;
    }
    if (envelopeError) {
      return <div style={noteBox}>Spend envelope unreadable: {envelopeError}</div>;
    }
    if (!envelope) {
      return <div style={noteBox}>No active spend envelope. Westron will not sign a transfer without one. Create an envelope whose scope contains the destination address.</div>;
    }
    let remaining = EM_DASH;
    try { remaining = ethFromWei(BigInt(envelope.hard_cap_wei) - BigInt(envelope.spent_wei)); } catch { remaining = EM_DASH; }
    // `per_tx_ceiling_wei` was added to EnvelopeStatus in the backend; the
    // shared `tauri.ts` interface has not caught up and is not this file's to
    // edit, so it is read through a narrowed local view.
    const ceilingWei = (envelope as EnvelopeStatus & { per_tx_ceiling_wei?: string }).per_tx_ceiling_wei;
    let ceiling = EM_DASH;
    try { if (ceilingWei) ceiling = ethFromWei(BigInt(ceilingWei)); } catch { ceiling = EM_DASH; }
    const expired = envelope.expires_at <= nowSec;
    const bad = envelope.kill_switch || expired || !envelope.active;
    return (
      <div style={bad ? noteBox : { ...warnBox, color: 'var(--wr-text-3)', borderColor: 'var(--wr-border)', backgroundColor: 'rgba(255,255,255,0.03)' }}>
        Spend envelope · {envelope.kill_switch ? 'KILL SWITCH ENGAGED' : expired ? 'EXPIRED' : 'active'}
        {' · '}remaining {remaining} of {(() => { try { return ethFromWei(BigInt(envelope.hard_cap_wei)); } catch { return EM_DASH; } })()}
        {' · '}expires {new Date(envelope.expires_at * 1000).toLocaleString()}
        <div style={{ marginTop: '4px' }}>
          Per-transaction ceiling {ceiling}. Every transfer is checked against all of these before the confirm button enables.
        </div>
      </div>
    );
  }

  function BlockerList() {
    if (blockers.length === 0) return null;
    return (
      <div style={{ ...noteBox, marginBottom: '10px' }}>
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Cannot send:</div>
        {blockers.map((b, i) => <div key={i} style={{ marginTop: '3px' }}>· {b}</div>)}
      </div>
    );
  }

  function WarningList() {
    if (warnings.length === 0) return null;
    return (
      <div style={{ ...warnBox, marginBottom: '10px' }}>
        {warnings.map((w, i) => <div key={i} style={{ marginTop: i ? '3px' : 0 }}>· {w}</div>)}
      </div>
    );
  }

  /** Full destination + exact amount. Used at review and at authorisation —
   *  the address is never truncated in either, because truncation is how
   *  people lose funds to look-alike addresses. */
  function DestinationCard({ d, amount, showCheckbox }: { d: Destination; amount: ReturnType<typeof parseAmountWei>; showCheckbox: boolean }) {
    const v = preview[d.key];
    return (
      <div style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', marginBottom: '8px' }}>
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>
          To · {d.label}
        </div>
        <div style={fullAddr}>{d.address || EM_DASH}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '10px', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Amount</span>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', fontWeight: 700, color: 'var(--wr-text)' }}>
            {'wei' in amount ? ethFromWei(amount.wei) : EM_DASH}
          </span>
        </div>
        {'wei' in amount && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px', wordBreak: 'break-all' }}>
            {amount.wei.toString()} wei
          </div>
        )}
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
          Gas: {gasLoading
            ? 'estimating…'
            : gasErrors[d.key]
              ? `estimate failed — ${gasErrors[d.key]}`
              : gasUnits[d.key] != null
                ? `${gasUnits[d.key].toLocaleString('en-US')} units (fee = units × base fee at broadcast; the fee in ETH is not known in advance)`
                : EM_DASH}
        </div>
        {previewLoading && !v && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', marginTop: '6px', color: 'var(--wr-text-3)' }}>
            Checking against the spend envelope…
          </div>
        )}
        {v && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', marginTop: '6px', color: v.authorized ? '#4fe9b4' : '#ff8a96', lineHeight: 1.6 }}>
            {v.authorized ? (
              <>
                Envelope allows this transfer — checked read-only, for this exact amount, consuming nothing.
                <div style={{ color: 'var(--wr-text-3)', marginTop: '3px' }}>
                  Per-transaction ceiling {v.per_tx_ceiling_wei ? ethFromWei(BigInt(v.per_tx_ceiling_wei)) : EM_DASH}
                  {' · '}remaining after this transfer{' '}
                  {v.remaining_wei ? ethFromWei(BigInt(v.remaining_wei) - BigInt(v.value_wei)) : EM_DASH}
                </div>
              </>
            ) : (
              <>
                Envelope refuses this transfer: {v.reject_reason ?? 'no reason given'}
                {rejectAction(v.reject_code) && <div style={{ marginTop: '3px' }}>{rejectAction(v.reject_code)}</div>}
                <div style={{ color: 'var(--wr-text-3)', marginTop: '3px' }}>
                  Code: {v.reject_code ?? EM_DASH}
                  {v.per_tx_ceiling_wei && <> · ceiling {ethFromWei(BigInt(v.per_tx_ceiling_wei))}</>}
                  {v.remaining_wei && <> · remaining {ethFromWei(BigInt(v.remaining_wei))}</>}
                </div>
                {v.reject_detail && (
                  <div style={{ color: 'var(--wr-text-3)', marginTop: '3px', wordBreak: 'break-word' }}>{v.reject_detail}</div>
                )}
              </>
            )}
          </div>
        )}
        {showCheckbox && (
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginTop: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={verified.has(d.key)}
              onChange={e => setVerified(prev => {
                const next = new Set(prev);
                if (e.target.checked) next.add(d.key); else next.delete(d.key);
                return next;
              })}
              style={{ width: '14px', height: '14px', accentColor: '#7c5cff', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }}
            />
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', lineHeight: 1.6 }}>
              I have read the full address above and the amount, and they are what I intend.
            </span>
          </label>
        )}
      </div>
    );
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget && phase !== 'sending') onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border-hover)', width: hasMonitor ? '860px' : '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'row', overflow: 'hidden', transition: 'width 0.2s ease' }}>
        {/* Left column */}
        <div style={{ width: '560px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: hasMonitor ? '1px solid var(--wr-border)' : 'none', maxHeight: '80vh', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--wr-border)' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text)' }}>
              Send ETH · Ethereum mainnet
            </span>
            <button
              onClick={() => { if (phase !== 'sending') onClose(); }}
              disabled={phase === 'sending'}
              style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: phase === 'sending' ? 'default' : 'pointer', fontSize: '20px', lineHeight: 1, padding: 0, opacity: phase === 'sending' ? 0.4 : 1 }}
            >×</button>
          </div>

          {/* Step 1 — compose */}
          {phase === 'compose' && (
            <>
              <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                <div style={{ marginBottom: '14px' }}><EnvelopeBanner /></div>

                {/* FROM */}
                <div style={{ marginBottom: '20px' }}>
                  <div style={labelSm}>From</div>
                  <div style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', backgroundColor: 'rgba(255,255,255,0.06)' }}>
                    <div style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>{walletName}</div>
                    <div style={{ ...fullAddr, fontSize: '11px', color: ADDR_RE.test(fromAddress) ? 'var(--wr-text-3)' : '#ff8a96', marginTop: '2px' }}>
                      {fromAddress || 'No address on file for this wallet'}
                    </div>
                  </div>
                </div>

                {/* TO — managed wallets */}
                <div>
                  <div style={labelSm}>To</div>
                  {managedWallets.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      {managedWallets.map(w => {
                        const isSel = selected.has(w.id);
                        return (
                          <div
                            key={w.id}
                            onClick={() => toggleWallet(w.id)}
                            style={{ border: `1px solid ${isSel ? '#7c5cff' : 'var(--wr-border)'}`, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: isSel ? 'rgba(190,255,0,0.04)' : 'transparent' }}
                          >
                            <div style={{ width: '16px', height: '16px', border: `2px solid ${isSel ? '#7c5cff' : 'var(--wr-border)'}`, backgroundColor: isSel ? '#7c5cff' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {isSel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{w.name}</div>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.address}</div>
                            </div>
                            <div
                              onClick={e => { e.stopPropagation(); if (!isSel) toggleWallet(w.id); }}
                              style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', backgroundColor: '#111', width: '90px', flexShrink: 0, cursor: 'text' }}
                            >
                              <span style={{ padding: '4px 5px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', flexShrink: 0 }}>
                                <EthIcon />
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={amounts[w.id] ?? ''}
                                onFocus={() => { if (!isSel) toggleWallet(w.id); }}
                                onChange={e => setAmounts(a => ({ ...a, [w.id]: e.target.value }))}
                                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '4px 5px', width: '100%', outline: 'none', minWidth: 0, cursor: 'text' }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Address Book entries */}
                  {addressBookEntries.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                      <div style={{ ...labelSm, marginBottom: '4px', letterSpacing: '1px' }}>Address Book</div>
                      {addressBookEntries.map((ab: AddressEntry) => {
                        const isSel = abSelected.has(ab.id);
                        return (
                          <div
                            key={ab.id}
                            onClick={() => toggleAb(ab.id)}
                            style={{ border: `1px solid ${isSel ? '#7c5cff' : 'var(--wr-border)'}`, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: isSel ? 'rgba(190,255,0,0.04)' : 'transparent' }}
                          >
                            <div style={{ width: '16px', height: '16px', border: `2px solid ${isSel ? '#7c5cff' : 'var(--wr-border)'}`, backgroundColor: isSel ? '#7c5cff' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {isSel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{ab.name}</span>
                                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#7c5cff', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                              </div>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.address}</div>
                            </div>
                            <div
                              onClick={e => { e.stopPropagation(); if (!isSel) toggleAb(ab.id); }}
                              style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', backgroundColor: '#111', width: '90px', flexShrink: 0, cursor: 'text' }}
                            >
                              <span style={{ padding: '4px 5px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', flexShrink: 0 }}>
                                <EthIcon />
                              </span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={abAmounts[ab.id] ?? ''}
                                onFocus={() => { if (!isSel) toggleAb(ab.id); }}
                                onChange={e => setAbAmounts(a => ({ ...a, [ab.id]: e.target.value }))}
                                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '4px 5px', width: '100%', outline: 'none', minWidth: 0, cursor: 'text' }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* External wallets */}
                  <div style={{ border: '1px solid var(--wr-border)', padding: '14px' }}>
                    <div style={{ ...labelSm, letterSpacing: '1px' }}>External Wallet</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {externals.map((ext, i) => (
                        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                          <input
                            type="text"
                            placeholder="0x… wallet address"
                            value={ext.address}
                            onChange={e => updateExternal(i, 'address', e.target.value)}
                            style={{ ...inputStyle, flex: 1, borderColor: ext.address && !ADDR_RE.test(ext.address.trim()) ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)' }}
                          />
                          <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', flexShrink: 0, width: '110px' }}>
                            <span style={{ padding: '0 7px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', alignSelf: 'stretch', justifyContent: 'center' }}>
                              <EthIcon />
                            </span>
                            <input
                              type="text"
                              inputMode="decimal"
                              placeholder="0.00"
                              value={ext.amount}
                              onChange={e => updateExternal(i, 'amount', e.target.value)}
                              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '8px 6px', width: '100%', outline: 'none', minWidth: 0 }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={addExternal}
                      style={{ marginTop: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#7c5cff', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    >
                      + Add another wallet
                    </button>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '8px', lineHeight: 1.6 }}>
                      One destination per transfer, by design — batch sending has not been approved for this screen. Each destination must also be inside the spend envelope&apos;s scope, and within its per-transaction ceiling.
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
                <button onClick={onClose} style={btnSecondary}>Cancel</button>
                <button
                  disabled={!composeReady}
                  onClick={() => { void enterReview(); }}
                  style={{ ...btnPrimary, opacity: composeReady ? 1 : 0.4, cursor: composeReady ? 'pointer' : 'default' }}
                >
                  Review →
                </button>
              </div>
            </>
          )}

          {/* Step 2 — review */}
          {phase === 'review' && (
            <>
              <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                <div style={labelSm}>Review</div>
                <BlockerList />
                <WarningList />
                <div style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', marginBottom: '10px', backgroundColor: 'rgba(255,255,255,0.05)' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>From</div>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{walletName}</div>
                  <div style={{ ...fullAddr, fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{fromAddress || EM_DASH}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
                    Balance: {balanceWei !== null ? ethFromWei(balanceWei) : balanceError ? `unavailable — ${balanceError}` : 'reading…'}
                  </div>
                </div>
                {parsed.map(({ d, amount }) => <DestinationCard key={d.key} d={d} amount={amount} showCheckbox={false} />)}
                <div style={{ marginTop: '10px' }}><EnvelopeBanner /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
                <button onClick={() => setPhase('compose')} style={btnSecondary}>← Back</button>
                <button
                  disabled={blockers.length > 0 || gasLoading || previewLoading}
                  onClick={() => { void enterAuthorise(); }}
                  style={{ ...btnPrimary, opacity: blockers.length > 0 || gasLoading || previewLoading ? 0.4 : 1, cursor: blockers.length > 0 || gasLoading || previewLoading ? 'default' : 'pointer' }}
                >
                  Continue to authorisation →
                </button>
              </div>
            </>
          )}

          {/* Step 3 — deliberate authorisation */}
          {phase === 'authorise' && (
            <>
              <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                <div style={labelSm}>Authorise a real transfer</div>
                <div style={{ ...warnBox, marginBottom: '10px' }}>
                  This signs and broadcasts a real transaction on Ethereum mainnet. Once it is broadcast it cannot be recalled. Check the full destination address character by character.
                </div>
                <BlockerList />
                {previewLoading && (
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '10px' }}>
                    Checking this transfer against the spend envelope (read-only — consumes none of the cap)…
                  </div>
                )}
                {previewError && (
                  <div style={{ ...noteBox, marginBottom: '10px' }}>
                    The spend envelope could not be checked: {previewError}. Nothing has been sent.
                  </div>
                )}
                {!previewLoading && !previewError && previewFailures.length > 0 && (
                  <div style={{ ...noteBox, marginBottom: '10px' }}>
                    The spend envelope refuses this transfer. Nothing has been sent.
                  </div>
                )}
                {parsed.map(({ d, amount }) => <DestinationCard key={d.key} d={d} amount={amount} showCheckbox={true} />)}
                <div style={{ marginTop: '10px' }}>
                  <div style={{ ...labelSm, marginBottom: '6px' }}>Type SEND to authorise</div>
                  <input
                    type="text"
                    value={typedConfirm}
                    onChange={e => setTypedConfirm(e.target.value)}
                    placeholder="SEND"
                    style={{ ...inputStyle, letterSpacing: '2px' }}
                  />
                </div>
                {confirmGate.length > 0 && (
                  <div style={{ ...warnBox, marginTop: '10px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>Before you can send:</div>
                    {confirmGate.map((m, i) => <div key={i} style={{ marginTop: '3px' }}>· {m}</div>)}
                  </div>
                )}
                {sendGuardMessage && (
                  <div style={{ ...noteBox, marginTop: '10px' }}>{sendGuardMessage}</div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
                <button onClick={() => { setPhase('review'); setTypedConfirm(''); setVerified(new Set()); setSendGuardMessage(null); }} style={btnSecondary}>← Back</button>
                <button
                  disabled={!canSend || sendStartedRef.current}
                  onClick={() => { void runSends(); }}
                  style={{ ...btnPrimary, backgroundColor: canSend ? '#ff8a96' : '#7c5cff', color: canSend ? '#000' : '#000', opacity: canSend ? 1 : 0.35, cursor: canSend ? 'pointer' : 'default' }}
                >
                  Sign &amp; broadcast
                </button>
              </div>
            </>
          )}

          {/* Steps 4/5 — sending + result summary */}
          {(phase === 'sending' || phase === 'done') && (
            <>
              <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
                <div style={labelSm}>{phase === 'sending' ? 'Broadcasting' : 'Result'}</div>
                {phase === 'sending' && (
                  <div style={{ ...warnBox, marginBottom: '10px' }}>
                    Signing and broadcasting. Do not close this window — if the app loses the response you will not know whether the transaction reached the network.
                  </div>
                )}
                {batchStopped && (
                  <div style={{ ...noteBox, marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>The send failed.</div>
                    <div style={{ wordBreak: 'break-word' }}>{batchStopped}</div>
                    {envelopeHint(batchStopped) && <div style={{ marginTop: '6px' }}>{envelopeHint(batchStopped)}</div>}
                    <div style={{ marginTop: '6px' }}>
                      If this was a network or timeout error rather than a rejection, the transaction may still have reached the network. Check this address on Etherscan before retrying, or you may send twice.
                    </div>
                    <div style={{ marginTop: '6px' }}>
                      The envelope counts an amount when it authorises it, which happens before signing — so a failure after authorisation may still have consumed part of the cap. The envelope figure below is re-read from the backend.
                    </div>
                  </div>
                )}
                {phase === 'done' && !batchStopped && (
                  <div style={{ ...warnBox, marginBottom: '10px', color: 'var(--wr-text-3)' }}>
                    Broadcast to the network. Westron does not read transaction receipts, so it cannot tell you the transaction was mined — follow the Etherscan link for that.
                  </div>
                )}
                <div style={{ marginTop: '10px' }}><EnvelopeBanner /></div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
                <button onClick={onClose} disabled={phase === 'sending'} style={{ ...btnSecondary, opacity: phase === 'sending' ? 0.4 : 1 }}>Close</button>
              </div>
            </>
          )}
        </div>{/* end left column */}

        {/* Right column — Monitor */}
        {hasMonitor && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0b0c14', maxHeight: '80vh' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Monitor</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                {sendRows.filter(t => t.state === 'broadcast').length}/{sendRows.length} broadcast
              </span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {sendRows.map(tx => {
                const statusColor =
                  tx.state === 'broadcast' ? '#4fe9b4'
                  : tx.state === 'failed' ? '#ff8a96'
                  : tx.state === 'submitting' ? '#7c5cff'
                  : '#9298b8';
                const statusLabel =
                  tx.state === 'broadcast' ? 'Broadcast — pending on-chain'
                  : tx.state === 'failed' ? 'Failed'
                  : tx.state === 'submitting' ? 'Signing & broadcasting…'
                  : tx.state === 'skipped' ? 'Not sent (stopped after failure)'
                  : 'Queued';
                return (
                  <div key={tx.key} style={{ border: '1px solid var(--wr-border)', padding: '10px 12px', backgroundColor: 'var(--wr-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: statusColor, flexShrink: 0, boxShadow: tx.state === 'submitting' ? `0 0 6px ${statusColor}` : 'none' }} />
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)', flexShrink: 0 }}>{ethFromWei(tx.valueWei)}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', wordBreak: 'break-all', paddingLeft: '15px', marginBottom: '4px' }}>{tx.address}</div>
                    <div style={{ paddingLeft: '15px' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: statusColor, letterSpacing: '0.5px' }}>{statusLabel}</span>
                      {tx.hash && (
                        <div style={{ marginTop: '4px' }}>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', wordBreak: 'break-all' }}>{tx.hash}</div>
                          <a
                            href={`https://etherscan.io/tx/${tx.hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#5b7cfa', display: 'inline-flex', alignItems: 'center', gap: '3px', textDecoration: 'none', marginTop: '2px' }}
                          >
                            View on Etherscan <ExternalLinkIcon />
                          </a>
                        </div>
                      )}
                      {tx.error && (
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '4px', wordBreak: 'break-word', lineHeight: 1.6 }}>{tx.error}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--wr-border)' }}>
              <button onClick={onClose} disabled={phase === 'sending'} style={{ ...btnSecondary, opacity: phase === 'sending' ? 0.4 : 1 }}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddressBookTab() {
  const [entries, setEntries] = useState<AddressEntry[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setEntries(loadAddressBook()); }, []);

  const isValidAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

  function handleAdd() {
    if (!nameInput.trim() || !isValidAddress(addressInput)) return;
    const entry: AddressEntry = {
      id: String(Date.now()),
      name: nameInput.trim(),
      address: addressInput.trim().toLowerCase() as `0x${string}`,
      note: noteInput.trim() || undefined,
      createdAt: Date.now(),
    };
    saveAddressEntry(entry);
    setEntries(loadAddressBook());
    setNameInput(''); setAddressInput(''); setNoteInput('');
  }

  function handleDelete(id: string) {
    deleteAddressEntry(id);
    setEntries(loadAddressBook());
  }

  function handleSaveEdit(id: string) {
    updateAddressEntry(id, { name: editName.trim(), note: editNote.trim() || undefined });
    setEntries(loadAddressBook());
    setEditingId(null);
  }

  function handleCopy(address: string) {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(address);
    setTimeout(() => setCopied(null), 1500);
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)',
    padding: '8px 12px', outline: 'none', width: '100%',
  };

  return (
    <div>
      {/* Add form */}
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px', marginBottom: '20px' }}>
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px' }}>Add Address</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.5fr auto', gap: '8px', alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Name</div>
            <input
              style={inputStyle} placeholder="Vitalik" value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Wallet Address</div>
            <input
              style={{ ...inputStyle, borderColor: addressInput && !isValidAddress(addressInput) ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)' }}
              placeholder="0x..." value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Note (optional)</div>
            <input
              style={inputStyle} placeholder="e.g. team treasury" value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!nameInput.trim() || !isValidAddress(addressInput)}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 18px', border: 'none', cursor: nameInput.trim() && isValidAddress(addressInput) ? 'pointer' : 'default', backgroundColor: nameInput.trim() && isValidAddress(addressInput) ? '#7c5cff' : 'rgba(255,255,255,0.06)', color: nameInput.trim() && isValidAddress(addressInput) ? '#000' : 'var(--wr-text-3)', whiteSpace: 'nowrap' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
          No addresses saved yet. Add one above.
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px 120px', alignItems: 'center', padding: '0 20px', height: '38px', borderBottom: '1px solid var(--wr-border)', columnGap: '16px' }}>
            {(['NAME', 'ADDRESS', 'NOTE', ''] as const).map(h => (
              <div key={h} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>{h}</div>
            ))}
          </div>
          {entries.map(entry => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px 120px', alignItems: 'center', padding: '0 20px', minHeight: '54px', borderBottom: '1px solid var(--wr-border)', columnGap: '16px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
            >
              {/* Name */}
              <div>
                {editingId === entry.id ? (
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(entry.id); if (e.key === 'Escape') setEditingId(null); }}
                    style={{ ...inputStyle, padding: '4px 8px', width: '100%' }}
                  />
                ) : (
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{entry.name}</div>
                )}
              </div>
              {/* Address */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#9298b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.address.slice(0, 10)}…{entry.address.slice(-8)}
                </span>
                <button
                  onClick={() => handleCopy(entry.address)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: copied === entry.address ? '#7c5cff' : 'var(--wr-text-3)', flexShrink: 0 }}
                  title="Copy address"
                >
                  {copied === entry.address ? (
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7L5 10L11 3" stroke="#7c5cff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M1 4v8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  )}
                </button>
                <a href={`https://etherscan.io/address/${entry.address}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--wr-text-3)', flexShrink: 0, display: 'flex' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3m0 0v3M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              </div>
              {/* Note */}
              <div>
                {editingId === entry.id ? (
                  <input
                    value={editNote} onChange={e => setEditNote(e.target.value)}
                    placeholder="note"
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(entry.id); if (e.key === 'Escape') setEditingId(null); }}
                    style={{ ...inputStyle, padding: '4px 8px', width: '100%' }}
                  />
                ) : (
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{entry.note ?? '—'}</span>
                )}
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                {editingId === entry.id ? (
                  <>
                    <button onClick={() => handleSaveEdit(entry.id)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: '#000', backgroundColor: '#7c5cff', border: 'none', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingId(entry.id); setEditName(entry.name); setEditNote(entry.note ?? ''); }}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', background: 'none', border: '1px solid var(--wr-border)', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}
                    >Edit</button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', background: 'none', border: '1px solid rgba(248,113,113,0.3)', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}
                    >Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── NFT Action Modals ─────────────────────────────────────────────────────────

const MODAL_BACKDROP: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
  backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center',
  justifyContent: 'center', zIndex: 1000,
};
const MODAL_BOX: React.CSSProperties = {
  backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border-hover)',
  width: '480px', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
const MODAL_HDR: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 20px', borderBottom: '1px solid var(--wr-border-hover)',
};
const MODAL_TITLE: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
  letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text)',
};
const LABEL_SM: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
  letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)',
};
const INPUT_SM: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
  color: 'var(--wr-text)', backgroundColor: 'rgba(255,255,255,0.06)',
  border: '1px solid var(--wr-border-hover)', outline: 'none',
  padding: '7px 10px', width: '100%',
};
const BTN_LIME: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
  letterSpacing: '1px', textTransform: 'uppercase', padding: '9px 20px',
  border: 'none', cursor: 'pointer', backgroundColor: '#7c5cff', color: '#000',
};
const BTN_GHOST: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500,
  letterSpacing: '1px', textTransform: 'uppercase', padding: '9px 20px',
  border: '1px solid var(--wr-border-hover)', cursor: 'pointer',
  backgroundColor: 'transparent', color: 'var(--wr-text)',
};

const UNWIRED_NOTE: React.CSSProperties = {
  padding: '10px 14px', backgroundColor: 'rgba(251,191,36,0.06)',
  border: '1px solid rgba(251,191,36,0.25)', fontFamily: 'var(--font-jetbrains)',
  fontSize: '10px', color: 'var(--wr-warn)', lineHeight: 1.6,
};

/** Shown wherever a button used to fake a successful on-chain action with a
 *  setTimeout. These flows are not wired to a signer, and the screen now says
 *  so instead of reporting a success that never happened. Wiring any of them
 *  moves real assets and needs the owner's sign-off, exactly as the ETH
 *  transfer did. */
function UnwiredNotice({ what }: { what: string }) {
  return (
    <div style={UNWIRED_NOTE}>
      {what} is not wired to a signer yet, so Westron will not pretend to have done it.
      Nothing has been submitted and no order or transfer exists.
    </div>
  );
}

function NftEditListingModal({ nfts, onClose }: { nfts: OwnedNft[]; onClose: () => void }) {
  const [prices, setPrices] = React.useState<Record<string, string>>({});
  const [marketplace, setMarketplace] = React.useState<'opensea' | 'blur'>('opensea');
  const [expiry, setExpiry] = React.useState('7');
  const nftKey = (n: OwnedNft) => n.contract.address + n.token_id;

  return (
    <div style={MODAL_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL_BOX}>
        <div style={MODAL_HDR}>
          <span style={MODAL_TITLE}>Edit Listing · {nfts.length} item{nfts.length !== 1 ? 's' : ''}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nfts.map(n => {
            const k = nftKey(n);
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--wr-border)' }}>
                <NftThumb nft={n} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.name ?? `#${n.token_id}`}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{n.contract.opensea_collection_name || n.contract.name || n.contract.address.slice(0, 8)}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <input
                    type="text" inputMode="decimal" placeholder="0.00"
                    value={prices[k] ?? ''}
                    onChange={e => setPrices(prev => ({ ...prev, [k]: e.target.value }))}
                    style={{ ...INPUT_SM, width: '88px', textAlign: 'right' }}
                  />
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>ETH</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ padding: '0 20px 12px' }}>
          <UnwiredNotice what="Creating or updating a listing" />
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--wr-border)', display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ ...LABEL_SM, marginBottom: '6px' }}>Marketplace</div>
            <select value={marketplace} onChange={e => setMarketplace(e.target.value as typeof marketplace)}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid var(--wr-border-hover)', padding: '7px 10px', width: '100%', cursor: 'pointer', outline: 'none' }}>
              <option value="opensea">OpenSea</option>
              <option value="blur">Blur</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ ...LABEL_SM, marginBottom: '6px' }}>Expires in</div>
            <select value={expiry} onChange={e => setExpiry(e.target.value)}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid var(--wr-border-hover)', padding: '7px 10px', width: '100%', cursor: 'pointer', outline: 'none' }}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
            </select>
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onClose} style={BTN_GHOST}>Close</button>
          <button disabled style={{ ...BTN_LIME, opacity: 0.35, cursor: 'default' }}>
            Listing unavailable
          </button>
        </div>
      </div>
    </div>
  );
}

function NftCancelListingModal({ nfts, onClose }: { nfts: OwnedNft[]; onClose: () => void }) {

  return (
    <div style={MODAL_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL_BOX}>
        <div style={MODAL_HDR}>
          <span style={MODAL_TITLE}>Cancel Listing · {nfts.length} item{nfts.length !== 1 ? 's' : ''}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '4px' }}>
            The following listings will be cancelled on all connected marketplaces:
          </p>
          {nfts.map(n => {
            const k = n.contract.address + n.token_id;
            const floor = n.contract.opensea_floor_price;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', backgroundColor: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.2)' }}>
                <NftThumb nft={n} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{n.name ?? `#${n.token_id}`}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{n.contract.opensea_collection_name || n.contract.name || n.contract.address.slice(0, 8)}</div>
                </div>
                {floor && <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flexShrink: 0 }}>Floor: {floor} ETH</span>}
              </div>
            );
          })}
          <div style={{ marginTop: '8px' }}>
            <UnwiredNotice what="Cancelling a listing" />
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onClose} style={BTN_GHOST}>Close</button>
          <button disabled style={{ ...BTN_LIME, backgroundColor: '#ff8a96', color: '#fff', opacity: 0.35, cursor: 'default' }}>
            Cancelling unavailable
          </button>
        </div>
      </div>
    </div>
  );
}

function NftAcceptOfferModal({ nfts, onClose }: { nfts: OwnedNft[]; onClose: () => void }) {
  // There is no command that returns offers for a token, so there is no offer
  // to show. This used to display floor × 0.94 as if it were a real bid.
  const offers = nfts.map(n => ({ nft: n, offer: EM_DASH }));

  return (
    <div style={MODAL_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL_BOX}>
        <div style={MODAL_HDR}>
          <span style={MODAL_TITLE}>Accept Offer · {nfts.length} item{nfts.length !== 1 ? 's' : ''}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {offers.map(({ nft: n, offer }) => {
            const k = n.contract.address + n.token_id;
            const floor = n.contract.opensea_floor_price;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--wr-border)' }}>
                <NftThumb nft={n} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{n.name ?? `#${n.token_id}`}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{n.contract.opensea_collection_name || n.contract.name || n.contract.address.slice(0, 8)}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#4fe9b4' }}>{offer} <span style={{ color: 'var(--wr-text-3)', fontWeight: 400 }}>ETH</span></div>
                  {floor && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>Floor: {floor} ETH</div>}
                </div>
              </div>
            );
          })}
          <div style={{ padding: '8px 14px', display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
            <span>Estimated gas</span><span>{EM_DASH}</span>
          </div>
          <UnwiredNotice what="Accepting an offer" />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onClose} style={BTN_GHOST}>Close</button>
          <button disabled style={{ ...BTN_LIME, opacity: 0.35, cursor: 'default' }}>
            No offers available
          </button>
        </div>
      </div>
    </div>
  );
}

function NftSendModal({ nfts, walletAddress, onClose }: { nfts: OwnedNft[]; walletAddress: string; onClose: () => void }) {
  const [toAddress, setToAddress] = React.useState('');
  const isValid = ADDR_RE.test(toAddress.trim());

  return (
    <div style={MODAL_BACKDROP} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={MODAL_BOX}>
        <div style={MODAL_HDR}>
          <span style={MODAL_TITLE}>Send NFT{nfts.length !== 1 ? 's' : ''} · {nfts.length} item{nfts.length !== 1 ? 's' : ''}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', flex: 1 }}>
          <div style={{ ...LABEL_SM, marginBottom: '2px' }}>Sending</div>
          {nfts.map(n => {
            const k = n.contract.address + n.token_id;
            return (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--wr-border)' }}>
                <NftThumb nft={n} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{n.name ?? `#${n.token_id}`}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.contract.address}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', border: '1px solid var(--wr-border)', padding: '2px 6px', flexShrink: 0 }}>
                  {n.contract.token_type ?? 'ERC-721'}
                </span>
              </div>
            );
          })}
          <div style={{ marginTop: '8px' }}>
            <div style={{ ...LABEL_SM, marginBottom: '6px' }}>From</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '9px 10px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--wr-border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {walletAddress || '0x…'}
            </div>
          </div>
          <div>
            <div style={{ ...LABEL_SM, marginBottom: '6px' }}>To Address</div>
            <input
              type="text" placeholder="0x…"
              value={toAddress} onChange={e => setToAddress(e.target.value)}
              style={{ ...INPUT_SM, borderColor: toAddress && !isValid ? 'rgba(248,113,113,0.6)' : 'var(--wr-border-hover)' }}
            />
            {toAddress && !isValid && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '4px' }}>Invalid Ethereum address</div>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', padding: '4px 0' }}>
            <span>Estimated gas</span><span>{EM_DASH}</span>
          </div>
          <UnwiredNotice what="Sending an NFT" />
        </div>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
          <button onClick={onClose} style={BTN_GHOST}>Close</button>
          <button disabled style={{ ...BTN_LIME, opacity: 0.35, cursor: 'default' }}>
            Sending unavailable
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Live data helpers ─────────────────────────────────────────────────────────

function mapTransfer(t: AssetTransfer, walletAddress: string) {
  const isOut = t.from.toLowerCase() === walletAddress.toLowerCase();
  const typeMap: Record<string, TxType> = { external: isOut ? 'Send' : 'Receive', erc20: 'Swap', erc721: 'NFT', erc1155: 'NFT' };
  const type = typeMap[t.category] ?? 'Receive';
  // The Rust `AssetTransferMetadata` serialises as `blockTimestamp` (camelCase),
  // while the shared `tauri.ts` type declares `block_timestamp`. Reading only
  // the snake_case name leaves this column permanently '—'. Both are accepted
  // here; the shared type is not this file's to change.
  const meta = t.metadata as { block_timestamp?: string; blockTimestamp?: string } | undefined;
  const blockTimestamp = meta?.block_timestamp ?? meta?.blockTimestamp;
  let age = '—';
  if (blockTimestamp) {
    const s = Math.floor((Date.now() - new Date(blockTimestamp).getTime()) / 1000);
    if (s < 3600) age = `${Math.floor(s / 60)}m ago`;
    else if (s < 86400) age = `${Math.floor(s / 3600)}h ago`;
    else age = `${Math.floor(s / 86400)}d ago`;
  }
  return {
    hash: t.hash,
    type,
    block: String(parseInt(t.block_num, 16)),
    age,
    from: t.from,
    to: t.to ?? '—',
    token: t.asset ?? (t.category === 'erc721' || t.category === 'erc1155' ? 'NFT' : 'ETH'),
    amount: t.value !== undefined ? `${t.value} ${t.asset ?? 'ETH'}` : '—',
    gas: '—',
  };
}

export default function WalletDetailClient({ id: routeId }: { id: string }) {
  // Static export serves one prerendered /wallet/detail page; the real wallet
  // id arrives as ?id=… and is read on the client after mount. Until then the
  // route id ('detail') matches no wallet on either server or client, so the
  // first render is hydration-stable.
  const [id, setId] = useState(routeId);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('id');
    if (q && q !== id) setId(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [tab, setTab] = useState<Tab>('Holdings');
  const [selectedNfts, setSelectedNfts] = useState<Set<string>>(new Set());
  const [nftSort, setNftSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'RECEIVED', dir: 'desc' });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenSort, setTokenSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'HELD VALUE', dir: 'desc' });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDistribute, setShowDistribute] = useState(false);
  const [showNftEditModal, setShowNftEditModal] = useState(false);
  const [showNftCancelModal, setShowNftCancelModal] = useState(false);
  const [showNftAcceptModal, setShowNftAcceptModal] = useState(false);
  const [showNftSendModal, setShowNftSendModal] = useState(false);
  const [alchemyKey, setAlchemyKey] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [etherscanOpenError, setEtherscanOpenError] = useState<string | null>(null);

  async function openInBrowser(url: string) {
    setEtherscanOpenError(null);
    const res = await settle(() => openExternalUrl(url));
    if (!res.ok) setEtherscanOpenError(`Could not open the default browser: ${res.error}`);
  }

  // ── Wallet identity ─────────────────────────────────────────────────────────
  // Resolved on the client from the wallet store only. There is no placeholder
  // wallet to fall back to: an id that matches nothing renders as "not found"
  // rather than quietly showing some other wallet's data.
  const [wallet, setWallet] = useState<ResolvedWallet | null>(null);
  const [walletResolved, setWalletResolved] = useState(false);
  useEffect(() => {
    const found = loadWallets().find((w: { id: string }) => w.id === id);
    setWallet(found ? { id: found.id, name: found.name, address: found.address } : null);
    setWalletResolved(true);
  }, [id]);
  const walletAddr = wallet?.address ?? '';

  // ── Live data ───────────────────────────────────────────────────────────────
  const [isTauri, setIsTauri] = useState(false);
  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [liveNfts, setLiveNfts] = useState<OwnedNft[] | null>(null);
  const [nftCount, setNftCount] = useState<number | null>(null);
  const [nftsError, setNftsError] = useState<string | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(true);

  // Transactions tab — fetched once, lazily, the first time the tab is opened.
  const [liveTxs, setLiveTxs] = useState<ReturnType<typeof mapTransfer>[] | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txRequested, setTxRequested] = useState(false);

  // Analytics tab — same lazy rule.
  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [nftPnl, setNftPnl] = useState<NftPnlSummary | null>(null);
  const [nftPnlError, setNftPnlError] = useState<string | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsRequested, setAnalyticsRequested] = useState(false);

  useEffect(() => {
    setIsTauri(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);
  }, []);

  // Holdings: two commands, in series. `get_wallet_portfolio` is one Alchemy
  // Portfolio call that returns native + ERC-20 balances with USD prices;
  // `get_nfts_for_owner` is one more. Deliberately not `get_portfolio_snapshot`,
  // which fans out to four Alchemy calls internally and would double the quota
  // cost of opening this screen on a free-tier key.
  useEffect(() => {
    if (!walletResolved) return;
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const address = wallet?.address ?? '';

    if (!inTauri || !address) {
      setLiveNfts(EMPTY_NFTS_RESPONSE.owned_nfts);
      setNftCount(null);
      setLiveTxs(EMPTY_TRANSFERS.map(t => mapTransfer(t, address)));
      setHoldingsLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setHoldingsLoading(true);
      const keyRes = await settle(() => loadAlchemyKey());
      if (cancelled) return;
      const apiKey = keyRes.ok ? keyRes.value : '';
      setAlchemyKey(apiKey);
      if (!apiKey) {
        setKeyError(keyRes.ok
          ? 'No Alchemy API key stored. Add one in Settings — every figure on this screen comes from Alchemy.'
          : `Alchemy API key could not be read: ${keyRes.error}`);
        setHoldingsLoading(false);
        return;
      }
      setKeyError(null);

      const pf = await settle(() => getWalletPortfolio(address, apiKey));
      if (cancelled) return;
      if (pf.ok) { setPortfolio(pf.value); setPortfolioError(null); }
      else { setPortfolio(null); setPortfolioError(pf.error); }

      const nf = await settle(() => getNftsForOwner(address, apiKey));
      if (cancelled) return;
      if (nf.ok) { setLiveNfts(nf.value.owned_nfts); setNftCount(nf.value.total_count); setNftsError(null); }
      else { setLiveNfts(null); setNftCount(null); setNftsError(nf.error); }

      setHoldingsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [walletResolved, wallet?.address]);

  // Lazy: transactions.
  const loadTransactions = useCallback(async () => {
    if (!isTauri || !alchemyKey || !walletAddr) return;
    setTxLoading(true);
    const res = await settle(() => getAssetTransfers(walletAddr, alchemyKey));
    if (res.ok) { setLiveTxs(res.value.map(t => mapTransfer(t, walletAddr))); setTxError(null); }
    else { setLiveTxs(null); setTxError(res.error); }
    setTxLoading(false);
  }, [isTauri, alchemyKey, walletAddr]);

  useEffect(() => {
    if (tab !== 'Transactions' || txRequested || !isTauri || !alchemyKey || !walletAddr) return;
    setTxRequested(true);
    void loadTransactions();
  }, [tab, txRequested, isTauri, alchemyKey, walletAddr, loadTransactions]);

  // Lazy: analytics (locally-stored trade history + NFT cost basis vs floors).
  useEffect(() => {
    if (tab !== 'Analytics' || analyticsRequested || !isTauri || !alchemyKey || !walletAddr) return;
    setAnalyticsRequested(true);
    let cancelled = false;
    (async () => {
      setAnalyticsLoading(true);
      const p = await settle(() => getPnlSummary(walletAddr, alchemyKey));
      if (cancelled) return;
      if (p.ok) { setPnl(p.value); setPnlError(null); } else { setPnl(null); setPnlError(p.error); }

      const n = await settle(() => getNftPnl(walletAddr, alchemyKey));
      if (cancelled) return;
      if (n.ok) { setNftPnl(n.value); setNftPnlError(null); } else { setNftPnl(null); setNftPnlError(n.error); }
      setAnalyticsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [tab, analyticsRequested, isTauri, alchemyKey, walletAddr]);

  // ── Derived display values — real or '—', never a stand-in ──────────────────

  const dataBlocked = !isTauri
    ? 'Live data requires the Westron desktop app.'
    : !walletAddr
      ? 'No wallet address to query.'
      : keyError;

  const displayTotalValue = portfolio ? fmtUsd(portfolio.totalUsd) : EM_DASH;
  const displayNftCount = nftCount != null ? String(nftCount) : EM_DASH;
  const heldTokens = (portfolio?.tokens ?? []).filter(t => (t.balance ?? 0) > 0);
  const displayTokenCount = portfolio ? String(heldTokens.length) : EM_DASH;
  const displayEthBalance = portfolio ? fmtEth(portfolio.ethBalance) : EM_DASH;
  const displayUnrealized = nftPnl ? fmtEth(nftPnl.unrealized_eth) : EM_DASH;

  const displayTxs = liveTxs ?? [];

  // Token rows. Balance, symbol, price and USD value are real (Alchemy
  // Portfolio API). FDV, 1D/7D change and volume are not in that response, so
  // they stay '—' rather than being derived from something they are not.
  const tokens = heldTokens.map((t: WalletToken) => ({
    key: t.tokenAddress ?? t.symbol ?? t.address,
    name: t.name ?? t.symbol ?? 'Unknown token',
    ticker: t.symbol ?? EM_DASH,
    color: '#627eea',
    verified: false,
    walletCount: 1,
    heldValue: fmtUsd(t.usdValue),
    heldQty: t.balance != null ? t.balance.toLocaleString('en-US', { maximumFractionDigits: 6 }) : EM_DASH,
    price: fmtUsd(t.usdPrice),
    fdv: EM_DASH,
    change1d: EM_DASH,
    change7d: EM_DASH,
    vol1d: EM_DASH,
  }));

  // Top collections by current floor value, summed from the NFT P&L items
  // (locally-stored cost basis + live floors). No floor, no row.
  const topCols = (() => {
    if (!nftPnl) return [] as Array<{ name: string; eth: string; pct: number }>;
    const byCollection = new Map<string, number>();
    for (const item of nftPnl.items) {
      if (item.floor_eth == null) continue;
      const name = item.collection || item.contract;
      byCollection.set(name, (byCollection.get(name) ?? 0) + item.floor_eth);
    }
    const total = Array.from(byCollection.values()).reduce((s, v) => s + v, 0);
    return Array.from(byCollection.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, eth]) => ({ name, eth: `${eth.toFixed(3)} ETH`, pct: total > 0 ? Math.round((eth / total) * 100) : 0 }));
  })();

  // Best / worst held NFT by unrealized P&L against the stored cost basis.
  const rankedNftPnl = (nftPnl?.items ?? [])
    .filter(i => i.unrealized_eth != null)
    .sort((a, b) => (b.unrealized_eth ?? 0) - (a.unrealized_eth ?? 0));
  const bestNft = rankedNftPnl[0];
  const worstNft = rankedNftPnl.length > 1 ? rankedNftPnl[rankedNftPnl.length - 1] : undefined;

  const selectedTokenSymbol = selectedToken;

  return (
    <main className="min-h-full bg-[#0b0c14] text-white px-12 py-8">

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Dashboard</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>{wallet?.name ?? (walletResolved ? 'Unknown wallet' : '…')}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 700, color: 'var(--wr-text)' }}>
              {wallet?.name ?? (walletResolved ? 'Wallet not found' : 'Loading…')}
            </h1>
            <Tag variant={WALLET_TOKEN_VARIANT[CHAIN_BADGE] ?? 'neutral'}>{CHAIN_BADGE}</Tag>
          </div>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', wordBreak: 'break-all' }}>
            {wallet?.address ?? (walletResolved ? `No wallet with id "${id}" in local storage.` : EM_DASH)}
          </p>
          {walletResolved && wallet && (
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '4px' }}>
              ETH balance: {holdingsLoading ? 'loading…' : displayEthBalance}
            </p>
          )}
        </div>
        {wallet && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setShowDistribute(true)}
                style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#0b0c14',
                  border: 'none', padding: '7px 14px', backgroundColor: '#7c5cff',
                  display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                }}
                className="hover:opacity-90 transition-opacity"
              >
                Distribute
              </button>
              <button
                type="button"
                onClick={() => { void openInBrowser(`https://etherscan.io/address/${wallet.address}`); }}
                style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)',
                  border: '1px solid var(--wr-border)', padding: '6px 12px', backgroundColor: 'transparent',
                  display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer',
                }}
                className="hover:text-[#9298b8] hover:border-[var(--wr-border-hover)] transition-colors"
              >
                Etherscan <ExternalLinkIcon />
              </button>
            </div>
            {etherscanOpenError && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', maxWidth: '260px', textAlign: 'right' }}>
                {etherscanOpenError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Why a panel is empty, stated once, at the top. */}
      {dataBlocked && (
        <div style={{ border: '1px solid rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)', padding: '10px 14px', marginBottom: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-warn)', lineHeight: 1.6 }}>
          {dataBlocked}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-[var(--wr-border)] mb-6">
        {(['Holdings', 'Transactions', 'Analytics', 'Address Book'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500,
              padding: '10px 18px',
              color: tab === t ? 'var(--wr-accent)' : 'var(--wr-text-3)',
              background: 'none',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: tab === t ? 'var(--wr-accent)' : 'transparent',
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── HOLDINGS TAB ── */}
      {tab === 'Holdings' && (
        <>
          {/* Stat cards — value or '—', plus a line saying where the number
              comes from or what is missing. Nothing here is a placeholder. */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[
              {
                label: 'Total Value',
                value: holdingsLoading ? EM_DASH : displayTotalValue,
                color: 'var(--wr-text)',
                sub: holdingsLoading ? 'Fetching…'
                  : portfolioError ? `Unavailable — ${portfolioError}`
                  : portfolio ? 'ETH + ERC-20 at Alchemy prices; NFT floor value not included'
                  : 'No data yet',
              },
              {
                label: 'Total NFTs',
                value: holdingsLoading ? EM_DASH : displayNftCount,
                color: 'var(--wr-text)',
                sub: holdingsLoading ? 'Fetching…' : nftsError ? `Unavailable — ${nftsError}` : nftCount != null ? 'owned, from Alchemy NFT API' : 'No data yet',
              },
              {
                label: 'Total Tokens',
                value: holdingsLoading ? EM_DASH : displayTokenCount,
                color: 'var(--wr-text)',
                sub: holdingsLoading ? 'Fetching…' : portfolioError ? `Unavailable — ${portfolioError}` : portfolio ? 'with a non-zero balance' : 'No data yet',
              },
              {
                label: 'Unrealized PnL',
                value: displayUnrealized,
                color: nftPnl ? (nftPnl.unrealized_eth >= 0 ? '#4fe9b4' : '#ff8a96') : 'var(--wr-text-3)',
                sub: nftPnl
                  ? `NFTs only — ${nftPnl.priced_count}/${nftPnl.held_count} held items have a recorded cost basis`
                  : nftPnlError ? `Unavailable — ${nftPnlError}` : 'Computed on the Analytics tab (needs stored cost basis)',
              },
            ].map(card => (
              <div key={card.label} style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                  {card.label}
                </p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700, color: card.color }}>
                  {card.value}
                </p>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.5, wordBreak: 'break-word' }}>
                  {card.sub}
                </p>
              </div>
            ))}
          </div>

          {/* NFT Holdings */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                  NFT Holdings
                </h2>
                {selectedNfts.size > 0 && (
                  <>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#7c5cff', letterSpacing: '1px' }}>
                      {selectedNfts.size} selected
                    </span>
                    <button
                      onClick={() => setSelectedNfts(new Set())}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '3px' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                    >
                      ✕ Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 88px 130px 90px 120px 140px 120px 80px', alignItems: 'center', padding: '0 16px', height: '40px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedNfts.size === (liveNfts?.length ?? 0) && (liveNfts?.length ?? 0) > 0}
                    onChange={e => setSelectedNfts(e.target.checked ? new Set((liveNfts ?? []).map(n => n.contract.address + n.token_id)) : new Set())}
                    style={{ width: '14px', height: '14px', accentColor: '#7c5cff', cursor: 'pointer' }}
                  />
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {liveNfts?.length ?? 0} Items
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>Wallet</div>
                {(['LISTING PRICE', 'RARITY', 'FLOOR PRICE', 'TOP OFFER', 'COST', 'RECEIVED'] as const).map(col => (
                  <button
                    key={col}
                    onClick={() => setNftSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: nftSort.col === col ? 'var(--wr-text)' : 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', padding: 0 }}
                  >
                    {col}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: nftSort.col === col ? 1 : 0.4 }}>
                      <path d="M5 2L7 4H3L5 2Z" fill="currentColor"/>
                      <path d="M5 8L3 6H7L5 8Z" fill="currentColor"/>
                    </svg>
                  </button>
                ))}
              </div>
              {/* NFT rows — loading / error / empty are all distinct states */}
              {holdingsLoading && <StateNote title="Loading NFTs…" />}
              {!holdingsLoading && nftsError && (
                <StateNote tone="error" title="NFTs could not be loaded" detail={nftsError} />
              )}
              {!holdingsLoading && !nftsError && (liveNfts?.length ?? 0) === 0 && (
                <StateNote
                  title="No NFTs held"
                  detail={isTauri ? 'Alchemy returned no owned NFTs for this address.' : 'Live NFT data needs the Westron desktop app.'}
                />
              )}
              {!holdingsLoading && !nftsError && (liveNfts ?? []).map(nft => {
                const key = nft.contract.address + nft.token_id;
                const isSelected = selectedNfts.has(key);
                const thumb = nft.image?.thumbnail_url || nft.image?.original_url || nft.image?.cached_url;
                const collectionName = nft.contract.opensea_collection_name || nft.contract.name || nft.contract.address.slice(0, 8);
                const floorPrice = nft.contract.opensea_floor_price;
                return (
                  <div
                    key={key}
                    style={{ display: 'grid', gridTemplateColumns: '40px 1fr 88px 130px 90px 120px 140px 120px 80px', alignItems: 'center', padding: '0 16px', height: '56px', borderBottom: '1px solid var(--wr-border)', backgroundColor: isSelected ? 'rgba(190,255,0,0.04)' : 'transparent', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSelected ? 'rgba(190,255,0,0.04)' : 'transparent'; }}
                  >
                    {/* Checkbox */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => setSelectedNfts(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(key) : next.delete(key);
                          return next;
                        })}
                        style={{ width: '14px', height: '14px', accentColor: '#7c5cff', cursor: 'pointer' }}
                      />
                    </div>
                    {/* NFT identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: '36px', height: '36px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', backgroundColor: '#14161f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumb
                          ? <img src={thumb} alt={nft.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                          : <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#555' }}>{(nft.name ?? '?')[0]}</span>
                        }
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nft.name ?? `#${nft.token_id}`}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>{collectionName}</span>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                            <circle cx="7" cy="7" r="7" fill="#5b7cfa"/>
                            <path d="M4 7L6 9L10 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    {/* Wallet */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: '#627eea', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#fff' }}>{(wallet?.name ?? '?').slice(0, 2).toUpperCase()}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '52px' }}>{(wallet?.name ?? EM_DASH).split(' ')[0]}</span>
                    </div>
                    {/* Listing Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>–</div>
                    {/* Rarity */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>–</div>
                    {/* Floor Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>
                      {floorPrice ? <>{floorPrice} <span style={{ color: 'var(--wr-text-3)' }}>ETH</span></> : '–'}
                    </div>
                    {/* Top Offer */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', border: '1px solid var(--wr-border)', padding: '2px 8px', whiteSpace: 'nowrap' }}>–</span>
                    </div>
                    {/* Cost */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>–</div>
                    {/* Received */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>–</div>
                  </div>
                );
              })}
            </div>
            {/* Selection action bar */}
            {selectedNfts.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '10px 16px', borderTop: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                <button
                  onClick={() => setShowNftEditModal(true)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#7c5cff', border: 'none', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#5b3df0'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7c5cff'; }}
                >
                  Edit {selectedNfts.size} listing{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  onClick={() => setShowNftCancelModal(true)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  Cancel {selectedNfts.size} listing{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  onClick={() => setShowNftAcceptModal(true)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  Accept {selectedNfts.size} offer{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  onClick={() => setShowNftSendModal(true)}
                  title="Send NFTs"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', cursor: 'pointer', color: 'var(--wr-text)', flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M1.5 6.5h10M7.5 2.5l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedNfts(new Set())}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '7px 4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Token Holdings */}
          <div>
            <div style={{ marginBottom: '12px' }}>
              <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                Token Holdings
              </h2>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 100px 72px 110px 72px 90px 90px 90px', alignItems: 'center', padding: '0 16px', height: '40px', borderBottom: '1px solid var(--wr-border)', columnGap: '8px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {tokens.length} Tokens
                </div>
                {(['HELD VALUE', 'HELD QTY', 'WALLETS', 'PRICE', 'FDV', '1D CHANGE', '7D CHANGE', '1D VOL'] as const).map(col => (
                  <button
                    key={col}
                    onClick={() => setTokenSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: col === 'WALLETS' ? 'center' : 'flex-end', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: tokenSort.col === col ? 700 : 600, color: tokenSort.col === col ? 'var(--wr-text)' : 'var(--wr-text-3)', letterSpacing: '0.8px', textTransform: 'uppercase', padding: 0, whiteSpace: 'nowrap' }}
                  >
                    {col}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: tokenSort.col === col ? 1 : 0.35, flexShrink: 0 }}>
                      {tokenSort.col === col && tokenSort.dir === 'desc'
                        ? <path d="M5 7L2.5 4h5L5 7Z" fill="currentColor"/>
                        : tokenSort.col === col
                          ? <path d="M5 3L7.5 6h-5L5 3Z" fill="currentColor"/>
                          : <><path d="M5 2.5L7 4.5H3L5 2.5Z" fill="currentColor"/><path d="M5 7.5L3 5.5H7L5 7.5Z" fill="currentColor"/></>
                      }
                    </svg>
                  </button>
                ))}
              </div>
              {/* Rows */}
              {holdingsLoading && <StateNote title="Loading token balances…" />}
              {!holdingsLoading && portfolioError && (
                <StateNote tone="error" title="Token balances could not be loaded" detail={portfolioError} />
              )}
              {!holdingsLoading && !portfolioError && tokens.length === 0 && (
                <StateNote
                  title="No tokens with a balance"
                  detail={isTauri ? 'Alchemy returned no ETH or ERC-20 balance for this address.' : 'Live balances need the Westron desktop app.'}
                />
              )}
              {!holdingsLoading && !portfolioError && tokens.map(tok => {
                const isSelected = selectedToken === tok.ticker;
                const neutral = (v: string) => v === '0%' || v === '+0.0%' || v === '-0%';
                const changeColor = (v: string) => neutral(v) ? 'var(--wr-text-3)' : v.startsWith('+') ? '#4fe9b4' : '#ff8a96';
                const AVATAR_COLORS = ['#627eea', '#ffb020', '#4fe9b4', '#a78bfa', '#ff8a96'];
                return (
                  <div
                    key={tok.key}
                    onClick={() => setSelectedToken(isSelected ? null : tok.ticker)}
                    style={{ display: 'grid', gridTemplateColumns: '2fr 110px 100px 72px 110px 72px 90px 90px 90px', alignItems: 'center', padding: '0 16px', height: '60px', borderBottom: '1px solid var(--wr-border)', columnGap: '8px', backgroundColor: isSelected ? 'rgba(190,255,0,0.06)' : 'transparent', transition: 'background 0.1s', cursor: 'pointer', outline: isSelected ? '1px solid rgba(190,255,0,0.3)' : 'none', outlineOffset: '-1px' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSelected ? 'rgba(190,255,0,0.06)' : 'transparent'; }}
                  >
                    {/* Token identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: tok.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#fff' }}>{tok.ticker[0]}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>{tok.name}</span>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap' }}>{tok.ticker}</span>
                        {tok.verified && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                            <circle cx="7" cy="7" r="7" fill="#5b7cfa"/>
                            <path d="M4 7L6 9L10 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {tok.walletCount > 1 && (
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>({tok.walletCount})</span>
                        )}
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--wr-text-3)', opacity: 0.5, flexShrink: 0 }}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                    {/* Held Value */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{tok.heldValue}</div>
                    {/* Held Qty */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>{tok.heldQty}</div>
                    {/* Wallets - stacked avatars */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <div style={{ display: 'flex' }}>
                        {Array.from({ length: Math.min(tok.walletCount, 3) }).map((_, i) => (
                          <div key={i} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], border: '2px solid var(--wr-surface)', marginLeft: i > 0 ? '-6px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '8px', fontWeight: 700, color: '#fff' }}>{String.fromCharCode(65 + i)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>{tok.price}</div>
                    {/* FDV */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>{tok.fdv}</div>
                    {/* 1D Change */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: changeColor(tok.change1d) }}>{tok.change1d}</div>
                    {/* 7D Change */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: changeColor(tok.change7d) }}>{tok.change7d}</div>
                    {/* 1D Vol */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>{tok.vol1d}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '8px', lineHeight: 1.6 }}>
              FDV, 1D/7D change and 1D volume are &apos;—&apos; because no command on this app returns them. Held value and price come from the Alchemy Portfolio API.
            </div>
            {/* Token selection action bar */}
            {selectedToken !== null && (() => {
              const selTok = tokens.find(t => t.ticker === selectedToken);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderTop: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flex: 1 }}>{selTok?.name ?? selectedToken} selected</span>
                  <button
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#7c5cff', border: 'none', padding: '7px 14px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onClick={() => setShowTransferModal(true)}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#5b3df0'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#7c5cff'; }}
                  >
                    Transfer
                  </button>
                  <button
                    onClick={() => setSelectedToken(null)}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '7px 4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                  >
                    Clear
                  </button>
                </div>
              );
            })()}
          </div>
        </>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {tab === 'Transactions' && (
        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
            style={{ gridTemplateColumns: '1.8fr 0.8fr 1fr 0.8fr 1.4fr 1.4fr 0.8fr 0.8fr 1fr', columnGap: '16px', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span>Tx Hash</span>
            <span>Type</span>
            <span>Block</span>
            <span>Age</span>
            <span>From</span>
            <span>To</span>
            <span>Token</span>
            <span>Amount</span>
            <span>Gas Fee</span>
          </div>
          {txLoading && <StateNote title="Loading transfers…" />}
          {!txLoading && txError && (
            <StateNote
              tone="error"
              title="Transfers could not be loaded"
              detail={`${txError} — note that the backend returns this same error when a wallet has no transfers at all, so it may also mean "nothing to show".`}
            />
          )}
          {!txLoading && !txError && displayTxs.length === 0 && (
            <StateNote
              title="No transfers yet"
              detail={isTauri
                ? 'Alchemy returned no incoming or outgoing transfers for this address.'
                : 'Live transfer history needs the Westron desktop app.'}
            />
          )}
          {!txLoading && !txError && displayTxs.map((tx, i) => {
            const ts = TX_STYLE[tx.type];
            return (
              <div key={i}
                className="grid px-4 py-3.5 border-b border-[var(--wr-border)] last:border-b-0 hover:bg-[var(--wr-surface)] transition-colors items-center"
                style={{ gridTemplateColumns: '1.8fr 0.8fr 1fr 0.8fr 1.4fr 1.4fr 0.8fr 0.8fr 1fr', columnGap: '16px' }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span style={{ color: '#5b7cfa', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.hash}</span>
                  <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink: 0, color: 'var(--wr-text-3)', display: 'flex' }} className="hover:text-[#9298b8] transition-colors">
                    <ExternalLinkIcon />
                  </a>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: ts.text, backgroundColor: ts.bg, border: `1px solid ${ts.border}`, padding: '2px 8px', display: 'inline-block' }}>{tx.type}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#5b7cfa' }}>{tx.block}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.age}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#9298b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.from}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#9298b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.to}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.token}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>{tx.amount}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.gas}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === 'Analytics' && (
        <>
          {/* KPI cards. Only two of these four have a real source today, and
              the other two say so rather than showing a number. */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Traded Volume</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>
                {analyticsLoading ? EM_DASH : pnl ? fmtEth(pnl.total_buy_volume_eth + pnl.total_sell_volume_eth) : EM_DASH}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.5 }}>
                {analyticsLoading ? 'Fetching…' : pnlError ? `Unavailable — ${pnlError}` : pnl ? 'buys + sells across trades Westron has recorded' : 'No data yet'}
              </p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Best Held NFT</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 700, wordBreak: 'break-word' }}>
                {bestNft ? (bestNft.collection || `#${bestNft.token_id}`) : EM_DASH}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#4fe9b4', marginTop: '4px' }}>
                {bestNft ? fmtEth(bestNft.unrealized_eth) : EM_DASH}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.5 }}>
                {analyticsLoading ? 'Fetching…' : nftPnlError ? `Unavailable — ${nftPnlError}` : bestNft ? 'unrealized vs stored cost basis' : 'No cost basis recorded yet'}
              </p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Worst Held NFT</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 700, wordBreak: 'break-word' }}>
                {worstNft ? (worstNft.collection || `#${worstNft.token_id}`) : EM_DASH}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff8a96', marginTop: '4px' }}>
                {worstNft ? fmtEth(worstNft.unrealized_eth) : EM_DASH}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.5 }}>
                {analyticsLoading ? 'Fetching…' : nftPnlError ? `Unavailable — ${nftPnlError}` : worstNft ? 'unrealized vs stored cost basis' : 'Needs at least two priced holdings'}
              </p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Avg Hold Time</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700, color: 'var(--wr-text-3)' }}>{EM_DASH}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px', lineHeight: 1.5 }}>
                No command returns acquisition and disposal timestamps per holding, so this cannot be computed yet.
              </p>
            </div>
          </div>

          {/* Portfolio value over time. Westron stores no historical portfolio
              snapshots, so there is no series to draw — the old chart was a
              hardcoded shape. Current value is real. */}
          <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px', marginBottom: '24px' }}>
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '16px' }}>
              Portfolio Value
            </p>
            <div className="mb-2">
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '22px', fontWeight: 700 }}>
                {holdingsLoading ? EM_DASH : displayTotalValue}
              </p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                {holdingsLoading ? 'Fetching…' : portfolioError ? `Unavailable — ${portfolioError}` : 'current value (USD), ETH + ERC-20'}
              </p>
            </div>
            <div style={{ border: '1px dashed var(--wr-border)', marginTop: '16px' }}>
              <StateNote
                title="No portfolio history"
                detail="Westron does not store historical portfolio snapshots, and no command returns them, so there is no series to plot. A chart here would have to be invented."
              />
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-2 gap-4">
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '20px' }}>
                Trading Performance
              </p>
              <div className="flex items-end gap-8">
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Closed Trades</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>
                    {analyticsLoading ? EM_DASH : pnl ? pnl.trade_count.toLocaleString('en-US') : EM_DASH}
                  </p>
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Win Rate</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '28px', fontWeight: 700, color: 'var(--wr-accent)' }}>
                    {analyticsLoading || !pnl || pnl.win_count + pnl.loss_count === 0
                      ? EM_DASH
                      : `${((pnl.win_count / (pnl.win_count + pnl.loss_count)) * 100).toFixed(2)}%`}
                  </p>
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Realized P&amp;L</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>
                    {analyticsLoading ? EM_DASH : pnl ? fmtEth(pnl.realized_pnl_eth) : EM_DASH}
                  </p>
                </div>
              </div>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '14px', lineHeight: 1.6 }}>
                {analyticsLoading
                  ? 'Fetching…'
                  : pnlError
                    ? `Unavailable — ${pnlError}`
                    : pnl
                      ? 'Covers NFT trades Westron has matched into buy/sell pairs locally, not the wallet’s entire history. Gas is not attributed per trade, so it is excluded.'
                      : 'No data yet.'}
              </p>
            </div>

            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '16px' }}>
                Top Collections by Floor Value
              </p>
              {analyticsLoading && <StateNote title="Fetching floors…" />}
              {!analyticsLoading && nftPnlError && <StateNote tone="error" title="Unavailable" detail={nftPnlError} />}
              {!analyticsLoading && !nftPnlError && topCols.length === 0 && (
                <StateNote title="No data yet" detail="Needs held NFTs whose collections have a floor price from the NFT P&amp;L command." />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {topCols.map((col, i) => (
                  <div key={col.name} className="flex items-center gap-3">
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', width: '16px', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', color: 'var(--wr-text)', flex: 1, wordBreak: 'break-word' }}>{col.name}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#9298b8' }}>{col.eth}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '36px', textAlign: 'right' }}>{col.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── ADDRESS BOOK TAB ── */}
      {tab === 'Address Book' && <AddressBookTab />}

      {showTransferModal && (
        <TransferModal
          walletName={wallet?.name ?? 'Unknown wallet'}
          fromAddress={walletAddr}
          alchemyKey={alchemyKey}
          isTauri={isTauri}
          tokenSymbol={selectedTokenSymbol}
          onClose={() => setShowTransferModal(false)}
        />
      )}
      {showDistribute && wallet && (
        <DistributeModal
          wallets={loadWallets().map(w => ({ id: w.id, name: w.name, address: w.address }))}
          skin="wallets"
          enableTabs
          lockedSourceId={wallet.id}
          nfts={liveNfts ?? []}
          onClose={() => setShowDistribute(false)}
        />
      )}
      {(() => {
        const selNfts = (liveNfts ?? []).filter(n => selectedNfts.has(n.contract.address + n.token_id));
        const close = (setter: (v: boolean) => void) => () => { setter(false); setSelectedNfts(new Set()); };
        return (<>
          {showNftEditModal   && <NftEditListingModal  nfts={selNfts} onClose={close(setShowNftEditModal)} />}
          {showNftCancelModal && <NftCancelListingModal nfts={selNfts} onClose={close(setShowNftCancelModal)} />}
          {showNftAcceptModal && <NftAcceptOfferModal  nfts={selNfts} onClose={close(setShowNftAcceptModal)} />}
          {showNftSendModal   && <NftSendModal nfts={selNfts} walletAddress={walletAddr} onClose={close(setShowNftSendModal)} />}
        </>);
      })()}
    </main>
  );
}
