'use client';

import { useState } from 'react';
import Link from 'next/link';
import ProGate from '@/components/ProGate';
import { loadAddressBook, type AddressEntry } from '@/lib/addressBook';

// ─── Distribute Funds ─────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;
type DistMode = 'equal' | 'custom';

const STEP_LABELS = ['Select & Amounts', 'Confirm', 'Process'] as const;

const MOCK_WALLETS = [
  { id: 'main',   name: 'Main Wallet',  address: '0x3f4a6e…a91c', eth: 4.2819,  weth: 1.5000 },
  { id: 'defi',   name: 'DeFi Wallet',  address: '0x1234…7890',   eth: 0.8340,  weth: 3.2100 },
  { id: 'emir1',  name: 'Emir 1',       address: '0xb29a…7a1e',   eth: 0.1205,  weth: 0.0000 },
  { id: 'burner', name: 'burner1',      address: '0xca7d…fd2a',   eth: 0.0500,  weth: 0.0000 },
];

const SOURCE_WALLETS = [
  { id: 'cold',  label: 'Cold Storage — 0xabcd…ef12', eth: 12.4400, weth: 0.0000 },
  { id: 'main',  label: 'Main Wallet — 0x3f4a…a91c',  eth: 4.2819,  weth: 1.5000 },
  { id: 'defi',  label: 'DeFi Wallet — 0x1234…7890',  eth: 0.8340,  weth: 3.2100 },
];

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
                backgroundColor: done || active ? '#BEFF00' : 'var(--wr-surface-alt)',
                border: `1px solid ${active || done ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
                color: active || done ? '#000000' : 'var(--wr-text-3)',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: active ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
                {label}
              </span>
            </div>
            {i < 2 && <div style={{ flex: 1, height: '1px', backgroundColor: done ? '#BEFF00' : 'var(--wr-border)', margin: '0 12px' }} />}
          </div>
        );
      })}
    </div>
  );
}

export default function DistributeFundsPage() {
  const [step, setStep] = useState<Step>(1);

  // Step 1 state
  const [source, setSource] = useState('cold');
  const [selected, setSelected] = useState<Set<string>>(new Set(['main', 'defi', 'emir1', 'burner']));
  const [mode, setMode] = useState<DistMode>('equal');
  const [amountEqual, setAmountEqual] = useState('');
  const [amountCustom, setAmountCustom] = useState<Record<string, string>>({});

  const addressBookEntries = loadAddressBook();
  const [abSelected, setAbSelected] = useState<Set<string>>(new Set());
  const [abAmounts, setAbAmounts] = useState<Record<string, string>>({});

  const toggleWallet = (id: string) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAb = (id: string) =>
    setAbSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectedList = MOCK_WALLETS.filter(w => selected.has(w.id));
  const abSelectedList = addressBookEntries.filter(e => abSelected.has(e.id));
  const totalSelected = selected.size + abSelected.size;

  const canReview = !!source && totalSelected > 0 && (
    mode === 'equal'
      ? !!amountEqual && parseFloat(amountEqual) > 0
      : selectedList.every(w => !!amountCustom[w.id] && parseFloat(amountCustom[w.id]) > 0) &&
        abSelectedList.every(e => !!abAmounts[e.id] && parseFloat(abAmounts[e.id]) > 0)
  );

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
          {selectedList.map((w, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
              <div>
                <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{w.address}</div>
                <div style={{ color: 'var(--wr-text-3)', fontSize: '11px', fontFamily: 'var(--font-jetbrains)', marginTop: '2px' }}>
                  {mode === 'equal' ? amountEqual : (amountCustom[w.id] ?? '0')} ETH
                </div>
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: i === 0 ? '#FBBF24' : 'var(--wr-text-3)' }}>
                {i === 0 ? 'Processing' : 'Pending'}
              </span>
            </div>
          ))}
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
                    {SOURCE_WALLETS.map(w => (
                      <option key={w.id} value={w.id}>{w.label}</option>
                    ))}
                  </select>
                  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
                    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--wr-text-3)' as never }}/>
                  </svg>
                </div>
                {/* Source balance */}
                {(() => {
                  const sw = SOURCE_WALLETS.find(w => w.id === source);
                  if (!sw) return null;
                  return (
                    <div style={{ display: 'flex', gap: '16px', marginTop: '7px', paddingLeft: '2px' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                        <span style={{ color: 'var(--wr-text-4)', marginRight: '4px' }}>ETH</span>
                        <span style={{ color: 'var(--wr-text)', fontWeight: 600 }}>{sw.eth.toFixed(4)}</span>
                      </span>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
                        <span style={{ color: 'var(--wr-text-4)', marginRight: '4px' }}>WETH</span>
                        <span style={{ color: sw.weth > 0 ? 'var(--wr-text)' : 'var(--wr-text-4)', fontWeight: 600 }}>{sw.weth.toFixed(4)}</span>
                      </span>
                    </div>
                  );
                })()}
              </div>

              {/* TO — wallet grid */}
              <div>
                <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '10px' }}>
                  To
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  {MOCK_WALLETS.map(w => {
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
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{w.address}</div>
                          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px' }}>
                              <span style={{ color: 'var(--wr-text-4)' }}>ETH </span>
                              <span style={{ color: 'var(--wr-text-2)', fontWeight: 600 }}>{w.eth.toFixed(3)}</span>
                            </span>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px' }}>
                              <span style={{ color: 'var(--wr-text-4)' }}>WETH </span>
                              <span style={{ color: w.weth > 0 ? 'var(--wr-text-2)' : 'var(--wr-text-4)', fontWeight: 600 }}>{w.weth.toFixed(3)}</span>
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
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#BEFF00', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
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
                          color: mode === m ? '#000000' : 'var(--wr-text-3)',
                          transition: 'background-color 0.1s',
                        }}
                      >
                        {m === 'equal' ? 'Equal' : 'Custom'}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === 'equal' ? (
                  <div style={{ display: 'flex', border: '1px solid var(--wr-border)' }}>
                    <input
                      type="number"
                      placeholder="Amount per wallet"
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
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedList.map(w => (
                      <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '90px', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                        <div style={{ flex: 1, display: 'flex', border: '1px solid var(--wr-border)' }}>
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
                    ))}
                    {abSelectedList.map(ab => (
                      <div key={ab.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '90px', flexShrink: 0, overflow: 'hidden' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.name}</span>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#BEFF00', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                        </div>
                        <div style={{ flex: 1, display: 'flex', border: '1px solid var(--wr-border)' }}>
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
                    ))}
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
                  style={{ flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: canReview ? '#000000' : 'var(--wr-text-4)', backgroundColor: canReview ? '#BEFF00' : 'var(--wr-overlay)', border: `1px solid ${canReview ? '#BEFF00' : 'var(--wr-border)'}`, padding: '11px 0', cursor: canReview ? 'pointer' : 'not-allowed' }}
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
              {selectedList.map((w, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2.5" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
                  <div>
                    <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{w.name}</div>
                    <div style={{ color: 'var(--wr-text-3)', fontSize: '10px', fontFamily: 'var(--font-jetbrains)' }}>{w.address}</div>
                  </div>
                  <span style={{ color: 'var(--wr-accent)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', fontWeight: 600 }}>
                    {mode === 'equal' ? amountEqual : (amountCustom[w.id] ?? '0')} ETH
                  </span>
                </div>
              ))}
              {abSelectedList.map((ab, i) => (
                <div key={ab.id} className="flex items-center justify-between px-3 py-2.5" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{ab.name}</span>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#BEFF00', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
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
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)' }}>~0.004 ETH</span>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => setStep(1)} style={{ flex: 1, backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, padding: '10px 0', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>Back</button>
                <button onClick={() => setStep(3)} style={{ flex: 2, backgroundColor: '#BEFF00', color: '#000000', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, padding: '10px 0', border: 'none', cursor: 'pointer' }}>Confirm & Send</button>
              </div>
            </div>
          )}

          {/* ── Step 3: Processing ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="flex flex-col items-center py-6 gap-3">
                <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px' }}>⚡</div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Processing</div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textAlign: 'center' }}>Transactions are being submitted to the network</div>
              </div>
              <button onClick={() => { setStep(1); setAmountEqual(''); setAmountCustom({}); setAbAmounts({}); setAbSelected(new Set()); setSelected(new Set(['main', 'defi', 'emir1', 'burner'])); }}
                style={{ width: '100%', backgroundColor: 'transparent', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, padding: '10px 0', border: '1px solid var(--wr-border)', cursor: 'pointer' }}>
                New Distribution
              </button>
            </div>
          )}
        </div>

        {/* Right panel — tx monitor */}
        <TxPanel />
      </div>
    </main>
    </ProGate>
  );
}
