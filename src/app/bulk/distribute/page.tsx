'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import ProGate from '@/components/ProGate';
import { loadAddressBook, type AddressEntry } from '@/lib/addressBook';
import { loadWallets } from '@/lib/walletStore';
import { loadAlchemyKey, getWalletTokens, estimateGas, openExternalUrl } from '@/lib/tauri';
import {
  runDistribution, previewTransaction, parseEthToWei, formatWeiToEth, explainSendError,
  isValidEthAmount,
  type SendRow, type TransactionPreview,
} from '@/lib/distribute';

// ─── Distribute Funds ─────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;
type DistMode = 'equal' | 'custom';

const STEP_LABELS = ['Select & Amounts', 'Confirm', 'Process'] as const;

const WETH_CONTRACT = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

// Balances are `null` until a real Alchemy response fills them in — never 0,
// which would read as a genuine "this wallet is empty".
interface DistWallet { id: string; name: string; address: string; eth: number | null; weth: number | null }

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Balance renderer: '—' until the real number arrives. */
function bal(v: number | null, digits: number): string {
  return v == null ? '—' : v.toFixed(digits);
}

/** Decimal ETH string → wei decimal string (no float rounding). */
function ethToWei(eth: string): string {
  const [whole = '0', frac = ''] = eth.trim().split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  const digits = (whole.replace(/\D/g, '') || '0') + fracPadded.replace(/\D/g, '').padEnd(18, '0');
  return (BigInt(digits)).toString();
}

function errText(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center w-full mb-6">
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as Step;
        const done = n < current;
        const active = n === current;
        return (
          <div key={n} className="flex items-center" style={{ flex: i < 2 ? '1' : 'none' }}>
            <div className="flex items-center gap-2">
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                backgroundColor: done || active ? '#7c5cff' : 'var(--wr-surface-alt)',
                border: `1px solid ${active || done ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
                color: active || done ? '#0b0c14' : 'var(--wr-text-3)',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: active ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
                {label}
              </span>
            </div>
            {i < 2 && <div style={{ flex: 1, height: '1px', backgroundColor: done ? '#7c5cff' : 'var(--wr-border)', margin: '0 12px' }} />}
          </div>
        );
      })}
    </div>
  );
}

export default function DistributeFundsPage() {
  const [step, setStep] = useState<Step>(1);

  // Real wallets (walletStore) + live balances (Alchemy). No fixtures: a wallet
  // starts with null balances and only ever shows a number the backend returned.
  const [wallets, setWallets] = useState<DistWallet[]>([]);
  const [walletsLoaded, setWalletsLoaded] = useState(false);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesNote, setBalancesNote] = useState<string | null>(null);
  const [alchemyKey, setAlchemyKey] = useState('');

  useEffect(() => {
    let stored: { id: string; name: string; address: string }[] = [];
    try { stored = loadWallets(); } catch { stored = []; }
    setWallets(stored.map(w => ({ id: w.id, name: w.name, address: w.address, eth: null, weth: null })));
    setWalletsLoaded(true);

    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri) { setBalancesNote('Live balances need the Westron desktop app.'); return; }
    if (stored.length === 0) return;

    let cancelled = false;
    (async () => {
      let key = '';
      try { key = (await loadAlchemyKey()) ?? ''; } catch { key = ''; }
      if (cancelled) return;
      setAlchemyKey(key);
      if (!key) { setBalancesNote('Add an Alchemy API key in Settings to load balances.'); return; }

      setBalancesLoading(true);
      // One command per wallet, strictly sequential. get_wallet_tokens returns
      // the native ETH row and every ERC-20 in a single Alchemy request, so
      // there is no per-row fan-out and no Promise.all burst (free tier / 429s).
      const failures: string[] = [];
      for (const w of stored) {
        if (cancelled) return;
        try {
          // eslint-disable-next-line no-await-in-loop
          const toks = await getWalletTokens(w.address, key);
          if (cancelled) return;
          const eth = toks.find(t => t.isNative)?.balance ?? null;
          const weth = toks.find(t => (t.tokenAddress ?? '').toLowerCase() === WETH_CONTRACT.toLowerCase())?.balance ?? 0;
          setWallets(prev => prev.map(p => p.id === w.id ? { ...p, eth, weth } : p));
        } catch (e) {
          failures.push(`${w.name}: ${errText(e, 'balance unavailable')}`);
        }
      }
      if (cancelled) return;
      setBalancesLoading(false);
      setBalancesNote(failures.length > 0 ? `Could not load ${failures.length} balance(s) — ${failures[0]}` : null);
    })();

    return () => { cancelled = true; };
  }, []);

  const sourceWallets = wallets.map(w => ({ id: w.id, label: `${w.name} — ${shortAddr(w.address)}`, eth: w.eth, weth: w.weth }));

  // Step 1 state
  const [source, setSource] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<DistMode>('equal');
  const [amountEqual, setAmountEqual] = useState('');
  const [amountCustom, setAmountCustom] = useState<Record<string, string>>({});

  const addressBookEntries: AddressEntry[] = loadAddressBook();
  const [abSelected, setAbSelected] = useState<Set<string>>(new Set());
  const [abAmounts, setAbAmounts] = useState<Record<string, string>>({});

  const toggleWallet = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAb = (id: string) =>
    setAbSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedList = wallets.filter(w => selected.has(w.id));
  const abSelectedList = addressBookEntries.filter(e => abSelected.has(e.id));
  const totalSelected = selected.size + abSelected.size;

  const sourceWallet = wallets.find(w => w.id === source) ?? null;

  // Address-based, case-insensitive — same check as DistributeModal's
  // `selfSendWarnings`/`nftSelfSendWarning` (T6b). A destination that shares
  // the source's address only burns gas; the user is told, not silently
  // allowed to send money to themselves.
  const selfSendWarnings = sourceWallet
    ? [
        ...selectedList
          .filter(w => w.address.toLowerCase() === sourceWallet.address.toLowerCase())
          .map(w => `${w.name}: this destination is the same address as the source. The transfer would only cost gas.`),
        ...abSelectedList
          .filter(e => e.address.toLowerCase() === sourceWallet.address.toLowerCase())
          .map(e => `${e.name}: this destination is the same address as the source. The transfer would only cost gas.`),
      ]
    : [];

  // Same check Step 2's preview effect and the real send use (`parseEthToWei`
  // via `isValidEthAmount`) — `parseFloat(x) > 0` used to disagree with it on
  // inputs like "1e-5" (parseFloat accepts, the decimal-only wei parser
  // rejects), which let a "valid" Step 1 amount silently vanish out of the
  // Step 2 preview map and leave Confirm & Send disabled with no reason.
  const canReview = !!source && totalSelected > 0 && (
    mode === 'equal'
      ? isValidEthAmount(amountEqual)
      : selectedList.every(w => isValidEthAmount(amountCustom[w.id] ?? '')) &&
        abSelectedList.every(e => isValidEthAmount(abAmounts[e.id] ?? ''))
  );

  /** Per-field message for the amount inputs — only once the user has typed
   *  something (an empty box before the user starts is not an error yet). */
  const amountFieldError = (raw: string): string | null => {
    const s = raw.trim();
    if (s === '') return null;
    return isValidEthAmount(s) ? null : 'Invalid amount — enter a number greater than 0';
  };

  // ── Gas estimate (real eth_estimateGas, one call for the whole review) ──────
  // The Rust command returns GAS UNITS, not a fee: converting to ETH needs a
  // gas price, which this build does not expose. So we show the real unit count
  // and say plainly that the ETH cost is not available.
  const [gasUnits, setGasUnits] = useState<number | null>(null);
  const [gasLoading, setGasLoading] = useState(false);
  const [gasError, setGasError] = useState<string | null>(null);

  useEffect(() => {
    if (step !== 2) return;
    const firstAddr = selectedList[0]?.address ?? abSelectedList[0]?.address ?? '';
    const firstAmount = mode === 'equal'
      ? amountEqual
      : (selectedList[0] ? amountCustom[selectedList[0].id] : abSelectedList[0] ? abAmounts[abSelectedList[0].id] : '') ?? '';
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri) { setGasUnits(null); setGasError('Needs the Westron desktop app.'); return; }
    if (!alchemyKey) { setGasUnits(null); setGasError('Add an Alchemy API key in Settings.'); return; }
    if (!firstAddr || !firstAmount) { setGasUnits(null); setGasError(null); return; }

    let cancelled = false;
    setGasLoading(true);
    setGasError(null);
    estimateGas(firstAddr, ethToWei(firstAmount), undefined, alchemyKey)
      .then(g => { if (!cancelled) setGasUnits(g); })
      .catch(e => { if (!cancelled) { setGasUnits(null); setGasError(errText(e, 'Gas estimate failed.')); } })
      .finally(() => { if (!cancelled) setGasLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, alchemyKey]);

  // ── Real send path ───────────────────────────────────────────────────────
  // Same envelope-protected pipeline as DistributeModal: `previewTransaction`
  // (no side effects) verdicts every destination before Confirm is enabled,
  // `runDistribution` performs the actual serial `send_eth` calls and reports
  // real per-row state back — nothing here is a timer.
  const [previews, setPreviews] = useState<Record<string, TransactionPreview>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [sendRows, setSendRows] = useState<SendRow[]>([]);
  const [sending, setSending] = useState(false);
  const [linkOpenError, setLinkOpenError] = useState<string | null>(null);
  const sendStartedRef = useRef(false);

  async function openInBrowser(url: string) {
    setLinkOpenError(null);
    try {
      await openExternalUrl(url);
    } catch (e) {
      setLinkOpenError(`Could not open the default browser: ${errText(e, 'unknown error')}`);
    }
  }

  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    (async () => {
      setPreviewBusy(true); setPreviewError(null);
      try {
        const out: Record<string, TransactionPreview> = {};
        for (const w of selectedList) {
          const amt = mode === 'equal' ? amountEqual : (amountCustom[w.id] ?? '');
          const wei = parseEthToWei(amt);
          if (wei == null) continue;
          out[w.id] = await previewTransaction({ to: w.address, valueWei: wei.toString() });
        }
        for (const ab of abSelectedList) {
          const amt = mode === 'equal' ? amountEqual : (abAmounts[ab.id] ?? '');
          const wei = parseEthToWei(amt);
          if (wei == null) continue;
          out[ab.id] = await previewTransaction({ to: ab.address, valueWei: wei.toString() });
        }
        if (!cancelled) setPreviews(out);
      } catch (e) {
        if (!cancelled) setPreviewError(errText(e, 'Preview failed.'));
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canSend = !!sourceWallet && !!alchemyKey && !previewBusy && !previewError &&
    totalSelected > 0 &&
    selectedList.every(w => previews[w.id]?.authorized === true) &&
    abSelectedList.every(e => previews[e.id]?.authorized === true);

  async function startSend() {
    // Ref, not `sending` state: state updates land async, so a double-click
    // in the same tick could otherwise fire two broadcasts.
    if (!canSend || sendStartedRef.current || !sourceWallet) return;
    sendStartedRef.current = true;
    const rows: SendRow[] = [];
    for (const w of selectedList) {
      const amt = mode === 'equal' ? amountEqual : (amountCustom[w.id] ?? '');
      const wei = parseEthToWei(amt);
      if (wei == null) continue;
      rows.push({ id: w.id, name: w.name, address: w.address, valueWei: wei, state: 'queued' });
    }
    for (const ab of abSelectedList) {
      const amt = mode === 'equal' ? amountEqual : (abAmounts[ab.id] ?? '');
      const wei = parseEthToWei(amt);
      if (wei == null) continue;
      rows.push({ id: ab.id, name: ab.name, address: ab.address, valueWei: wei, state: 'queued' });
    }
    if (rows.length === 0) { sendStartedRef.current = false; return; }
    setSendRows(rows); setSending(true); setStep(3);
    await runDistribution(sourceWallet.address, rows, alchemyKey, setSendRows);
    setSending(false);
  }

  function resetFlow() {
    sendStartedRef.current = false;
    setStep(1); setAmountEqual(''); setAmountCustom({}); setAbAmounts({});
    setAbSelected(new Set()); setSelected(new Set());
    setSendRows([]); setPreviews({}); setPreviewError(null); setLinkOpenError(null);
  }

  const TxPanel = () => (
    <div style={{ flex: 1, backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '24px', minHeight: '400px' }}>
      <div className="flex items-center justify-between mb-6">
        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Transaction Monitor</span>
        <span style={{ color: 'var(--wr-text-3)', fontSize: '16px', cursor: 'pointer' }}>↻</span>
      </div>
      {step < 3 ? (
        <div className="flex flex-col items-center justify-center" style={{ height: '280px', gap: '12px' }}>
          <div style={{ color: 'var(--wr-border-hover)', fontSize: '40px' }}>🖥</div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', textAlign: 'center' }}>
            No Active Transactions<br />
            <span style={{ fontSize: '11px', color: 'var(--wr-text-4)' }}>Select wallets and confirm to begin distribution</span>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {sendRows.map(r => {
            const rowLabel = r.state === 'broadcast' ? 'Broadcast' : r.state === 'submitting' ? 'Signing…' : r.state === 'failed' ? 'Failed' : r.state === 'skipped' ? 'Not sent' : 'Queued';
            const rowColor = r.state === 'broadcast' ? 'var(--wr-accent)' : r.state === 'submitting' ? '#ffb020' : r.state === 'failed' ? '#ff8a96' : 'var(--wr-text-3)';
            return (
              <div key={r.id} className="px-4 py-3" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{shortAddr(r.address)}</div>
                    <div style={{ color: 'var(--wr-text-3)', fontSize: '11px', fontFamily: 'var(--font-jetbrains)', marginTop: '2px' }}>
                      {formatWeiToEth(r.valueWei)} ETH
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: rowColor }}>
                    {rowLabel}
                  </span>
                </div>
                {r.hash && (
                  <button
                    type="button"
                    onClick={() => { void openInBrowser(`https://etherscan.io/tx/${r.hash}`); }}
                    style={{
                      display: 'block', marginTop: '6px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px',
                      color: 'var(--wr-accent)', wordBreak: 'break-all', textDecoration: 'none', background: 'none',
                      border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontWeight: 700 }}>TXN:</span> {r.hash}
                  </button>
                )}
                {r.error && (
                  <div style={{ marginTop: '6px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', lineHeight: 1.6 }}>{explainSendError(r.error)}</div>
                )}
              </div>
            );
          })}
          {linkOpenError && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', lineHeight: 1.6 }}>{linkOpenError}</div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <ProGate feature="Distribute Funds">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
        <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>← Back to Bulk Actions</Link>
      </div>

      <div className="flex gap-6" style={{ maxWidth: '900px' }}>
        {/* Left panel — modal */}
        <div style={{ width: '440px', flexShrink: 0, backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '28px' }}>
          <div className="flex items-center justify-between mb-2">
            <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Distribute Funds</h2>
            <Link href="/bulk" style={{ color: 'var(--wr-text-3)', fontSize: '18px', textDecoration: 'none', lineHeight: 1 }}>×</Link>
          </div>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '24px' }}>
            Send ETH from one wallet to one or more destinations
          </p>

          <StepIndicator current={step} />

          {/* ── Step 1: Select & Amounts ── */}
          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              {/* FROM */}
              <div>
                <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '8px' }}>
                  From (Funding Wallet)
                </label>
                <div style={{ position: 'relative' }}>
                  <select
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-bg)', border: '1px solid var(--wr-border)', padding: '10px 32px 10px 14px', appearance: 'none', cursor: 'pointer', outline: 'none' }}
                  >
                    <option value="" disabled>
                      {walletsLoaded && wallets.length === 0 ? 'No saved wallets' : 'Select wallet…'}
                    </option>
                    {sourceWallets.map(w => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wr-text-3)' as never }}/>
                  </svg>
                </div>
                {/* Source balance */}
                {(() => {
                  const sw = sourceWallets.find(w => w.id === source);
                  if (!sw) return null;
                  return (
                    <div style={{ display: 'flex', gap: '16px', marginTop: '7px', paddingLeft: '2px' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                        <span style={{ color: 'var(--wr-text-4)', marginRight: '4px' }}>ETH</span>
                        <span style={{ color: sw.eth == null ? 'var(--wr-text-4)' : 'var(--wr-text)', fontWeight: 600 }}>{bal(sw.eth, 4)}</span>
                      </span>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                        <span style={{ color: 'var(--wr-text-4)', marginRight: '4px' }}>WETH</span>
                        <span style={{ color: sw.weth != null && sw.weth > 0 ? 'var(--wr-text)' : 'var(--wr-text-4)', fontWeight: 600 }}>{bal(sw.weth, 4)}</span>
                      </span>
                      {balancesLoading && (
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-4)' }}>Loading balances…</span>
                      )}
                    </div>
                  );
                })()}
                {balancesNote && (
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '6px' }}>
                    {balancesNote}
                  </div>
                )}
              </div>

              {/* TO — wallet grid */}
              <div>
                <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '10px' }}>
                  To
                </label>
                {walletsLoaded && wallets.length === 0 && (
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', border: '1px solid var(--wr-border)', padding: '14px' }}>
                    No wallets yet.
                    <span style={{ display: 'block', fontSize: '10px', color: 'var(--wr-text-4)', marginTop: '4px' }}>
                      Add a wallet in Wallets, or pick a destination from the Address Book.
                    </span>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {wallets.map(w => {
                    const isSel = selected.has(w.id);
                    return (
                      <div
                        key={w.id}
                        onClick={() => toggleWallet(w.id)}
                        style={{
                          padding: '10px 12px',
                          border: `1px solid ${isSel ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
                          backgroundColor: isSel ? 'var(--wr-accent-dim)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '8px',
                        }}
                        onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSel ? 'var(--wr-accent-dim)' : 'transparent'; }}
                      >
                        {/* Checkbox */}
                        <div style={{
                          width: '14px', height: '14px', flexShrink: 0, marginTop: '1px',
                          border: `1.5px solid ${isSel ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                          backgroundColor: isSel ? 'var(--wr-accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSel && <span style={{ color: '#000', fontSize: '9px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: isSel ? 'var(--wr-accent)' : 'var(--wr-text)' }}>{w.name}</div>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{shortAddr(w.address)}</div>
                          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px' }}>
                              <span style={{ color: 'var(--wr-text-4)' }}>ETH </span>
                              <span style={{ color: w.eth == null ? 'var(--wr-text-4)' : 'var(--wr-text-2)', fontWeight: 600 }}>{bal(w.eth, 3)}</span>
                            </span>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px' }}>
                              <span style={{ color: 'var(--wr-text-4)' }}>WETH </span>
                              <span style={{ color: w.weth != null && w.weth > 0 ? 'var(--wr-text-2)' : 'var(--wr-text-4)', fontWeight: 600 }}>{bal(w.weth, 3)}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Address Book recipients */}
              {addressBookEntries.length > 0 && (
                <div>
                  <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '10px' }}>
                    Address Book
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {addressBookEntries.map(ab => {
                      const isSel = abSelected.has(ab.id);
                      return (
                        <div
                          key={ab.id}
                          onClick={() => toggleAb(ab.id)}
                          style={{ padding: '10px 12px', border: `1px solid ${isSel ? 'var(--wr-accent)' : 'var(--wr-border)'}`, backgroundColor: isSel ? 'var(--wr-accent-dim)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
                          onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSel ? 'var(--wr-accent-dim)' : 'transparent'; }}
                        >
                          <div style={{ width: '14px', height: '14px', flexShrink: 0, border: `1.5px solid ${isSel ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`, backgroundColor: isSel ? 'var(--wr-accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isSel && <span style={{ color: '#000', fontSize: '9px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: isSel ? 'var(--wr-accent)' : 'var(--wr-text)' }}>{ab.name}</span>
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#7c5cff', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                            </div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.address}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* AMOUNT */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
                    Amount
                  </label>
                  {/* Equal / Custom toggle */}
                  <div style={{ display: 'flex', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
                    {(['equal', 'custom'] as DistMode[]).map(m => (
                      <button
                        key={m}
                        onClick={() => setMode(m)}
                        style={{
                          fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                          letterSpacing: '0.05em', textTransform: 'uppercase',
                          padding: '5px 12px', border: 'none', cursor: 'pointer',
                          backgroundColor: mode === m ? 'var(--wr-accent)' : 'transparent',
                          color: mode === m ? '#0b0c14' : 'var(--wr-text-3)',
                          transition: 'background-color 0.1s',
                        }}
                      >
                        {m === 'equal' ? 'Equal' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'equal' ? (
                  <div>
                    <div style={{ display: 'flex', border: `1px solid ${amountFieldError(amountEqual) ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)'}` }}>
                      <input
                        type="number"
                        placeholder={`Amount per wallet (applies to all ${totalSelected} selected)`}
                        value={amountEqual}
                        onChange={e => setAmountEqual(e.target.value)}
                        min="0"
                        step="0.01"
                        style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-bg)', border: 'none', padding: '10px 12px', outline: 'none' }}
                      />
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface-alt)', padding: '10px 14px', borderLeft: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center' }}>
                        ETH
                      </div>
                    </div>
                    {amountFieldError(amountEqual) && (
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '4px' }}>{amountFieldError(amountEqual)}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedList.map(w => {
                      const err = amountFieldError(amountCustom[w.id] ?? '');
                      return (
                      <div key={w.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '90px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                          <div style={{ flex: 1, display: 'flex', border: `1px solid ${err ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)'}` }}>
                            <input
                              type="number"
                              placeholder="0.00"
                              value={amountCustom[w.id] ?? ''}
                              onChange={e => setAmountCustom(prev => ({ ...prev, [w.id]: e.target.value }))}
                              min="0"
                              step="0.01"
                              style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-bg)', border: 'none', padding: '8px 10px', outline: 'none' }}
                            />
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface-alt)', padding: '8px 10px', borderLeft: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center' }}>
                              ETH
                            </div>
                          </div>
                        </div>
                        {err && (
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '3px', marginLeft: '100px' }}>{err}</div>
                        )}
                      </div>
                      );
                    })}
                    {abSelectedList.map(ab => {
                      const err = amountFieldError(abAmounts[ab.id] ?? '');
                      return (
                      <div key={ab.id}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '90px', flexShrink: 0, overflow: 'hidden' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.name}</span>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#7c5cff', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                        </div>
                        <div style={{ flex: 1, display: 'flex', border: `1px solid ${err ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)'}` }}>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={abAmounts[ab.id] ?? ''}
                            onChange={e => setAbAmounts(prev => ({ ...prev, [ab.id]: e.target.value }))}
                            min="0"
                            step="0.01"
                            style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-bg)', border: 'none', padding: '8px 10px', outline: 'none' }}
                          />
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface-alt)', padding: '8px 10px', borderLeft: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center' }}>
                            ETH
                          </div>
                        </div>
                        </div>
                        {err && (
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '3px', marginLeft: '100px' }}>{err}</div>
                        )}
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
                <Link
                  href="/bulk"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '11px 0', textDecoration: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </Link>
                <button
                  onClick={() => { if (canReview) setStep(2); }}
                  disabled={!canReview}
                  style={{ flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: canReview ? '#0b0c14' : 'var(--wr-text-4)', backgroundColor: canReview ? '#7c5cff' : 'var(--wr-overlay)', border: `1px solid ${canReview ? '#7c5cff' : 'var(--wr-border)'}`, padding: '11px 0', cursor: canReview ? 'pointer' : 'not-allowed' }}
                >
                  Review ({totalSelected} wallet{totalSelected !== 1 ? 's' : ''})
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Confirm ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '4px' }}>Review distribution</div>
              {selfSendWarnings.length > 0 && (
                <div style={{ border: '1px solid rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)', padding: '10px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ffb020', lineHeight: 1.6 }}>
                  {selfSendWarnings.map((w, i) => <div key={i} style={{ marginTop: i ? '3px' : 0 }}>· {w}</div>)}
                </div>
              )}
              {selectedList.map((w, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
                  <div>
                    <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{w.name}</div>
                    <div style={{ color: 'var(--wr-text-3)', fontSize: '10px', fontFamily: 'var(--font-jetbrains)' }}>{shortAddr(w.address)}</div>
                  </div>
                  <span style={{ color: 'var(--wr-accent)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', fontWeight: 600 }}>
                    {mode === 'equal' ? amountEqual : (amountCustom[w.id] ?? '0')} ETH
                  </span>
                </div>
              ))}
              {abSelectedList.map(ab => (
                <div key={ab.id} className="flex items-center justify-between px-3 py-2.5" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{ab.name}</span>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#7c5cff', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                    </div>
                    <div style={{ color: 'var(--wr-text-3)', fontSize: '10px', fontFamily: 'var(--font-jetbrains)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>{ab.address}</div>
                  </div>
                  <span style={{ color: 'var(--wr-accent)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', fontWeight: 600 }}>
                    {mode === 'equal' ? amountEqual : (abAmounts[ab.id] ?? '0')} ETH
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--wr-border)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Gas estimate:</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: gasUnits == null ? 'var(--wr-text-4)' : 'var(--wr-text)' }}>
                  {gasLoading ? 'Estimating…' : gasUnits != null ? `${gasUnits.toLocaleString()} gas / transfer` : '—'}
                </span>
              </div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: gasError ? '#ff8a96' : 'var(--wr-text-4)', marginTop: '-8px' }}>
                {gasError
                  ? gasError
                  : 'eth_estimateGas for the first recipient. Gas units only — the ETH cost depends on the gas price at send time, which this build does not fetch.'}
              </div>

              {/* Envelope verdict — this is what actually gates sending, not the gas estimate above */}
              <div className="flex items-center justify-between">
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Spending envelope:</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: previewBusy ? 'var(--wr-text-4)' : canSend ? 'var(--wr-accent)' : '#ff8a96' }}>
                  {previewBusy ? 'Checking…' : canSend ? 'Authorized' : 'Not authorized'}
                </span>
              </div>
              {!alchemyKey && (
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', marginTop: '-8px' }}>
                  Add an Alchemy API key in Settings before sending.
                </div>
              )}
              {previewError && (
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', lineHeight: 1.6 }}>{explainSendError(previewError)}</div>
              )}
              {!previewBusy && !previewError && [...selectedList.map(w => ({ id: w.id, name: w.name })), ...abSelectedList.map(e => ({ id: e.id, name: e.name }))]
                .filter(d => previews[d.id] && previews[d.id].authorized !== true)
                .map(d => (
                  <div key={d.id} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#ff8a96', lineHeight: 1.6 }}>
                    {d.name}: {explainSendError(previews[d.id].reject_code ?? previews[d.id].reject_reason ?? 'The envelope did not authorize this transfer.')}
                  </div>
                ))}

              <div className="flex gap-2 mt-2">
                <button onClick={() => setStep(1)} style={{ flex: 1, backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, padding: '10px 0', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>Back</button>
                <button
                  onClick={startSend}
                  disabled={!canSend}
                  style={{
                    flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
                    color: canSend ? '#0b0c14' : 'var(--wr-text-4)',
                    backgroundColor: canSend ? '#7c5cff' : 'var(--wr-overlay)',
                    border: `1px solid ${canSend ? '#7c5cff' : 'var(--wr-border)'}`,
                    padding: '10px 0', cursor: canSend ? 'pointer' : 'not-allowed',
                  }}
                >
                  {previewBusy ? 'Checking…' : 'Confirm & Send'}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Processing ── */}
          {step === 3 && (() => {
            const anyFailed = sendRows.some(r => r.state === 'failed');
            const icon = sending ? '⚡' : anyFailed ? '!' : '✓';
            const headline = sending ? 'Signing and broadcasting' : anyFailed ? 'Not fully sent' : 'Done';
            return (
              <div className="space-y-4">
                <div className="flex flex-col items-center py-6 gap-3">
                  <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--wr-overlay)', border: '1px solid var(--wr-border-hover)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>{icon}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>{headline}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textAlign: 'center' }}>
                    {sending
                      ? 'One at a time — a second send from the same address would reuse the nonce.'
                      : 'A transaction hash means the network accepted it. Confirmation still takes a block or two. See the Transaction Monitor for per-destination status.'}
                  </div>
                </div>
                <button disabled={sending} onClick={resetFlow}
                  style={{ width: '100%', backgroundColor: 'transparent', color: sending ? 'var(--wr-text-4)' : 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, padding: '10px 0', border: '1px solid var(--wr-border)', cursor: sending ? 'not-allowed' : 'pointer' }}>
                  {sending ? 'Working…' : 'New Distribution'}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Right panel — tx monitor */}
        <TxPanel />
      </div>
    </main>
    </ProGate>
  );
}
