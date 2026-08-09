'use client';

// ─── Distribute Funds Modal (shared) ───────────────────────────────────────
//
// This used to be two nearly-identical copies of the same 3-step
// (Select & Amounts → Confirm → Process) send flow — one in the dashboard,
// one on the wallets page — that had already started drifting apart (one
// filtered destinations by wallet id, one by a slightly different id check;
// one derived the send address from `.address`, the other from
// `.rawAddress || .address`). Extracted here so there is exactly one place
// that decides what counts as a valid send.
//
// Visuals are still allowed to differ — the dashboard modal is styled green
// with a custom source dropdown, the wallets-page modal is styled purple
// with a native <select> — because that is how they already looked and
// this is a refactor, not a redesign. The `skin` prop carries only that
// cosmetic difference; every validation/sending decision below is shared.
//
// Every status in Step 3 is driven by the SendRow state that `runDistribution`
// reports back from the actual `send_eth` call — never advanced on a clock.

import React, { useEffect, useRef, useState } from 'react';
import {
  runDistribution, previewTransaction, parseEthToWei, formatWeiToEth, explainSendError,
  type SendRow, type TransactionPreview,
} from '@/lib/distribute';
import { loadAlchemyKey, openExternalUrl } from '@/lib/tauri';
import EthIcon from '@/components/EthIcon';

export interface DistributeWalletOption {
  id: string;
  name: string;
  /** Always the full, un-shortened on-chain address — never a display string. */
  address: string;
  /** Known USD balance, if the caller has one handy. Shown next to the source
   *  wallet in Step 2 when present; an em dash when not (the dashboard never
   *  had this number for this modal, so it never claimed one). */
  usdValue?: number;
}

export type DistributeModalSkin = 'dashboard' | 'wallets';

export interface DistributeModalProps {
  /** Candidate wallets. Both the funding wallet (unless `lockedSourceId` is
   *  set) and every eligible destination come from this list. */
  wallets: DistributeWalletOption[];
  onClose: () => void;
  /** Cosmetic only — see file header. Defaults to the dashboard look. */
  skin?: DistributeModalSkin;
  /** Fixes the funding wallet to this id and replaces the Step 1 picker with
   *  a static readout. Used by the wallet-detail page, where the page's own
   *  wallet is always the source and re-picking it makes no sense. */
  lockedSourceId?: string;
  /** Reserves a "Send Funds / Send NFT" tab bar for a later NFT-transfer tab
   *  (tracked separately). Only Send Funds is implemented here — the NFT tab
   *  renders disabled. Off by default so the two original call sites keep
   *  looking exactly as they did before this file existed. */
  enableTabs?: boolean;
}

type DistStep = 1 | 2 | 3;
const DIST_STEPS = ['Select & Amounts', 'Confirm', 'Process'] as const;

const LABEL_S: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)',
  display: 'block', marginBottom: '6px',
};

/** Skin-specific constants. Every value here is copied verbatim from one of
 *  the two original modals — nothing was invented or "improved". */
const SKIN: Record<DistributeModalSkin, {
  accent: string;
  onAccent: string;
  submittingColor: string;
  placeholderClass: string;
  unit: 'icon' | 'text';
  /** Dashboard's Confirm & Send button stayed green even while disabled
   *  (an existing quirk, not something introduced here). Wallets page greys
   *  it out. Preserved as-is on both sides. */
  step2ConfirmGreysOut: boolean;
  step3ButtonStyle: 'filled' | 'outline';
  /** Chars shown before the "…" in the Step 2 "From" subtitle. */
  fromAddrPrefixLen: number;
  /** Step 2 destination rows: full address (dashboard) or shortened (wallets). */
  destAddrFull: boolean;
  checkboxBorderIdle: string;
}> = {
  dashboard: {
    accent: '#BEFF00', onAccent: '#000000', submittingColor: '#FBBF24',
    placeholderClass: 'placeholder-[#3a3a3a]', unit: 'icon',
    step2ConfirmGreysOut: false, step3ButtonStyle: 'filled',
    fromAddrPrefixLen: 10, destAddrFull: true,
    checkboxBorderIdle: 'var(--wr-border-hover)',
  },
  wallets: {
    accent: '#7c5cff', onAccent: '#0b0c14', submittingColor: '#ffb020',
    placeholderClass: 'placeholder-[#232533]', unit: 'text',
    step2ConfirmGreysOut: true, step3ButtonStyle: 'outline',
    fromAddrPrefixLen: 6, destAddrFull: false,
    checkboxBorderIdle: '#232533',
  },
};

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function ModalBackdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>
  );
}

function UnitLabel({ skin, size = 10 }: { skin: DistributeModalSkin; size?: number }) {
  return SKIN[skin].unit === 'icon'
    ? <EthIcon size={size} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
    : <span style={{ marginLeft: 2 }}>ETH</span>;
}

export default function DistributeModal({
  wallets, onClose, skin = 'dashboard', lockedSourceId, enableTabs = false,
}: DistributeModalProps) {
  const c = SKIN[skin];
  const [tab, setTab] = useState<'funds' | 'nft'>('funds');
  const [step, setStep] = useState<DistStep>(1);
  const [sourceId, setSourceId] = useState(lockedSourceId ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 'equal' = one shared input; 'custom' = per-wallet inputs
  const [amountMode, setAmountMode] = useState<'equal' | 'custom'>('equal');
  const [equalAmount, setEqualAmount] = useState('');
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [sendRows, setSendRows] = useState<SendRow[]>([]);
  const [sending, setSending] = useState(false);
  const [previews, setPreviews] = useState<Record<string, TransactionPreview>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [distKey, setDistKey] = useState('');
  const sendStartedRef = useRef(false);
  const [linkOpenError, setLinkOpenError] = useState<string | null>(null);

  async function openInBrowser(url: string) {
    setLinkOpenError(null);
    try {
      await openExternalUrl(url);
    } catch (e) {
      setLinkOpenError(`Could not open the default browser: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Custom source dropdown (dashboard skin only) — click-outside-to-close.
  const [sourceOpen, setSourceOpen] = useState(false);
  const sourceDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sourceOpen) return;
    const handler = (e: MouseEvent) => {
      if (sourceDropdownRef.current && !sourceDropdownRef.current.contains(e.target as Node)) {
        setSourceOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sourceOpen]);

  const source = wallets.find(w => w.id === sourceId);
  // Destinations = every wallet whose ADDRESS differs from the source's.
  // Address-based, not id-based: two wallet entries can share one imported
  // address, and an id-only filter would let the second one through as a
  // "destination" that is really the same wallet — gas spent, nothing moved.
  const destWallets = wallets.filter(w => !source || w.address.toLowerCase() !== source.address.toLowerCase());

  const toggleDest = (id: string) => setSelected(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const getAmount = (id: string) =>
    amountMode === 'equal' ? equalAmount : (customAmounts[id] ?? '');

  const selectedList = destWallets.filter(w => selected.has(w.id));
  const totalEth = selectedList.reduce((acc, w) => {
    const v = parseFloat(getAmount(w.id));
    return acc + (isNaN(v) ? 0 : v);
  }, 0);

  const step1Valid =
    !!sourceId &&
    selected.size > 0 &&
    (amountMode === 'equal'
      ? parseFloat(equalAmount) > 0
      : selectedList.every(w => parseFloat(customAmounts[w.id] ?? '') > 0));

  // Belt-and-suspenders: the address-based filter above already keeps a
  // same-address entry out of `destWallets`, so this only fires in the edge
  // case where the source changes *after* a same-address wallet was already
  // selected. Never silent — if it can happen, it is said out loud.
  const selfSendWarnings = source
    ? selectedList
        .filter(w => w.address.toLowerCase() === source.address.toLowerCase())
        .map(w => `${w.name}: this destination is the same address as the source. The transfer would only cost gas.`)
    : [];

  useEffect(() => { loadAlchemyKey().then(k => setDistKey(k ?? '')).catch(() => setDistKey('')); }, []);

  // Envelope verdict per destination. `preview_transaction` has no side effects,
  // so re-running it costs nothing and spends nothing.
  useEffect(() => {
    if (step !== 2) return;
    let cancelled = false;
    (async () => {
      setPreviewBusy(true); setPreviewError(null);
      try {
        const out: Record<string, TransactionPreview> = {};
        for (const w of selectedList) {
          const wei = parseEthToWei(getAmount(w.id));
          if (wei == null) continue;
          out[w.id] = await previewTransaction({ to: w.address, valueWei: wei.toString() });
        }
        if (!cancelled) setPreviews(out);
      } catch (e) {
        if (!cancelled) setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewBusy(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const canSend = !!source && !!distKey && !previewBusy && !previewError &&
    selectedList.length > 0 && selectedList.every(w => previews[w.id]?.authorized === true);

  async function startSend() {
    // A ref, not `sending`: state updates are async and a double-click in the
    // same tick would otherwise broadcast twice.
    if (!canSend || sendStartedRef.current || !source) return;
    sendStartedRef.current = true;
    const rows: SendRow[] = [];
    for (const w of selectedList) {
      const wei = parseEthToWei(getAmount(w.id));
      if (wei == null) continue;
      rows.push({ id: w.id, name: w.name, address: w.address, valueWei: wei, state: 'queued' });
    }
    if (rows.length === 0) { sendStartedRef.current = false; return; }
    setSendRows(rows); setSending(true); setStep(3);
    await runDistribution(source.address, rows, distKey, setSendRows);
    setSending(false);
  }

  const AMOUNT_INPUT: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface-alt)', border: 'none',
    padding: '5px 8px', outline: 'none', width: '60px', textAlign: 'right',
  };

  const tabBtnBase: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
    letterSpacing: '0.5px', textTransform: 'uppercase', padding: '8px 4px',
    background: 'none', border: 'none', borderBottom: '2px solid transparent', marginBottom: '-1px',
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        style={{ width: '500px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Distribute Funds</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '4px' }}>
          Send ETH from one wallet to one or more destinations
        </p>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '20px', lineHeight: 1.5 }}>
          The source wallet never appears in the destination list below — even if another entry shares its address.
        </p>

        {enableTabs && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '18px', borderBottom: '1px solid var(--wr-border)' }}>
            <button
              type="button"
              onClick={() => setTab('funds')}
              style={{ ...tabBtnBase, color: tab === 'funds' ? 'var(--wr-text)' : 'var(--wr-text-3)', borderBottomColor: tab === 'funds' ? c.accent : 'transparent', cursor: 'pointer' }}
            >
              Send Funds
            </button>
            <button
              type="button"
              disabled
              title="Send NFT — not available yet"
              style={{ ...tabBtnBase, color: 'var(--wr-text-4)', cursor: 'not-allowed' }}
            >
              Send NFT
            </button>
          </div>
        )}

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
          {DIST_STEPS.map((label, i) => {
            const n = (i + 1) as DistStep;
            const done = n < step;
            const active = n === step;
            return (
              <React.Fragment key={n}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <div style={{
                    width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
                    backgroundColor: active || done ? c.accent : 'var(--wr-overlay)',
                    border: `1px solid ${active || done ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
                    color: active || done ? c.onAccent : 'var(--wr-text-3)',
                  }}>{done ? '✓' : n}</div>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: active ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>{label}</span>
                </div>
                {i < 2 && (
                  <div style={
                    skin === 'dashboard'
                      ? { flex: 1, height: '1px', backgroundColor: done ? c.accent : 'var(--wr-border)', margin: '0 10px' }
                      : { width: '28px', height: '1px', backgroundColor: done ? c.accent : 'var(--wr-border)', margin: '0 8px' }
                  } />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Source */}
            <div>
              <label style={LABEL_S}>From (funding wallet)</label>
              {lockedSourceId ? (
                <div style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
                  backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 12px',
                }}>
                  {source ? `${source.name} — ${shortAddr(source.address)}` : 'Wallet not found'}
                </div>
              ) : skin === 'dashboard' ? (
                <div ref={sourceDropdownRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setSourceOpen(o => !o)}
                    style={{
                      fontFamily: 'var(--font-jetbrains)', fontSize: '12px',
                      color: sourceId ? 'var(--wr-text)' : 'var(--wr-text-3)',
                      backgroundColor: 'var(--wr-surface-alt)', border: `1px solid ${sourceOpen ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
                      padding: '10px 36px 10px 12px', width: '100%', outline: 'none',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {sourceId
                      ? (() => { const w = wallets.find(w => w.id === sourceId); return w ? `${w.name} — ${shortAddr(w.address)}` : 'Choose a wallet…'; })()
                      : 'Choose a wallet…'
                    }
                  </button>
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: `translateY(-50%) rotate(${sourceOpen ? '180' : '0'}deg)`, color: 'var(--wr-text-3)', fontSize: '10px', pointerEvents: 'none', transition: 'transform 0.15s' }}>▾</span>
                  {sourceOpen && (
                    <div style={{
                      position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 100,
                      backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    }}>
                      {wallets.map(w => (
                        <div
                          key={w.id}
                          onClick={() => {
                            setSourceId(w.id);
                            setSelected(s => { const n = new Set(s); n.delete(w.id); return n; });
                            setSourceOpen(false);
                          }}
                          style={{
                            fontFamily: 'var(--font-jetbrains)', fontSize: '12px',
                            color: w.id === sourceId ? 'var(--wr-accent)' : 'var(--wr-text)',
                            backgroundColor: w.id === sourceId ? 'var(--wr-accent-dim)' : 'transparent',
                            padding: '9px 12px', cursor: 'pointer',
                            borderBottom: '1px solid var(--wr-border)',
                          }}
                          onMouseEnter={e => { if (w.id !== sourceId) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-surface-alt)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = w.id === sourceId ? 'var(--wr-accent-dim)' : 'transparent'; }}
                        >
                          {w.name} — {shortAddr(w.address)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <select
                    value={sourceId}
                    onChange={e => { setSourceId(e.target.value); setSelected(s => { const n = new Set(s); n.delete(e.target.value); return n; }); }}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: sourceId ? '#f2f2f7' : '#6e7590', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 36px 10px 12px', width: '100%', outline: 'none', appearance: 'none', cursor: 'pointer' }}
                  >
                    <option value="" disabled>Choose a wallet…</option>
                    {wallets.map(w => <option key={w.id} value={w.id}>{w.name} — {shortAddr(w.address)}</option>)}
                  </select>
                  <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--wr-text-3)', fontSize: '10px', pointerEvents: 'none' }}>▾</span>
                </div>
              )}
            </div>

            {skin === 'dashboard' ? (
              <>
                {/* TO: wallet grid */}
                <div>
                  <label style={{ ...LABEL_S, marginBottom: '8px' }}>To</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', opacity: !sourceId ? 0.4 : 1 }}>
                    {destWallets.map(w => {
                      const isChecked = selected.has(w.id);
                      return (
                        <div
                          key={w.id}
                          onClick={() => sourceId && toggleDest(w.id)}
                          style={{
                            backgroundColor: isChecked ? 'var(--wr-accent-dim)' : 'var(--wr-surface-alt)',
                            border: `1px solid ${isChecked ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
                            padding: '8px 10px',
                            cursor: sourceId ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <div className="flex items-center gap-2" style={{ marginBottom: '3px' }}>
                            <div style={{
                              width: '13px', height: '13px', flexShrink: 0,
                              backgroundColor: isChecked ? c.accent : 'transparent',
                              border: `1px solid ${isChecked ? 'var(--wr-accent)' : c.checkboxBorderIdle}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '8px', color: c.onAccent,
                            }}>{isChecked ? '✓' : ''}</div>
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                          </div>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginLeft: '19px' }}>{shortAddr(w.address)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* AMOUNT — shown after wallets are selected */}
                {selected.size > 0 && (
                  <div>
                    <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                      <label style={{ ...LABEL_S, marginBottom: 0 }}>Amount</label>
                      <div className="flex" style={{ border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
                        {(['equal', 'custom'] as const).map(m => (
                          <button key={m} onClick={() => setAmountMode(m)} style={{
                            fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                            padding: '3px 10px',
                            backgroundColor: amountMode === m ? c.accent : 'var(--wr-surface-alt)',
                            color: amountMode === m ? c.onAccent : 'var(--wr-text-3)',
                            border: 'none', cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
                          }}>{m === 'equal' ? 'Equal' : 'Custom'}</button>
                        ))}
                      </div>
                    </div>

                    {amountMode === 'equal' ? (
                      <div className="flex items-center justify-between" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '8px 12px' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Amount per wallet</span>
                        <div className="flex items-center" style={{ border: '1px solid var(--wr-border)' }}>
                          <input type="text" inputMode="decimal" value={equalAmount} onChange={e => setEqualAmount(e.target.value)}
                            placeholder="0.00" className={c.placeholderClass} style={AMOUNT_INPUT} />
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '0 8px', borderLeft: '1px solid var(--wr-border)', lineHeight: '28px' }}>
                            <UnitLabel skin={skin} />
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {selectedList.map(w => (
                          <div key={w.id} className="flex items-center justify-between" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 12px' }}>
                            <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', color: 'var(--wr-text)' }}>{w.name}</span>
                            <div className="flex items-center" style={{ border: '1px solid var(--wr-border)' }}>
                              <input type="text" inputMode="decimal" value={customAmounts[w.id] ?? ''} onChange={e => setCustomAmounts(a => ({ ...a, [w.id]: e.target.value }))}
                                placeholder="0.00" className={c.placeholderClass} style={{ ...AMOUNT_INPUT, width: '70px' }} />
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', padding: '0 6px', borderLeft: '1px solid var(--wr-border)', lineHeight: '26px' }}>
                                <UnitLabel skin={skin} />
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div>
                <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
                  <label style={{ ...LABEL_S, marginBottom: 0 }}>To</label>
                  <div className="flex" style={{ border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
                    {(['equal', 'custom'] as const).map(m => (
                      <button key={m} onClick={() => setAmountMode(m)} style={{
                        fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                        padding: '3px 10px', backgroundColor: amountMode === m ? c.accent : 'var(--wr-surface-alt)',
                        color: amountMode === m ? c.onAccent : 'var(--wr-text-3)', border: 'none', cursor: 'pointer', textTransform: 'uppercase',
                      }}>{m === 'equal' ? 'Equal' : 'Custom'}</button>
                    ))}
                  </div>
                </div>

                {amountMode === 'equal' && (
                  <div className="flex items-center justify-between" style={{ marginBottom: '8px', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '8px 12px' }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Amount per wallet</span>
                    <div className="flex items-center" style={{ border: '1px solid var(--wr-border)' }}>
                      <input type="text" inputMode="decimal" value={equalAmount} onChange={e => setEqualAmount(e.target.value)}
                        placeholder="0.00" className={c.placeholderClass} style={AMOUNT_INPUT} />
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '0 8px', borderLeft: '1px solid var(--wr-border)', lineHeight: '28px' }}>ETH</span>
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', opacity: !sourceId ? 0.4 : 1 }}>
                  {destWallets.map(w => {
                    const isChecked = selected.has(w.id);
                    return (
                      <div key={w.id} onClick={() => sourceId && toggleDest(w.id)} style={{
                        backgroundColor: isChecked ? 'var(--wr-accent-dim)' : 'var(--wr-surface-alt)',
                        border: `1px solid ${isChecked ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
                        padding: '8px 10px', cursor: sourceId ? 'pointer' : 'not-allowed',
                      }}>
                        <div className="flex items-center gap-2" style={{ marginBottom: '3px' }}>
                          <div style={{ width: '13px', height: '13px', flexShrink: 0, backgroundColor: isChecked ? c.accent : 'transparent', border: `1px solid ${isChecked ? 'var(--wr-accent)' : c.checkboxBorderIdle}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: c.onAccent }}>{isChecked ? '✓' : ''}</div>
                          <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginLeft: '19px' }}>{shortAddr(w.address)}</div>
                        {amountMode === 'custom' && isChecked && (
                          <div className="flex items-center" style={{ marginTop: '6px', border: '1px solid var(--wr-border)' }} onClick={e => e.stopPropagation()}>
                            <input type="text" inputMode="decimal" value={customAmounts[w.id] ?? ''} onChange={e => setCustomAmounts(a => ({ ...a, [w.id]: e.target.value }))}
                              placeholder="0.00" className={c.placeholderClass} style={{ ...AMOUNT_INPUT, width: '100%', flex: 1 }} />
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', padding: '0 6px', borderLeft: '1px solid var(--wr-border)', lineHeight: '26px', whiteSpace: 'nowrap' }}>ETH</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Footer */}
            <div style={{ display: 'flex', gap: '8px', paddingTop: '4px', borderTop: '1px solid var(--wr-border)' }}>
              <button onClick={onClose} style={{
                flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
                color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
                padding: '11px 0', cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={() => step1Valid && setStep(2)} style={{
                flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: step1Valid ? c.onAccent : 'var(--wr-text-4)',
                backgroundColor: step1Valid ? c.accent : 'var(--wr-overlay)',
                border: 'none', padding: '11px 0',
                cursor: step1Valid ? 'pointer' : 'not-allowed',
              }}>
                Review {selected.size > 0 ? `(${selected.size} wallet${selected.size > 1 ? 's' : ''})` : ''}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Source */}
            <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 14px', marginBottom: '4px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '4px' }}>From</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)' }}>{source?.name}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>
                    {source ? `${source.address.slice(0, c.fromAddrPrefixLen)}…${source.address.slice(-4)}` : ''}
                  </div>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-2)' }}>
                  {source?.usdValue != null ? `$${source.usdValue.toLocaleString()}` : '—'}
                </span>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>Sending To</div>

            {selfSendWarnings.length > 0 && (
              <div style={{ border: '1px solid rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.06)', padding: '10px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-warn)', lineHeight: 1.6 }}>
                {selfSendWarnings.map((w, i) => <div key={i} style={{ marginTop: i ? '3px' : 0 }}>· {w}</div>)}
              </div>
            )}

            {selectedList.map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 14px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)' }}>{w.name}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{c.destAddrFull ? w.address : shortAddr(w.address)}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-accent)' }}>
                  {getAmount(w.id)} <UnitLabel skin={skin} />
                </span>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--wr-border)' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Total</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, color: 'var(--wr-text)' }}>{totalEth.toFixed(4)} <UnitLabel skin={skin} /></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 8px' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Gas estimate</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)' }}>~0.002 <UnitLabel skin={skin} /></span>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button onClick={() => setStep(1)} style={{
                flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
                color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
                padding: '11px 0', cursor: 'pointer',
              }}>Back</button>
              <button
                onClick={startSend}
                disabled={!canSend}
                style={{
                  flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                  color: c.step2ConfirmGreysOut ? (canSend ? c.onAccent : 'var(--wr-text-4)') : c.onAccent,
                  backgroundColor: c.step2ConfirmGreysOut ? (canSend ? c.accent : 'var(--wr-overlay)') : c.accent,
                  border: c.step2ConfirmGreysOut && !canSend ? '1px solid var(--wr-border)' : 'none',
                  padding: '11px 0', cursor: canSend ? 'pointer' : 'not-allowed',
                }}
              >{previewBusy ? 'Checking…' : 'Confirm & Send'}</button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="flex flex-col items-center" style={{ padding: '20px 0 16px', gap: '10px' }}>
              <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>{sending ? '⚡' : '✓'}</div>
              <div style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>{sending ? 'Signing and broadcasting' : 'Done'}</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textAlign: 'center' }}>
                {sending
                  ? 'One at a time — a second send from the same address would reuse the nonce.'
                  : 'A transaction hash means the network accepted it. Confirmation still takes a block or two.'}
              </div>
            </div>
            {sendRows.map(r => {
              const rowLabel = r.state === 'broadcast' ? 'Broadcast' : r.state === 'submitting' ? 'Signing…' : r.state === 'failed' ? 'Failed' : r.state === 'skipped' ? 'Not sent' : 'Queued';
              const rowColor = r.state === 'broadcast' ? 'var(--wr-accent)' : r.state === 'submitting' ? c.submittingColor : r.state === 'failed' ? '#ff8a96' : 'var(--wr-text-3)';
              return (
                <div key={r.id} style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{r.name}</div>
                      <div style={{ color: 'var(--wr-text-3)', fontSize: '10px', fontFamily: 'var(--font-jetbrains)', marginTop: '2px' }}>
                        {formatWeiToEth(r.valueWei)} <UnitLabel skin={skin} /> → {r.address.slice(0, 6)}…{r.address.slice(-4)}
                      </div>
                    </div>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: rowColor, whiteSpace: 'nowrap' }}>{rowLabel}</span>
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
            <button disabled={sending}
              onClick={() => { sendStartedRef.current = false; setStep(1); setSourceId(lockedSourceId ?? ''); setSelected(new Set()); setEqualAmount(''); setCustomAmounts({}); setSendRows([]); setPreviews({}); onClose(); }}
              style={
                c.step3ButtonStyle === 'filled'
                  ? {
                      width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                      color: sending ? 'var(--wr-text-4)' : c.onAccent,
                      backgroundColor: sending ? 'var(--wr-overlay)' : c.accent,
                      border: 'none', padding: '11px 0', cursor: sending ? 'not-allowed' : 'pointer', marginTop: '8px',
                    }
                  : {
                      width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
                      color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
                      padding: '11px 0', cursor: sending ? 'not-allowed' : 'pointer', marginTop: '8px',
                    }
              }>{sending ? 'Working…' : 'Done'}</button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}
