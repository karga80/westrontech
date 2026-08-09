'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef } from 'react';
import {
  getPortfolioSnapshot, getAssetTransfers, loadAlchemyKey, startBackgroundPolling,
  realtimeInit, realtimeSetWatchSet, getPnlSummary,
  type AssetTransfer, type PortfolioSnapshot, type PnlSummary,
} from '@/lib/tauri';
import { useWalletTxStream, useConnectionState } from '@/hooks/useRealtime';
import { loadWallets, loadOwnedWallets, addWallet as persistWallet, removeWallet as deleteWallet, updateWallet as updateWalletInStore, type StoredWallet } from '@/lib/walletStore';
import { Tag, TX_TYPE_VARIANT, WALLET_TOKEN_VARIANT } from '@/components/Tag';
import { importWallet } from '@/lib/tauri';
import { normalizeKey } from '@/lib/walletImport';
import DistributeModal from '@/components/DistributeModal';
import { formatBlockNum, parseHexBlock, formatChangePct } from '@/lib/formatters';

// ─── Daily snapshot helpers (24h change) ──────────────────────────────────────

const DAILY_SNAP_KEY = 'westron_daily_snap';
interface DailySnap { date: string; values: Record<string, number> }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function loadDailySnap(): DailySnap | null {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(DAILY_SNAP_KEY) ?? 'null'); } catch { return null; }
}
function writeDailySnap(snap: DailySnap) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DAILY_SNAP_KEY, JSON.stringify(snap));
}

/** Number of transactions shown in the collapsed preview before "Show all". */
const PREVIEW_COUNT = 5;

interface Wallet {
  id: string; name: string; address: string; rawAddress: string; badge: string;
  usdValue: number; change: number; changePct: number;
  nfts: number; floorPnl: number; coins: number; pnl: number;
}

interface Tx {
  hash: string; type: keyof typeof TX_TYPE_VARIANT; block: string;
  age: string; from: string; to: string; token: string; amount: string; gas: string;
}


// ─── Live data helpers ──────────────────────────────────────────────────────

// Map Alchemy AssetTransfer → internal Tx shape
function mapTransfer(t: AssetTransfer, walletAddress: string): Tx {
  const blockDec = parseHexBlock(t.block_num);
  const isOutgoing = t.from.toLowerCase() === walletAddress.toLowerCase();
  const typeMap: Record<string, keyof typeof TX_TYPE_VARIANT> = {
    external: isOutgoing ? 'Sent' : 'Receive',
    erc20:    'Swap Buy',
    erc721:   isOutgoing ? 'NFT Sent' : 'NFT Buy',
    erc1155:  isOutgoing ? 'NFT Sent' : 'NFT Buy',
  };
  const type = typeMap[t.category] ?? 'Contract Interaction';

  let age = '—';
  if (t.metadata?.block_timestamp) {
    const ms = Date.now() - new Date(t.metadata.block_timestamp).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) age = `${s}s ago`;
    else if (s < 3600) age = `${Math.floor(s / 60)}m ago`;
    else if (s < 86400) age = `${Math.floor(s / 3600)}h ago`;
    else age = `${Math.floor(s / 86400)}d ago`;
  }

  const amount = t.value !== undefined
    ? `${t.value} ${t.asset ?? (t.category === 'external' ? 'ETH' : t.category.toUpperCase())}`
    : '—';

  return {
    hash: t.hash,
    type,
    block: isNaN(blockDec) ? t.block_num : blockDec.toLocaleString(),
    age,
    from: t.from,
    to: t.to ?? '—',
    token: t.asset ?? (t.category === 'erc721' || t.category === 'erc1155' ? 'NFT' : 'ETH'),
    amount,
    gas: '—',
  };
}

// Build a Wallet display object from stored wallet + live snapshot
function buildWallet(stored: StoredWallet, snap: PortfolioSnapshot | null, baselineUsd: number | null): Wallet {
  const currentUsd = snap?.portfolio_value_usd ?? 0;
  const change = baselineUsd != null ? currentUsd - baselineUsd : 0;
  const changePct = baselineUsd != null && baselineUsd > 0 ? (change / baselineUsd) * 100 : 0;
  return {
    id: stored.id,
    name: stored.name,
    address: stored.address.length > 12
      ? `${stored.address.slice(0, 6)}…${stored.address.slice(-4)}`
      : stored.address,
    rawAddress: stored.address,
    badge: 'ETH',
    usdValue:  currentUsd,
    change,
    changePct,
    nfts:      snap?.nft_count ?? 0,
    floorPnl:  0,
    coins:     snap?.token_count ?? 0,
    pnl:       0,
  };
}

function pnlColor(n: number) { return n >= 0 ? 'var(--wr-accent)' : '#f87171'; }
function pnlText(n: number) {
  const abs = Math.abs(n).toLocaleString();
  return n >= 0 ? `+$${abs}` : `-$${abs}`;
}

// ─── Section Label ──────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: 'var(--font-jetbrains)',
      fontSize: '14px',
      fontWeight: 700,
      color: 'var(--wr-accent)',
      letterSpacing: '2px',
      textTransform: 'uppercase',
    }}>
      {children}
    </span>
  );
}

// ─── Edit Wallet Modal ──────────────────────────────────────────────────────

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function EditWalletModal({ wallet, allWallets, onClose, onSaved }: {
  wallet: { id: string; name: string; rawAddress: string };
  allWallets: StoredWallet[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(wallet.name);
  const [address, setAddress] = useState(wallet.rawAddress);
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();

    if (!trimmedName) { setError('Wallet name is required.'); return; }

    const addressChanged = trimmedAddress.toLowerCase() !== wallet.rawAddress.toLowerCase();
    if (addressChanged && !ETH_ADDRESS_RE.test(trimmedAddress)) {
      setError('Invalid Ethereum address.'); return;
    }

    const duplicate = allWallets.some(
      w => w.id !== wallet.id && w.address.toLowerCase() === trimmedAddress.toLowerCase()
    );
    if (duplicate) { setError('This address is already tracked.'); return; }

    updateWalletInStore(wallet.id, { name: trimmedName, address: trimmedAddress });
    onSaved();
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px',
    color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)',
    border: '1px solid var(--wr-border)', padding: '10px 12px',
    outline: 'none', boxSizing: 'border-box',
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        style={{ width: '400px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: '20px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Edit Wallet</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
            Wallet Name
          </label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Main Wallet"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
            Wallet Address
          </label>
          <input
            value={address}
            onChange={e => { setAddress(e.target.value); setError(''); }}
            placeholder="0x..."
            style={{ ...inputStyle, letterSpacing: '0.3px' }}
          />
        </div>

        {error && (
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171', marginBottom: '16px' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{
            flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
            color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
            padding: '11px 0', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSave} style={{
            flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
            color: '#000000', backgroundColor: '#BEFF00', border: 'none',
            padding: '11px 0', cursor: 'pointer',
          }}>Save Changes</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Wallet Card ───────────────────────────────────────────────────────────

function WalletCard({ w, loading, onDelete, onEdit }: { w: Wallet; loading?: boolean; onDelete?: () => void; onEdit?: () => void }) {
  const chg = pnlColor(w.change);
  return (
    <div
      className="flex flex-col border transition-all duration-150"
      style={{ height: '239px', backgroundColor: 'var(--wr-surface)', borderColor: 'var(--wr-border)', position: 'relative' }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--wr-border-hover)';
        el.style.backgroundColor = 'var(--wr-hover-bg)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.borderColor = 'var(--wr-border)';
        el.style.backgroundColor = 'var(--wr-surface)';
      }}
    >
      {/* Loading shimmer */}
      {loading && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: 'var(--wr-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2, borderRadius: 'inherit' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', letterSpacing: '2px' }}>LOADING…</span>
        </div>
      )}

      {/* Clickable area — navigates to wallet detail */}
      <Link href={`/wallet/${w.id}`} style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px', paddingBottom: '12px', textDecoration: 'none', minHeight: 0, background: 'transparent' }}>

      {/* Header */}
      <div className="flex items-center justify-between" style={{ marginBottom: '8px' }}>
        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>
          {w.name}
        </span>
        <Tag variant={WALLET_TOKEN_VARIANT[w.badge] ?? 'neutral'}>{w.badge}</Tag>
      </div>

      {/* Address */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '8px' }}>
        {w.address}
      </div>

      {/* Balance */}
      <div style={{ marginBottom: '4px' }}>
        <div style={{ fontFamily: 'var(--font-inter)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>
          ${w.usdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="flex items-center" style={{ gap: '4px' }}>
          <span style={{ color: chg, fontSize: '10px' }}>{w.change >= 0 ? '↑' : '↓'}</span>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: chg, fontVariantNumeric: 'tabular-nums' }}>
            {w.change >= 0 ? '+' : ''}${Math.abs(w.change).toLocaleString()} ({formatChangePct(w.changePct)})
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-start mt-auto pt-3" style={{ borderTop: '1px solid var(--wr-border)', gap: '0' }}>
        <div className="flex flex-1" style={{ gap: '20px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>NFTs</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>{w.nfts}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>Floor PnL</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: pnlColor(w.floorPnl), fontVariantNumeric: 'tabular-nums' }}>{pnlText(w.floorPnl)}</div>
          </div>
        </div>
        <div style={{ width: '1px', backgroundColor: 'var(--wr-border-hover)', alignSelf: 'stretch', margin: '0 16px' }} />
        <div className="flex flex-1" style={{ gap: '20px' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>COINS</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>{w.coins}</div>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 500, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>PnL</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, color: pnlColor(w.pnl), fontVariantNumeric: 'tabular-nums' }}>{pnlText(w.pnl)}</div>
          </div>
        </div>
      </div>

      </Link>

      {/* Action buttons */}
      <div className="flex" style={{ borderTop: '1px solid var(--wr-border)', height: '27px' }}>
        <button
          className="flex-1 h-full cursor-pointer"
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-hover-bg)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
          onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-border-hover)'; }}
          onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
          onClick={onEdit}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', borderRight: '1px solid var(--wr-border)', borderRadius: 0, transition: 'background-color 0.12s, color 0.12s' }}
        >
          Edit
        </button>
        <button
          className="flex-1 h-full transition-colors cursor-pointer"
          onMouseEnter={e => { const isDay = document.documentElement.getAttribute('data-theme') === 'day'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDay ? 'var(--wr-danger-bg)' : '#2d0a0a'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-danger)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-danger)'; }}
          onMouseDown={e => { const isDay = document.documentElement.getAttribute('data-theme') === 'day'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDay ? '#fecaca' : '#3d0f0f'; }}
          onMouseUp={e => { const isDay = document.documentElement.getAttribute('data-theme') === 'day'; (e.currentTarget as HTMLButtonElement).style.backgroundColor = isDay ? 'var(--wr-danger-bg)' : '#2d0a0a'; }}
          onClick={onDelete}
          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-danger)', backgroundColor: 'transparent', border: 'none', borderRadius: 0, transition: 'background-color 0.12s, color 0.12s' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Tx Type Badge ─────────────────────────────────────────────────────────

function TxBadge({ type }: { type: keyof typeof TX_TYPE_VARIANT }) {
  return <Tag variant={TX_TYPE_VARIANT[type]}>{type}</Tag>;
}

// ─── Modal backdrop ────────────────────────────────────────────────────────

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

// ─── Add Wallet Modal ───────────────────────────────────────────────────────

type AddWalletTab = 'import' | 'watch';

function AddWalletModal({ onClose, onAdded }: { onClose: () => void; onAdded?: () => void }) {
  const [tab, setTab] = useState<AddWalletTab>('import');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const FIELD = {
    fontFamily: 'var(--font-jetbrains)',
    fontSize: '12px',
    color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface-alt)',
    border: '1px solid var(--wr-border)',
    padding: '10px 12px',
    width: '100%',
    outline: 'none',
  } as React.CSSProperties;

  const LABEL = {
    fontFamily: 'var(--font-jetbrains)',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase' as const,
    color: 'var(--wr-text-3)',
    display: 'block',
    marginBottom: '6px',
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <div style={{ width: '420px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Add Wallet</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
          Import an Ethereum wallet or add a watch-only address
        </p>

        {/* Tabs */}
        <div className="flex" style={{ borderBottom: '1px solid var(--wr-border)', marginBottom: '20px' }}>
          {([['import', 'Import Key'], ['watch', 'Watch Address']] as [AddWalletTab, string][]).map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
              padding: '8px 16px', marginBottom: '-1px',
              color: tab === t ? 'var(--wr-accent)' : 'var(--wr-text-3)',
              background: 'none', border: 'none',
              borderBottom: tab === t ? '2px solid var(--wr-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={LABEL}>Wallet Name</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Wallet"
              className="placeholder-[#3a3a3a] focus:border-[#BEFF00]"
              style={FIELD} />
          </div>

          {tab === 'import' ? (
            <div>
              <label style={LABEL}>Private Key</label>
              <input type="password" value={key} onChange={e => setKey(e.target.value)}
                placeholder="0x..."
                className="placeholder-[#3a3a3a] focus:border-[#BEFF00]"
                style={FIELD} />
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
                Your key never leaves this device. Stored in macOS Keychain.
              </div>
            </div>
          ) : (
            <div>
              <label style={LABEL}>Wallet Address</label>
              <input value={address} onChange={e => setAddress(e.target.value)}
                placeholder="0x..."
                className="placeholder-[#3a3a3a] focus:border-[#BEFF00]"
                style={FIELD} />
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '6px' }}>
                Watch-only — no signing. Appears in <strong style={{ color: 'var(--wr-text-2)' }}>Monitor → Wallets</strong> only, not in your dashboard wallet list.
              </div>
            </div>
          )}

          {error && (
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#ff4444', padding: '8px 12px', border: '1px solid #ff444433', backgroundColor: '#ff44440d' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
            <button onClick={onClose} style={{
              flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
              color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
              padding: '11px 0', cursor: 'pointer',
            }}>Cancel</button>
            <button
              className="btn-cta"
              disabled={saving}
              onClick={async () => {
                setError('');
                if (!name.trim()) { setError('Enter a wallet name.'); return; }
                let finalAddress = '';
                if (tab === 'import') {
                  const rawKey = key.trim();
                  if (!rawKey) { setError('Enter a private key.'); return; }
                  try {
                    const { privateKeyToAddress } = await import('viem/accounts');
                    const hex = rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`;
                    finalAddress = privateKeyToAddress(hex as `0x${string}`);
                  } catch {
                    setError('Invalid private key.');
                    return;
                  }
                } else {
                  finalAddress = address.trim();
                  if (!finalAddress) { setError('Enter a wallet address.'); return; }
                  if (!/^0x[0-9a-fA-F]{40}$/.test(finalAddress)) { setError('Invalid Ethereum address.'); return; }
                }
                setSaving(true);
                // Deriving the address is not enough — without import_wallet the
                // private key is never stored and the wallet can never sign.
                // The backend re-derives and returns the authoritative address.
                if (tab === 'import') {
                  try {
                    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
                    if (inTauri) {
                      finalAddress = await importWallet({ private_key_hex: normalizeKey(key) });
                    }
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                    setSaving(false);
                    return;
                  }
                }
                // 'import' tab = private key wallet (owned). 'watch' tab = monitor-only (watched).
                persistWallet({ id: Date.now().toString(), name: name.trim(), address: finalAddress, kind: tab === 'import' ? 'owned' : 'watched' });
                onAdded?.();
                onClose();
              }}
              style={{
                flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: '#000000', backgroundColor: '#BEFF00', border: 'none',
                padding: '11px 0', cursor: 'pointer',
              }}>{tab === 'import' ? 'Import Wallet' : 'Add Watch Wallet'}</button>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ─── Address Cell ──────────────────────────────────────────────────────────

function AddrCell({ addr }: { addr: string }) {
  const match = loadWallets().find(w => w.address.toLowerCase() === addr.toLowerCase());
  if (match) {
    return <Tag variant="neutral">{match.name}</Tag>;
  }
  return (
    <div className="flex items-center min-w-0" style={{ gap: '4px' }}>
      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{addr}</span>
      <span style={{ color: 'var(--wr-text-3)', fontSize: '8px', flexShrink: 0 }}>⊕</span>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

const TX_GRID = '168.5px 168.5px 168.5px 168.5px 168.5px 35px 168.5px 70px 70px 70px';

export default function Dashboard() {
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showDistribute, setShowDistribute] = useState(false);
  const [txExpanded, setTxExpanded] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; name: string; rawAddress: string } | null>(null);

  // ── Live data state ────────────────────────────────────────────────────────
  const [isTauri, setIsTauri] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [storedWallets, setStoredWallets] = useState<StoredWallet[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, PortfolioSnapshot>>({});
  const [liveTransactions, setLiveTransactions] = useState<Tx[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dailyBaseline, setDailyBaseline] = useState<Record<string, number>>({});
  const [pnlSummaries, setPnlSummaries] = useState<Record<string, PnlSummary>>({});

  // Detect Tauri + bootstrap wallets + API key
  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);
    const wallets = loadOwnedWallets();
    setStoredWallets(wallets);
    const storedSnap = loadDailySnap();
    if (storedSnap) setDailyBaseline(storedSnap.values);

    if (inTauri) {
      // If there are no wallets, nothing to load — clear the loading state.
      if (wallets.length === 0) setLoadingData(false);
      loadAlchemyKey()
        .then(k => {
          if (k) setApiKey(k);
          // No API key configured → don't block the UI on a fetch that won't happen.
          else setLoadingData(false);
        })
        .catch(() => { setDataError('Failed to load API key'); setLoadingData(false); });
    } else {
      // Browser / dev mode — use mock data so the UI is never blank
      // Browser mode has no Tauri backend and therefore no data. Showing mock
      // transfers here made an empty app look populated.
      setLiveTransactions([]);
      setLoadingData(false);
    }
  }, []);

  // Fetch live data once API key is available (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    // If there's nothing we can fetch (no key or no wallets), stop the loading
    // state — otherwise wallet cards stay stuck in their loading shimmer.
    if (!apiKey || storedWallets.length === 0) {
      setLoadingData(false);
      return;
    }
    let cancelled = false;
    setLoadingData(true);

    (async () => {
      try {
        // Fetch all snapshots in parallel
        const snapEntries = await Promise.allSettled(
          storedWallets.map(w => getPortfolioSnapshot(w.address, apiKey).then(s => ({ id: w.id, snap: s })))
        );
        if (cancelled) return;
        const newSnaps: Record<string, PortfolioSnapshot> = {};
        snapEntries.forEach(r => { if (r.status === 'fulfilled') newSnaps[r.value.id] = r.value.snap; });
        setSnapshots(newSnaps);

        // Update daily baseline — only writes when the date changes
        const today = todayStr();
        const existingSnap = loadDailySnap();
        if (!existingSnap || existingSnap.date !== today) {
          const baseline: Record<string, number> = {};
          Object.entries(newSnaps).forEach(([id, s]) => { baseline[id] = s.portfolio_value_usd; });
          writeDailySnap({ date: today, values: baseline });
          if (!cancelled) setDailyBaseline(baseline);
        }

        // Fetch PnL for all wallets in background
        Promise.allSettled(
          storedWallets.map(w => getPnlSummary(w.address, apiKey).then(p => ({ id: w.id, pnl: p })))
        ).then(results => {
          if (cancelled) return;
          const map: Record<string, PnlSummary> = {};
          results.forEach(r => { if (r.status === 'fulfilled') map[r.value.id] = r.value.pnl; });
          setPnlSummaries(map);
        }).catch((e: unknown) => { if (!cancelled) setDataError(e instanceof Error ? e.message : 'Failed to load PnL data'); });

        // Fetch transactions for ALL wallets, merge newest-first
        const txResults = await Promise.allSettled(
          storedWallets.map(w =>
            getAssetTransfers(w.address, apiKey).then(transfers =>
              transfers.map(t => mapTransfer(t, w.address))
            )
          )
        );
        if (!cancelled) {
          const seen = new Set<string>();
          const merged: Tx[] = [];
          txResults.forEach(r => {
            if (r.status === 'fulfilled') {
              r.value.forEach(tx => {
                if (!seen.has(tx.hash)) {
                  seen.add(tx.hash);
                  merged.push(tx);
                }
              });
            }
          });
          // Sort by block number descending (Rust already sorted per-wallet; re-sort after merge)
          merged.sort((a, b) => {
            const an = formatBlockNum(a.block);
            const bn = formatBlockNum(b.block);
            return bn - an;
          });
          setLiveTransactions(merged);
        }

        // Start background polling daemon (idempotent — Rust guards against double-start)
        if (!cancelled && storedWallets.length > 0) {
          startBackgroundPolling(storedWallets.map(w => w.address), apiKey).catch(() => {});
        }

        // Bootstrap the new real-time bridge — WebSocket subscriptions for
        // every tracked wallet, so balance refreshes are event-driven instead
        // of timer-driven. Failure here is non-fatal (REST polling remains).
        if (!cancelled && storedWallets.length > 0) {
          try {
            await realtimeInit(apiKey);
            await realtimeSetWatchSet({
              wallets: storedWallets.map(w => w.address),
              collections: [],
              priceSymbols: ['ETH', 'USDC', 'USDT', 'WETH'],
              subscribeBlocks: true,
            });
          } catch (_e) { /* realtime is best-effort — silent failure is acceptable */ }
        }
      } finally {
        // Always release the loading state — never leave the UI stuck if a
        // request throws unexpectedly.
        if (!cancelled) setLoadingData(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isTauri, apiKey, storedWallets]);

  // ── Real-time event listeners ─────────────────────────────────────────────
  // When the WebSocket layer reports a new wallet tx (or a connection-restore
  // after a drop), refetch snapshots for the affected wallets. This replaces
  // pure-timer polling for the dashboard's "live" feel.
  const liveTxEvents = useWalletTxStream();
  const realtimeConn = useConnectionState();
  const lastReconcileTs = useRef(0);

  useEffect(() => {
    if (!isTauri || !apiKey || storedWallets.length === 0) return;
    const head = liveTxEvents[0];
    if (!head) return;
    const matched = storedWallets.find(w =>
      w.address.toLowerCase() === (head.wallet ?? '').toLowerCase() ||
      w.address.toLowerCase() === (head.from ?? '').toLowerCase() ||
      w.address.toLowerCase() === (head.to ?? '').toLowerCase()
    );
    if (!matched) return;
    // Debounce — don't refetch more than once per 800ms regardless of bursts.
    const now = Date.now();
    if (now - lastReconcileTs.current < 800) return;
    lastReconcileTs.current = now;
    getPortfolioSnapshot(matched.address, apiKey)
      .then(snap => setSnapshots(prev => ({ ...prev, [matched.id]: snap })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTxEvents[0]?.hash]);

  // After a reconnect, do a full reconcile pass.
  const wasConnected = useRef<boolean | null>(null);
  useEffect(() => {
    if (!realtimeConn) return;
    const wasDown = wasConnected.current === false;
    wasConnected.current = realtimeConn.connected;
    if (wasDown && realtimeConn.connected && isTauri && apiKey && storedWallets.length > 0) {
      Promise.allSettled(storedWallets.map(w =>
        getPortfolioSnapshot(w.address, apiKey).then(s => ({ id: w.id, snap: s }))
      )).then(entries => {
        const merged: Record<string, PortfolioSnapshot> = {};
        entries.forEach(r => { if (r.status === 'fulfilled') merged[r.value.id] = r.value.snap; });
        setSnapshots(prev => ({ ...prev, ...merged }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeConn?.connected]);

  // Build display wallets from stored + snapshots
  const displayWallets: Wallet[] = storedWallets.map(
    w => buildWallet(w, snapshots[w.id] ?? null, dailyBaseline[w.id] ?? null)
  );

  const displayTransactions = liveTransactions;

  const totalPortfolioUsd = Object.values(snapshots).reduce((s, snap) => s + snap.portfolio_value_usd, 0);
  const totalNfts = Object.values(snapshots).reduce((s, snap) => s + snap.nft_count, 0);
  const totalCoins = Object.values(snapshots).reduce((s, snap) => s + snap.token_count, 0);
  const totalAssets = totalNfts + totalCoins;

  const ethPriceUsd = Object.values(snapshots)[0]?.eth_price_usd ?? 0;
  const allPnlEntries = Object.entries(pnlSummaries);
  const totalPnlEth = allPnlEntries.reduce((s, [, p]) => s + p.realized_pnl_eth + p.unrealized_pnl_eth, 0);
  const pnl7dUsd = allPnlEntries.length > 0 && ethPriceUsd > 0 ? totalPnlEth * ethPriceUsd : null;

  return (
    <main className="min-h-full text-white" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {showAddWallet  && <AddWalletModal   onClose={() => setShowAddWallet(false)} onAdded={() => setStoredWallets(loadOwnedWallets())} />}
      {showDistribute && (
        <DistributeModal
          wallets={loadOwnedWallets().map(w => ({ id: w.id, name: w.name, address: w.address }))}
          skin="dashboard"
          onClose={() => setShowDistribute(false)}
        />
      )}
      {editTarget && (
        <EditWalletModal
          wallet={editTarget}
          allWallets={storedWallets}
          onClose={() => setEditTarget(null)}
          onSaved={() => setStoredWallets(loadOwnedWallets())}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '24px', fontWeight: 600, color: 'var(--wr-text)' }}>
          Portfolio Dashboard
        </h1>
      </div>

      {/* Stat cards — gap-as-border: #1A1A1A bg, gap-px, cells #111111 */}
      <div
        className="grid grid-cols-4 overflow-hidden gap-px"
        style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border)' }}
      >
        {[
          {
            label: 'Total Portfolio',
            value: loadingData ? '—' : `$${totalPortfolioUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            valueColor: 'var(--wr-text)', subUp: true, subColor: 'var(--wr-accent)', sub: loadingData ? 'Loading…' : 'Across all wallets',
          },
          {
            label: 'Total PnL',
            value: pnl7dUsd != null
              ? (pnl7dUsd >= 0 ? `+$${Math.abs(pnl7dUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `-$${Math.abs(pnl7dUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
              : loadingData ? '—' : '$0',
            valueColor: pnl7dUsd == null || pnl7dUsd >= 0 ? 'var(--wr-accent)' : '#f87171',
            subUp: pnl7dUsd == null || pnl7dUsd >= 0,
            subColor: pnl7dUsd == null || pnl7dUsd >= 0 ? 'var(--wr-accent)' : '#f87171',
            sub: pnl7dUsd != null ? `${totalPnlEth >= 0 ? '+' : ''}${totalPnlEth.toFixed(4)} ETH` : loadingData ? 'Loading…' : 'No trades found',
          },
          {
            label: 'Wallets',
            value: String(displayWallets.length),
            valueColor: 'var(--wr-text)', subUp: null, subColor: 'var(--wr-text-3)', sub: displayWallets.map(w => w.name).join(' · '),
          },
          {
            label: 'Assets',
            value: loadingData ? '—' : String(totalAssets),
            valueColor: 'var(--wr-text)', subUp: null, subColor: 'var(--wr-text-3)', sub: `${totalNfts} NFTs · ${totalCoins} tokens`,
          },
        ].map((card, i) => (
          <div key={i} style={{ backgroundColor: 'var(--wr-surface)', padding: '24px' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '6px' }}>
              {card.label}
            </div>
            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '32px', fontWeight: 600, color: card.valueColor, fontVariantNumeric: 'tabular-nums', marginBottom: '6px' }}>
              {card.value}
            </div>
            <div className="flex items-center" style={{ gap: '4px' }}>
              {card.subUp !== null && (
                <span style={{ color: card.subColor, fontSize: '10px' }}>{card.subUp ? '↑' : '↓'}</span>
              )}
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: card.subColor }}>{card.sub}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Wallets section container */}
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center" style={{ gap: '12px' }}>
            <SectionLabel>Wallets</SectionLabel>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
              · {displayWallets.length} wallets
            </span>
            <Link
              href="/wallets"
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-accent)', textDecoration: 'none' }}
              className="hover:opacity-80 transition-opacity"
            >
              View All →
            </Link>
          </div>
          <div className="flex items-center" style={{ gap: '8px' }}>
            <button
              onClick={() => setShowAddWallet(true)}
              className="btn-cta"
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                color: '#000000', backgroundColor: '#BEFF00',
                padding: '6px 14px', border: 'none', borderRadius: 0, cursor: 'pointer',
              }}
            >
              + Add Wallet
            </button>
            <button
              onClick={() => setShowDistribute(true)}
              className="flex items-center"
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                color: 'var(--wr-accent)', backgroundColor: 'var(--wr-surface)',
                border: '1px solid var(--wr-accent)', padding: '6px 14px', gap: '6px', borderRadius: 0, cursor: 'pointer',
              }}
            >
              Distribute Funds
            </button>
          </div>
        </div>
        {displayWallets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px' }}>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text-3)', letterSpacing: '1px' }}>
              No wallets added yet
            </div>
            <button
              onClick={() => setShowAddWallet(true)}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: 'var(--wr-accent)', border: 'none', padding: '8px 20px', cursor: 'pointer', letterSpacing: '0.05em' }}
            >
              + ADD YOUR FIRST WALLET
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-3" style={{ gap: '16px' }}>
            {displayWallets.map(w => (
              <WalletCard key={w.id} w={w} loading={loadingData && !snapshots[w.id]}
                onDelete={() => {
                  deleteWallet(w.id);
                  setStoredWallets(prev => prev.filter(sw => sw.id !== w.id));
                  setSnapshots(prev => { const next = { ...prev }; delete next[w.id]; return next; });
                }}
                onEdit={() => setEditTarget({ id: w.id, name: w.name, rawAddress: w.rawAddress })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Transactions section container */}
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="flex items-center justify-between">
          <SectionLabel>Recent Transactions</SectionLabel>
          <button
            onClick={() => setTxExpanded(v => !v)}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            className="hover:opacity-80 transition-opacity"
          >
            {txExpanded ? 'Collapse ↑' : 'View All →'}
          </button>
        </div>

        {/* Table */}
        <div style={{ border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          {/* Header */}
          <div
            className="grid items-center"
            style={{ gridTemplateColumns: TX_GRID, height: '40px', backgroundColor: 'var(--wr-bg)', borderBottom: '1px solid var(--wr-border)', padding: '0 20px' }}
          >
            {['Tx Hash', 'Type', 'Block', 'Age', 'From', '', 'To', 'Token', 'Amount', 'Gas Fee'].map((h, i) => (
              <span key={i} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: '#71717A', letterSpacing: '1px', textTransform: 'uppercase' }}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          {displayTransactions.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', fontSize: '12px' }}>
              {loadingData ? 'Loading transactions…' : dataError ? dataError : 'No transactions yet — add a wallet to get started'}
            </div>
          )}
          <div style={txExpanded ? { maxHeight: '392px', overflowY: 'scroll', scrollbarWidth: 'thin', scrollbarColor: '#3a3a3a #0A0A0A' } : {}}>
          {(txExpanded ? displayTransactions : displayTransactions.slice(0, PREVIEW_COUNT)).map((tx, i) => (
            <div
              key={i}
              className="grid items-center transition-colors"
              style={{ gridTemplateColumns: TX_GRID, height: '56px', borderBottom: '1px solid var(--wr-border)', padding: '0 20px', backgroundColor: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              <div className="flex items-center min-w-0 pr-2" style={{ gap: '5px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.hash}</span>
                <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, color: 'var(--wr-text-3)', lineHeight: 1, display: 'flex' }} className="hover:text-[#a1a1aa] transition-colors">
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              </div>
              <div><TxBadge type={tx.type} /></div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#3b82f6' }}>{tx.block}</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{tx.age}</span>
              <div className="flex items-center min-w-0 pr-1">
                <AddrCell addr={tx.from} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px' }}>
                <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 4h10M8 1l3 3-3 3" stroke="#3a3a3a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div className="flex items-center min-w-0 pr-1">
                <AddrCell addr={tx.to} />
              </div>
              <div className="flex items-center" style={{ gap: '4px' }}>
                <span style={{ color: 'var(--wr-text-3)', fontSize: '9px' }}>◈</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)' }}>{tx.token}</span>
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', fontVariantNumeric: 'tabular-nums' }}>{tx.amount}</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', fontVariantNumeric: 'tabular-nums' }}>{tx.gas}</span>
            </div>
          ))}
          </div>
        </div>
      </div>
    </main>
  );
}
