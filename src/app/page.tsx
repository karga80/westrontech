'use client';

import Link from 'next/link';
import React, { useState, useEffect, useRef } from 'react';
import {
  getPortfolioSnapshot, getAssetTransfers, loadAlchemyKey, startBackgroundPolling,
  realtimeInit, realtimeSetWatchSet,
  type AssetTransfer, type PortfolioSnapshot,
} from '@/lib/tauri';
import { useWalletTxStream, useConnectionState } from '@/hooks/useRealtime';
import { loadWallets, addWallet as persistWallet, removeWallet as deleteWallet, updateWallet as updateWalletInStore, type StoredWallet } from '@/lib/walletStore';
import { MOCK_TRANSFERS, MOCK_PORTFOLIO_SNAPSHOT } from '@/lib/mockData';
import { Tag, TX_TYPE_VARIANT, WALLET_TOKEN_VARIANT } from '@/components/Tag';
import { useTheme } from '@/lib/themeContext';
import EthIcon from '@/components/EthIcon';

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

const WALLETS: Wallet[] = [
  { id: '0', name: 'Main Wallet',   address: '0x3f4a…A91c', rawAddress: '0x3f4a…A91c', badge: 'ETH',   usdValue: 84201.40,  change: 1204.32,  changePct: 1.45,  nfts: 12, floorPnl: -5420, coins: 4, pnl: 1280 },
  { id: '1', name: 'DeFi Wallet',   address: '0x1234…5678', rawAddress: '0x1234…5678', badge: 'BNB',   usdValue: 38490.87,  change: -270,     changePct: -0.69, nfts: 5,  floorPnl: -270,  coins: 3, pnl: -340 },
  { id: '2', name: 'Polygon Cold',  address: '0xabcd…ef12', rawAddress: '0xabcd…ef12', badge: 'MATIC', usdValue: 20141.65,  change: 3800,     changePct: 2.01,  nfts: 8,  floorPnl: 3800,  coins: 6, pnl: 2490 },
];

const TRANSACTIONS: Tx[] = [
  { hash: '0x8aDf73c1a4…', type: 'Receive',              block: '1847343', age: '1 hr ago',    from: '0x6a4b…2sd8', to: '0x3f4a…A91c', token: 'ETH',  amount: '0.5 ETH',   gas: '0.00003157' },
  { hash: '0x9aB2cd4f88…', type: 'NFT Buy',              block: '1847217', age: '2 hrs ago',   from: '0xbc4c…f13d', to: '0x1234…5678', token: 'NFT',  amount: '1 NFT',     gas: '0.00000892' },
  { hash: '0x3fc81dAe22…', type: 'Sent',                 block: '1846891', age: '3 hrs ago',   from: '0x3f4a…A91c', to: '0x7f2e…B3c1', token: 'ETH',  amount: '0.1 ETH',   gas: '0.00002841' },
  { hash: '0x5c29a31234…', type: 'Swap Buy',             block: '1845430', age: '14 hrs ago',  from: '0xabcd…ef12', to: '0xabcd…ef12', token: 'ETH',  amount: '1.5 ETH',   gas: '0.00004213' },
  { hash: '0x1a8c9b7e55…', type: 'Contract Interaction', block: '1844210', age: '1 day ago',   from: '0x3f4a…A91c', to: '0x1234…5678', token: 'ETH',  amount: '1.5 ETH',   gas: '0.00001764' },
  { hash: '0xf4E2a1b9cc…', type: 'NFT Sell',             block: '1843902', age: '1 day ago',   from: '0x92ab…4F1e', to: '0xabcd…ef12', token: 'NFT',  amount: '1 NFT',     gas: '0.00002100' },
  { hash: '0xc3D7e48f21…', type: 'Sent',                 block: '1843488', age: '2 days ago',  from: '0x1234…5678', to: '0x5d3a…C8f2', token: 'USDC', amount: '500 USDC',  gas: '0.00003880' },
  { hash: '0xa1B9f2c7d4…', type: 'NFT Mint',             block: '1842711', age: '2 days ago',  from: '0x3f4a…A91c', to: '0xe4b1…9A3d', token: 'NFT',  amount: '1 NFT',     gas: '0.00007241' },
  { hash: '0x7dC4b39e01…', type: 'Sweep',                block: '1841990', age: '3 days ago',  from: '0x1234…5678', to: '0x1234…5678', token: 'NFT',  amount: '3 NFTs',    gas: '0.00005512' },
  { hash: '0x2eF8a17c90…', type: 'Receive',              block: '1841203', age: '3 days ago',  from: '0x3b7f…D2c9', to: '0x3f4a…A91c', token: 'ETH',  amount: '0.75 ETH',  gas: '0.00001943' },
  { hash: '0xb5A3d92f44…', type: 'NFT Sent',             block: '1840517', age: '4 days ago',  from: '0xabcd…ef12', to: '0x8c2e…5B7a', token: 'NFT',  amount: '1 NFT',     gas: '0.00002610' },
  { hash: '0x9cE1f74b38…', type: 'Approve',              block: '1839844', age: '5 days ago',  from: '0x1234…5678', to: '0xabcd…ef12', token: 'USDC', amount: '—',         gas: '0.00001320' },
  { hash: '0x4aF6c28d55…', type: 'NFT Offer',            block: '1839120', age: '5 days ago',  from: '0xd19a…7F4b', to: '0xabcd…ef12', token: 'NFT',  amount: '2.1 ETH',   gas: '0.00009870' },
  { hash: '0x6bD0e31a77…', type: 'Swap Buy',             block: '1838401', age: '6 days ago',  from: '0x3f4a…A91c', to: '0x3f4a…A91c', token: 'DAI',  amount: '1200 DAI',  gas: '0.00004455' },
  { hash: '0x1dA5b84c62…', type: 'Sent',                 block: '1837688', age: '7 days ago',  from: '0x3f4a…A91c', to: '0x1234…5678', token: 'ETH',  amount: '2.0 ETH',   gas: '0.00002987' },
];

// ─── Live data helpers ──────────────────────────────────────────────────────

// Map Alchemy AssetTransfer → internal Tx shape
function mapTransfer(t: AssetTransfer, walletAddress: string): Tx {
  const blockDec = parseInt(t.block_num, 16);
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
function buildWallet(stored: StoredWallet, snap: PortfolioSnapshot | null, idx: number): Wallet {
  return {
    id: stored.id,
    name: stored.name,
    address: stored.address.length > 12
      ? `${stored.address.slice(0, 6)}…${stored.address.slice(-4)}`
      : stored.address,
    rawAddress: stored.address,
    badge: 'ETH',
    usdValue:   snap?.portfolio_value_usd ?? 0,
    change:     0,   // 24h change not available from Alchemy without extra call
    changePct:  0,
    nfts:       snap?.nft_count ?? 0,
    floorPnl:   0,
    coins:      snap?.token_count ?? 0,
    pnl:        0,
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
            {w.change >= 0 ? '+' : ''}${Math.abs(w.change).toLocaleString()} ({w.change >= 0 ? '+' : ''}{w.changePct.toFixed(2)}%)
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

function AddWalletModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<AddWalletTab>('import');
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');

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
                Watch-only wallets are read-only — no signing.
              </div>
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
              onClick={() => {
                const addr = tab === 'import' ? key : address;
                if (!addr.trim() || !name.trim()) return;
                persistWallet({ id: Date.now().toString(), name: name.trim(), address: addr.trim() });
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

// ─── Distribute Funds Modal ─────────────────────────────────────────────────


type DistStep = 1 | 2 | 3;
const DIST_STEPS = ['Select & Amounts', 'Confirm', 'Process'] as const;

const LABEL_S: React.CSSProperties = {
  fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
  letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)',
  display: 'block', marginBottom: '6px',
};

function DistributeModal({ onClose }: { onClose: () => void }) {
  const { theme } = useTheme();
  const isDay = theme === 'day';
  const [step, setStep] = useState<DistStep>(1);
  const [sourceId, setSourceId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 'equal' = one shared input; 'custom' = per-wallet inputs
  const [amountMode, setAmountMode] = useState<'equal' | 'custom'>('equal');
  const [equalAmount, setEqualAmount] = useState('');
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [txStatuses, setTxStatuses] = useState<string[]>([]);
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

  const allWallets = loadWallets();
  const source = allWallets.find(w => w.id === sourceId);
  // Destinations = all wallets minus the source
  const destWallets = allWallets.filter(w => w.id !== sourceId);

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

  // Simulate tx processing when step 3 is reached
  useEffect(() => {
    if (step !== 3) return;
    const initial = selectedList.map(() => 'Pending');
    setTxStatuses(initial);
    const timers: ReturnType<typeof setTimeout>[] = [];
    selectedList.forEach((_, i) => {
      timers.push(setTimeout(() => {
        setTxStatuses(prev => { const n = [...prev]; n[i] = 'Processing'; return n; });
        timers.push(setTimeout(() => {
          setTxStatuses(prev => { const n = [...prev]; n[i] = 'Confirmed'; return n; });
        }, 2000));
      }, i * 1800));
    });
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const AMOUNT_INPUT: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface-alt)', border: 'none',
    padding: '5px 8px', outline: 'none', width: '60px', textAlign: 'right',
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
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '24px' }}>
          Send ETH from one wallet to one or more destinations
        </p>

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
                    backgroundColor: active || done ? '#BEFF00' : 'var(--wr-overlay)',
                    border: `1px solid ${active || done ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700,
                    color: active || done ? '#000000' : 'var(--wr-text-3)',
                  }}>{done ? '✓' : n}</div>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: active ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>{label}</span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: '1px', backgroundColor: done ? '#BEFF00' : 'var(--wr-border)', margin: '0 10px' }} />}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

            {/* Source — dropdown */}
            <div>
              <label style={LABEL_S}>From (funding wallet)</label>
              <div ref={sourceDropdownRef} style={{ position: 'relative' }}>
                {/* Trigger */}
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
                    ? (() => { const w = allWallets.find(w => w.id === sourceId); return w ? `${w.name} — ${w.address.slice(0, 6)}…${w.address.slice(-4)}` : 'Choose a wallet…'; })()
                    : 'Choose a wallet…'
                  }
                </button>
                <span style={{ position: 'absolute', right: '12px', top: '50%', transform: `translateY(-50%) rotate(${sourceOpen ? '180' : '0'}deg)`, color: 'var(--wr-text-3)', fontSize: '10px', pointerEvents: 'none', transition: 'transform 0.15s' }}>▾</span>
                {/* Custom dropdown list */}
                {sourceOpen && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 100,
                    backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                  }}>
                    {allWallets.map(w => (
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
                        {w.name} — {w.address.slice(0, 6)}…{w.address.slice(-4)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* TO: wallet grid */}
            <div>
              <label style={{ ...LABEL_S, marginBottom: '8px' }}>To</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', opacity: !sourceId ? 0.4 : 1 }}>
                {destWallets.map(w => {
                  const isChecked = selected.has(w.id);
                  const shortAddr = w.address.slice(0, 6) + '…' + w.address.slice(-4);
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
                          backgroundColor: isChecked ? '#BEFF00' : 'transparent',
                          border: `1px solid ${isChecked ? 'var(--wr-accent)' : 'var(--wr-border-hover)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '8px', color: '#000000',
                        }}>{isChecked ? '✓' : ''}</div>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginLeft: '19px' }}>{shortAddr}</div>
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
                        backgroundColor: amountMode === m ? '#BEFF00' : 'var(--wr-surface-alt)',
                        color: amountMode === m ? '#000000' : 'var(--wr-text-3)',
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
                        placeholder="0.00" className="placeholder-[#3a3a3a]" style={AMOUNT_INPUT} />
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '0 8px', borderLeft: '1px solid var(--wr-border)', lineHeight: '28px' }}>
                        <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle' }} />
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
                            placeholder="0.00" className="placeholder-[#3a3a3a]" style={{ ...AMOUNT_INPUT, width: '70px' }} />
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', padding: '0 6px', borderLeft: '1px solid var(--wr-border)', lineHeight: '26px' }}>
                            <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle' }} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                color: step1Valid ? '#000000' : 'var(--wr-text-4)',
                backgroundColor: step1Valid ? '#BEFF00' : 'var(--wr-overlay)',
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
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{source?.address.slice(0, 10)}…{source?.address.slice(-4)}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-2)' }}>—</span>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>Sending To</div>
            {selectedList.map((w) => (
              <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 14px' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 500, color: 'var(--wr-text)' }}>{w.name}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{w.address}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-accent)' }}>
                  {getAmount(w.id)} <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
                </span>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderTop: '1px solid var(--wr-border)' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Total</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, color: 'var(--wr-text)' }}>{totalEth.toFixed(4)} <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 8px' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>Gas estimate</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)' }}>~0.002 <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></span>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <button onClick={() => setStep(1)} style={{
                flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
                color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
                padding: '11px 0', cursor: 'pointer',
              }}>Back</button>
              <button onClick={() => setStep(3)} className="btn-cta" style={{
                flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: '#000000', backgroundColor: '#BEFF00', border: 'none',
                padding: '11px 0', cursor: 'pointer',
              }}>Confirm & Send</button>
            </div>
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div className="flex flex-col items-center" style={{ padding: '20px 0 16px', gap: '10px' }}>
              <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid var(--wr-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>⚡</div>
              <div style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 600, color: 'var(--wr-text)' }}>Processing</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textAlign: 'center' }}>
                Transactions are being submitted to the network
              </div>
            </div>
            {selectedList.map((w, i) => {
              const status = txStatuses[i] ?? 'Pending';
              const statusColor = status === 'Confirmed' ? 'var(--wr-accent)' : status === 'Processing' ? '#FBBF24' : 'var(--wr-text-3)';
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 14px' }}>
                  <div>
                    <div style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{w.address}</div>
                    <div style={{ color: 'var(--wr-text-3)', fontSize: '11px', fontFamily: 'var(--font-jetbrains)', marginTop: '2px' }}>{getAmount(w.id)} <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></div>
                  </div>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: statusColor }}>{status}</span>
                </div>
              );
            })}
            <button onClick={() => { setStep(1); setSourceId(''); setSelected(new Set()); setEqualAmount(''); setCustomAmounts({}); onClose(); }} style={{
              width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
              color: '#000000', backgroundColor: '#BEFF00', border: 'none',
              padding: '11px 0', cursor: 'pointer', marginTop: '8px',
            }}>Done</button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

// ─── Address Cell ──────────────────────────────────────────────────────────

function AddrCell({ addr }: { addr: string }) {
  const wallet = WALLETS.find(w => w.address === addr);
  if (wallet) {
    return <Tag variant={WALLET_TOKEN_VARIANT[wallet.badge] ?? 'neutral'}>{wallet.name}</Tag>;
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

  // Detect Tauri + bootstrap wallets + API key
  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);
    const wallets = loadWallets();
    setStoredWallets(wallets);

    if (inTauri) {
      // If there are no wallets, nothing to load — clear the loading state.
      if (wallets.length === 0) setLoadingData(false);
      loadAlchemyKey()
        .then(k => {
          if (k) setApiKey(k);
          // No API key configured → don't block the UI on a fetch that won't happen.
          else setLoadingData(false);
        })
        .catch(() => { setLoadingData(false); });
    } else {
      // Browser mode — use mock data immediately
      const mockSnaps: Record<string, PortfolioSnapshot> = {};
      wallets.forEach(w => { mockSnaps[w.id] = MOCK_PORTFOLIO_SNAPSHOT; });
      setSnapshots(mockSnaps);
      setLiveTransactions(MOCK_TRANSFERS.map(t => mapTransfer(t, wallets[0]?.address ?? '')));
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

        // Fetch transactions for first wallet (merge later)
        const primaryWallet = storedWallets[0];
        try {
          const transfers = await getAssetTransfers(primaryWallet.address, apiKey);
          if (!cancelled) {
            setLiveTransactions(transfers.map(t => mapTransfer(t, primaryWallet.address)));
          }
        } catch {}

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
          } catch (e) { /* eslint-disable-next-line no-console */ console.warn('realtime bootstrap:', e); }
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
  const displayWallets: Wallet[] = storedWallets.length > 0
    ? storedWallets.map((w, i) => buildWallet(w, snapshots[w.id] ?? null, i))
    : WALLETS;

  const displayTransactions = liveTransactions.length > 0 ? liveTransactions : TRANSACTIONS;

  const totalPortfolioUsd = Object.values(snapshots).reduce((s, snap) => s + snap.portfolio_value_usd, 0);
  const totalNfts = Object.values(snapshots).reduce((s, snap) => s + snap.nft_count, 0);
  const totalCoins = Object.values(snapshots).reduce((s, snap) => s + snap.token_count, 0);
  const totalAssets = totalNfts + totalCoins;

  const pnl7d = 8204.15; // Placeholder until 7d PnL endpoint is added

  return (
    <main className="min-h-full text-white" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {showAddWallet  && <AddWalletModal   onClose={() => setShowAddWallet(false)}  />}
      {showDistribute && <DistributeModal  onClose={() => setShowDistribute(false)} />}
      {editTarget && (
        <EditWalletModal
          wallet={editTarget}
          allWallets={storedWallets}
          onClose={() => setEditTarget(null)}
          onSaved={() => setStoredWallets(loadWallets())}
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
            value: loadingData ? '—' : `$${(totalPortfolioUsd || 142834.92).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            valueColor: 'var(--wr-text)', subUp: true, subColor: 'var(--wr-accent)', sub: loadingData ? 'Loading…' : 'Across all wallets',
          },
          {
            label: '7D PnL',
            value: pnl7d >= 0 ? `+$${pnl7d.toLocaleString()}` : `-$${Math.abs(pnl7d).toLocaleString()}`,
            valueColor: pnl7d >= 0 ? 'var(--wr-accent)' : '#f87171', subUp: pnl7d >= 0, subColor: pnl7d >= 0 ? 'var(--wr-accent)' : '#f87171', sub: '+6.10% vs last week',
          },
          {
            label: 'Wallets',
            value: String(displayWallets.length),
            valueColor: 'var(--wr-text)', subUp: null, subColor: 'var(--wr-text-3)', sub: displayWallets.map(w => w.name).join(' · '),
          },
          {
            label: 'Assets',
            value: loadingData ? '—' : String(totalAssets || 23),
            valueColor: 'var(--wr-text)', subUp: null, subColor: 'var(--wr-text-3)', sub: `${totalNfts || '—'} NFTs · ${totalCoins || '—'} tokens`,
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
        <div className="grid grid-cols-3" style={{ gap: '16px' }}>
          {displayWallets.map(w => (
            <WalletCard key={w.id} w={w} loading={loadingData && !snapshots[w.id]}
              onDelete={() => {
                deleteWallet(w.id);
                setStoredWallets(loadWallets());
              }}
              onEdit={() => setEditTarget({ id: w.id, name: w.name, rawAddress: w.rawAddress })}
            />
          ))}
        </div>
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
