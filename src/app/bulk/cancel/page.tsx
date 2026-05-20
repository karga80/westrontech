'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadOwnedWallets } from '@/lib/walletStore';
import { loadAlchemyKey, marketplaceCancelOrder } from '@/lib/tauri';
import { Tag, type TagVariant } from '@/components/Tag';
import ProGate from '@/components/ProGate';
import EthIcon from '@/components/EthIcon';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Types & Data ──────────────────────────────────────────────────────────────

type OrderType = 'Listing' | 'Bid';
type OrderStatus = 'Active' | 'Expiring Soon' | 'Expired';
type TxStatus = 'Pending' | 'Signing' | 'Broadcasting' | 'Confirmed' | 'Failed';

interface Order {
  id: string;
  wallet: string;
  nft: string;
  collection: string;
  collectionEmoji: string;
  type: OrderType;
  marketplace: 'OpenSea' | 'Blur' | 'MagicEden';
  price: number;
  floor: number;
  expiry: string;
  status: OrderStatus;
}

const WALLET_COLORS = ['#06B6D4', '#a855f7', '#f59e0b'];
const STATIC_WALLETS = [
  { id: 'w1', label: 'Main Wallet',   color: '#06B6D4' },
  { id: 'w2', label: 'Trading Vault', color: '#a855f7' },
  { id: 'w3', label: 'Cold Storage',  color: '#f59e0b' },
];

const ORDERS: Order[] = [
  // Wallet 1
  { id: 'o1',  wallet: 'w1', nft: 'Pudgy #4531',      collection: 'Pudgy Penguins',    collectionEmoji: '🐧', type: 'Listing', marketplace: 'OpenSea',  price: 4.80,  floor: 4.124, expiry: '6d 12h',   status: 'Active' },
  { id: 'o2',  wallet: 'w1', nft: 'Pudgy #7102',      collection: 'Pudgy Penguins',    collectionEmoji: '🐧', type: 'Listing', marketplace: 'Blur',     price: 4.55,  floor: 4.124, expiry: '2d 4h',    status: 'Active' },
  { id: 'o3',  wallet: 'w1', nft: 'Doodles #8021',    collection: 'Doodles',           collectionEmoji: '🌈', type: 'Bid',     marketplace: 'OpenSea',  price: 0.44,  floor: 0.4865,expiry: '1h 10m',   status: 'Expiring Soon' },
  { id: 'o4',  wallet: 'w1', nft: 'Doodles #3340',    collection: 'Doodles',           collectionEmoji: '🌈', type: 'Bid',     marketplace: 'OpenSea',  price: 0.46,  floor: 0.4865,expiry: '3d 0h',    status: 'Active' },
  { id: 'o5',  wallet: 'w1', nft: 'Azuki #2960',      collection: 'Azuki',             collectionEmoji: '⛩', type: 'Listing', marketplace: 'Blur',     price: 0.72,  floor: 0.676, expiry: '—',        status: 'Expired' },
  { id: 'o6',  wallet: 'w1', nft: 'Clone X #8812',    collection: 'Clone X',           collectionEmoji: '🤖', type: 'Bid',     marketplace: 'OpenSea',  price: 1.85,  floor: 1.92,  expiry: '5d 6h',    status: 'Active' },
  // Wallet 2
  { id: 'o7',  wallet: 'w2', nft: 'BAYC #8752',       collection: 'Bored Ape YC',      collectionEmoji: '🦍', type: 'Listing', marketplace: 'OpenSea',  price: 15.50, floor: 14.20, expiry: '13d 0h',   status: 'Active' },
  { id: 'o8',  wallet: 'w2', nft: 'BAYC #0391',       collection: 'Bored Ape YC',      collectionEmoji: '🦍', type: 'Listing', marketplace: 'Blur',     price: 14.90, floor: 14.20, expiry: '4d 18h',   status: 'Active' },
  { id: 'o9',  wallet: 'w2', nft: 'MAYC #8720',       collection: 'Mutant Ape YC',     collectionEmoji: '🧬', type: 'Listing', marketplace: 'Blur',     price: 0.80,  floor: 0.7597,expiry: '0h 40m',   status: 'Expiring Soon' },
  { id: 'o10', wallet: 'w2', nft: 'CryptoPunk #5102', collection: 'CryptoPunks',       collectionEmoji: '👾', type: 'Listing', marketplace: 'OpenSea',  price: 31.00, floor: 29.00, expiry: '—',        status: 'Expired' },
  { id: 'o11', wallet: 'w2', nft: 'Milady #2241',     collection: 'Milady Maker',      collectionEmoji: '👧', type: 'Bid',     marketplace: 'OpenSea',  price: 1.10,  floor: 1.18,  expiry: '6d 2h',    status: 'Active' },
  { id: 'o12', wallet: 'w2', nft: 'Moonbirds #2284',  collection: 'Moonbirds',         collectionEmoji: '🦉', type: 'Listing', marketplace: 'MagicEden',price: 1.50,  floor: 1.40,  expiry: '—',        status: 'Expired' },
  // Wallet 3
  { id: 'o13', wallet: 'w3', nft: 'Azuki #7741',      collection: 'Azuki',             collectionEmoji: '⛩', type: 'Listing', marketplace: 'Blur',     price: 0.71,  floor: 0.676, expiry: '8d 0h',    status: 'Active' },
  { id: 'o14', wallet: 'w3', nft: 'Pudgy #9903',      collection: 'Pudgy Penguins',    collectionEmoji: '🐧', type: 'Bid',     marketplace: 'Blur',     price: 3.90,  floor: 4.124, expiry: '1d 4h',    status: 'Active' },
  { id: 'o15', wallet: 'w3', nft: 'Clone X #0019',    collection: 'Clone X',           collectionEmoji: '🤖', type: 'Bid',     marketplace: 'OpenSea',  price: 1.80,  floor: 1.92,  expiry: '0h 15m',   status: 'Expiring Soon' },
  { id: 'o16', wallet: 'w3', nft: 'Doodles #1120',    collection: 'Doodles',           collectionEmoji: '🌈', type: 'Listing', marketplace: 'OpenSea',  price: 0.52,  floor: 0.4865,expiry: '—',        status: 'Expired' },
  { id: 'o17', wallet: 'w3', nft: 'MAYC #3344',       collection: 'Mutant Ape YC',     collectionEmoji: '🧬', type: 'Bid',     marketplace: 'OpenSea',  price: 0.72,  floor: 0.7597,expiry: '2d 8h',    status: 'Active' },
  { id: 'o18', wallet: 'w3', nft: 'Milady #8801',     collection: 'Milady Maker',      collectionEmoji: '👧', type: 'Listing', marketplace: 'MagicEden',price: 1.25,  floor: 1.18,  expiry: '3d 12h',   status: 'Active' },
];

const ORDER_STATUS_VARIANT: Record<OrderStatus, TagVariant> = {
  'Active':        'success',
  'Expiring Soon': 'warning',
  'Expired':       'neutral',
};

const MP_COLOR: Record<string, string> = {
  OpenSea: '#2081e2', Blur: '#ff6a00', MagicEden: '#e42575',
};

const TX_STATUS_VARIANT: Record<TxStatus, TagVariant> = {
  Pending:      'neutral',
  Signing:      'warning',
  Broadcasting: 'info',
  Confirmed:    'success',
  Failed:       'danger',
};

function fakeHash() {
  return '0x' + Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('') + '…';
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function BulkCancelPage() {
  const [wallets, setWallets] = useState(STATIC_WALLETS);

  useEffect(() => {
    const stored = loadOwnedWallets();
    if (stored.length > 0) {
      setWallets(stored.map((w, i) => ({
        id: `w${i + 1}`,
        label: w.name,
        color: WALLET_COLORS[i % WALLET_COLORS.length],
      })));
    }
  }, []);

  const [activeWallets, setActiveWallets] = useState<Set<string>>(new Set(['w1', 'w2', 'w3']));
  const [typeFilter, setTypeFilter] = useState<'All' | 'Listing' | 'Bid'>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | OrderStatus>('All');
  const [search, setSearch] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['status', 'type', 'wallets']));
  const toggleSection = (s: string) => setOpenSections(p => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tracking, setTracking] = useState(false);
  const [txRows, setTxRows] = useState<Array<{ id: string; nft: string; type: string; marketplace: string; price: number; status: TxStatus; hash: string }>>([]);
  const [progress, setProgress] = useState(0);

  const toggleWallet = (id: string) => {
    setActiveWallets(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); } else next.add(id);
      return next;
    });
    setSelected(new Set());
  };

  // Filtered orders
  const visible = ORDERS.filter(o => {
    if (!activeWallets.has(o.wallet)) return false;
    if (typeFilter !== 'All' && o.type !== typeFilter) return false;
    if (statusFilter !== 'All' && o.status !== statusFilter) return false;
    if (search && !o.nft.toLowerCase().includes(search.toLowerCase()) && !o.collection.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const allSelected = visible.length > 0 && visible.every(o => selected.has(o.id));

  const toggleAll = () => {
    if (allSelected) setSelected(prev => { const next = new Set(prev); visible.forEach(o => next.delete(o.id)); return next; });
    else setSelected(prev => { const next = new Set(prev); visible.forEach(o => next.add(o.id)); return next; });
  };

  const toggleOne = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const selectedOrders = ORDERS.filter(o => selected.has(o.id));
  const gasEst = (selectedOrders.length * 0.00082).toFixed(5);

  // Cancel → tracking
  const cancel = async () => {
    const rows = selectedOrders.map(o => ({ id: o.id, nft: o.nft, type: o.type, marketplace: o.marketplace, price: o.price, status: 'Pending' as TxStatus, hash: fakeHash() }));
    setTxRows(rows); setProgress(0); setTracking(true);

    if (isTauri) {
      let apiKey = '';
      const wallets = loadOwnedWallets();
      const walletAddress = wallets[0]?.address ?? '';
      try { apiKey = await loadAlchemyKey(); } catch { /* key not set */ }

      for (let i = 0; i < rows.length; i++) {
        const order = selectedOrders[i];
        setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Signing' } : x));
        try {
          const result = await marketplaceCancelOrder({
            orderHash: order.id,
            walletAddress,
            marketplace: order.marketplace.toLowerCase() === 'blur' ? 'blur' : 'opensea',
            apiKey,
          });
          const status: TxStatus = result.error ? 'Failed' : 'Broadcasting';
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status, hash: result.tx_hash ?? x.hash } : x));
          await new Promise(res => setTimeout(res, 400));
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: result.error ? 'Failed' : 'Confirmed' } : x));
        } catch {
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Failed' } : x));
        }
        setProgress(Math.round(((i + 1) / rows.length) * 100));
      }
    } else {
      rows.forEach((_, i) => {
        const d = i * 700;
        setTimeout(() => setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Signing' } : x)), d + 150);
        setTimeout(() => setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Broadcasting' } : x)), d + 500);
        setTimeout(() => {
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Confirmed' } : x));
          setProgress(Math.round(((i + 1) / rows.length) * 100));
        }, d + 1200);
      });
    }
  };

  // ── Tracking View ────────────────────────────────────────────────────────────
  if (tracking) {
    const done = txRows.filter(r => r.status === 'Confirmed' || r.status === 'Failed').length;
    return (
      <main style={{ backgroundColor: 'var(--wr-bg)', minHeight: '100%', padding: '28px 48px 48px', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', marginBottom: '32px' }}>
          <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Bulk Actions</Link>
          <span>›</span>
          <span style={{ color: 'var(--wr-accent)', cursor: 'pointer' }} onClick={() => { setTracking(false); setSelected(new Set()); }}>Bulk Cancel</span>
          <span>›</span>
          <span style={{ color: 'var(--wr-text)' }}>Tracking</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', marginBottom: '8px' }}>
          <h2 style={{ fontSize: '22px', fontWeight: 600, margin: 0 }}>Cancelling {txRows.length} Order{txRows.length !== 1 ? 's' : ''}</h2>
          <span style={{ fontSize: '13px', color: 'var(--wr-text-3)' }}>{done} of {txRows.length} confirmed</span>
        </div>

        {/* Progress bar */}
        <div style={{ height: '3px', backgroundColor: 'var(--wr-border)', borderRadius: '2px', marginBottom: '32px', width: '100%' }}>
          <div style={{ height: '100%', width: `${progress}%`, backgroundColor: '#F87171', borderRadius: '2px', transition: 'width 0.35s ease' }} />
        </div>

        {/* Tx table */}
        <div style={{ border: '1px solid var(--wr-border)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--wr-surface)', borderBottom: '1px solid var(--wr-border)' }}>
                {['NFT', 'Type', 'Marketplace', 'Price', 'Tx Hash', 'Status'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: '11px', color: '#555', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txRows.map(row => (
                <tr key={row.id} style={{ borderBottom: '1px solid #0f0f0f' }}>
                  <td style={{ padding: '13px 16px', fontSize: '13px', color: 'var(--wr-text)', fontWeight: 500 }}>{row.nft}</td>
                  <td style={{ padding: '13px 16px' }}>
                    <Tag variant={row.type === 'Listing' ? 'accent' : 'info'} size="xs">{row.type}</Tag>
                  </td>
                  <td style={{ padding: '13px 16px' }}>
                    <span style={{ fontSize: '11px', color: MP_COLOR[row.marketplace], backgroundColor: MP_COLOR[row.marketplace] + '18', border: `1px solid ${MP_COLOR[row.marketplace]}33`, borderRadius: '4px', padding: '2px 8px' }}>{row.marketplace}</span>
                  </td>
                  <td style={{ padding: '13px 16px', fontSize: '13px', color: 'var(--wr-text-2)' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{row.price}</td>
                  <td style={{ padding: '13px 16px', fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>{row.hash}</td>
                  <td style={{ padding: '13px 16px' }}>
                    <Tag variant={TX_STATUS_VARIANT[row.status]} size="xs">{row.status}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    );
  }

  // ── Main View ─────────────────────────────────────────────────────────────────
  return (
    <ProGate feature="Bulk Cancel">
    <>
      <main style={{ backgroundColor: 'var(--wr-bg)', minHeight: '100%', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)', paddingBottom: selected.size > 0 ? '80px' : '0' }}>

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div style={{ padding: '20px 32px 20px', borderBottom: '1px solid #111' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)', marginBottom: '16px' }}>
            <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Bulk Actions</Link>
            <span>›</span>
            <span style={{ color: 'var(--wr-text)' }}>Bulk Cancel</span>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, marginBottom: '6px', color: 'var(--wr-text)' }}>Bulk Cancel</h1>
          <p style={{ fontSize: '13px', color: '#555', margin: 0 }}>Cancel active listings and bids across all wallets and marketplaces.</p>
        </div>

        {/* ── Body: filter panel + table ──────────────────────────────────────── */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>

          {/* ── Filter panel ──────────────────────────────────────────────────── */}
          <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid #111', overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#222 transparent' }}>

            {/* Status */}
            <div style={{ borderBottom: '1px solid #111' }}>
              <div onClick={() => toggleSection('status')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>Status</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: openSections.has('status') ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                  <path d="M2 4L6 8L10 4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {openSections.has('status') && (
                <div style={{ padding: '4px 16px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(['All', 'Active', 'Expiring Soon', 'Expired'] as const).map(s => {
                    const on = statusFilter === s;
                    const accent = s === 'Active' ? '#34d399' : s === 'Expiring Soon' ? '#fbbf24' : s === 'Expired' ? '#71717A' : undefined;
                    return (
                      <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '5px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: on ? 700 : 400, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', border: `1px solid ${on ? '#3a3a3a' : '#1f1f1f'}`, backgroundColor: on ? '#1c1c1c' : 'transparent', color: on ? (accent ?? 'var(--wr-text)') : '#555' }}>
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Type */}
            <div style={{ borderBottom: '1px solid #111' }}>
              <div onClick={() => toggleSection('type')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>Order Type</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: openSections.has('type') ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                  <path d="M2 4L6 8L10 4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {openSections.has('type') && (
                <div style={{ padding: '4px 16px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {(['All', 'Listing', 'Bid'] as const).map(t => {
                    const on = typeFilter === t;
                    return (
                      <button key={t} onClick={() => setTypeFilter(t)} style={{ padding: '5px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: on ? 700 : 400, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', border: `1px solid ${on ? '#3a3a3a' : '#1f1f1f'}`, backgroundColor: on ? '#1c1c1c' : 'transparent', color: on ? 'var(--wr-text)' : '#555' }}>
                        {t}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Wallets */}
            <div style={{ borderBottom: '1px solid #111' }}>
              <div onClick={() => toggleSection('wallets')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', cursor: 'pointer', userSelect: 'none' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>Wallets</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: openSections.has('wallets') ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.15s' }}>
                  <path d="M2 4L6 8L10 4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {openSections.has('wallets') && (
                <div style={{ padding: '4px 16px 16px', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {/* All */}
                  <button onClick={() => setActiveWallets(new Set(wallets.map(w => w.id)))}
                    style={{ padding: '5px 12px', borderRadius: '7px', fontSize: '11px', fontWeight: activeWallets.size === wallets.length ? 700 : 400, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', border: `1px solid ${activeWallets.size === wallets.length ? '#3a3a3a' : '#1f1f1f'}`, backgroundColor: activeWallets.size === wallets.length ? '#1c1c1c' : 'transparent', color: activeWallets.size === wallets.length ? 'var(--wr-text)' : '#555' }}>
                    All
                  </button>
                  {wallets.map(w => {
                    const on = activeWallets.has(w.id);
                    return (
                      <button key={w.id} onClick={() => toggleWallet(w.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', borderRadius: '7px', fontSize: '11px', fontWeight: on ? 600 : 400, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', border: `1px solid ${on ? w.color + '55' : '#1f1f1f'}`, backgroundColor: on ? w.color + '15' : 'transparent', color: on ? w.color : '#555' }}>
                        <span style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: on ? w.color : '#333', flexShrink: 0 }} />
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

          </div>

          {/* ── Table ─────────────────────────────────────────────────────────── */}
          <div style={{ flex: 1, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '780px' }}>
            <thead style={{ backgroundColor: 'var(--wr-bg)', position: 'sticky', top: 0, zIndex: 10 }}>
              <tr style={{ borderBottom: '1px solid #111' }}>
                {/* Select all */}
                <th style={{ padding: '7px 12px 7px 24px', width: '36px' }}>
                  <div onClick={toggleAll}
                    style={{ width: '13px', height: '13px', borderRadius: '3px', border: `1.5px solid ${allSelected ? '#F87171' : '#333'}`, backgroundColor: allSelected ? '#F87171' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    {allSelected && <span style={{ color: '#000', fontSize: '9px', lineHeight: 1 }}>✓</span>}
                  </div>
                </th>
                {[['NFT', 'left'], ['Type', 'left'], ['Marketplace', 'left'], ['Price', 'right'], ['Floor', 'right'], ['Expiry', 'right'], ['Status', 'left']].map(([h, a]) => (
                  <th key={h} style={{ padding: '7px 12px', textAlign: a as 'left' | 'right', fontSize: '10px', color: '#555', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={8} style={{ padding: '48px', textAlign: 'center', color: '#444', fontSize: '13px' }}>No orders match the current filters.</td></tr>
              )}
              {visible.map(o => {
                const sel = selected.has(o.id);
                const wallet = wallets.find(w => w.id === o.wallet) ?? wallets[0];
                return (
                  <OrderRow key={o.id} order={o} sel={sel} wallet={wallet} onToggle={() => toggleOne(o.id)} />
                );
              })}
            </tbody>
          </table>
          </div>{/* /table wrapper */}
        </div>{/* /body row */}
      </main>

      {/* ── Bottom action bar ───────────────────────────────────────────────────── */}
      {selected.size > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40, backgroundColor: 'var(--wr-surface-alt)', borderTop: '1px solid #F8717133', boxShadow: '0 -8px 32px rgba(0,0,0,0.7)', padding: '0 32px', height: '68px', display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Selected</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--wr-text)' }}>{selected.size} order{selected.size !== 1 ? 's' : ''}</div>
            </div>
            <div style={{ width: '1px', backgroundColor: 'var(--wr-border)' }} />
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Listings</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--wr-accent)' }}>{selectedOrders.filter(o => o.type === 'Listing').length}</div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bids</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#06B6D4' }}>{selectedOrders.filter(o => o.type === 'Bid').length}</div>
            </div>
            <div style={{ width: '1px', backgroundColor: 'var(--wr-border)' }} />
            <div>
              <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Est. Gas</div>
              <div style={{ fontSize: '15px', fontWeight: 700, color: '#F87171' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{gasEst}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => setSelected(new Set())}
              style={{ height: '40px', padding: '0 18px', borderRadius: '7px', border: '1px solid var(--wr-border-hover)', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', backgroundColor: 'transparent', color: 'var(--wr-text-3)' }}>
              Clear
            </button>
            <button onClick={cancel}
              style={{ height: '40px', padding: '0 24px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, backgroundColor: '#F87171', color: '#000' }}>
              ⊗ Cancel {selected.size} Order{selected.size !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </>
    </ProGate>
  );
}

// ─── Order Row ─────────────────────────────────────────────────────────────────

function OrderRow({ order: o, sel, wallet, onToggle }: {
  order: Order; sel: boolean;
  wallet: { id: string; label: string; color: string };
  onToggle: () => void;
}) {
  const [hover, setHover] = useState(false);
  // Guard: floor can be 0 for unlisted NFTs — division by zero would render 'Infinity'.
  const diff = o.floor > 0 ? ((o.price - o.floor) / o.floor * 100).toFixed(1) : '—';
  const above = o.price >= o.floor;

  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onToggle}
      style={{ borderBottom: '1px solid var(--wr-border)', backgroundColor: sel ? '#F871710A' : hover ? 'var(--wr-hover-bg)' : 'transparent', transition: 'background-color 0.1s', cursor: 'pointer' }}>
      {/* Checkbox */}
      <td style={{ padding: '7px 12px 7px 24px' }}>
        <div style={{ width: '13px', height: '13px', borderRadius: '3px', border: `1.5px solid ${sel ? '#F87171' : '#333'}`, backgroundColor: sel ? '#F87171' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {sel && <span style={{ color: '#000', fontSize: '9px', lineHeight: 1 }}>✓</span>}
        </div>
      </td>
      {/* NFT */}
      <td style={{ padding: '7px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: 'var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{o.collectionEmoji}</div>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)' }}>{o.nft}</div>
            <div style={{ fontSize: '10px', color: '#444', marginTop: '1px' }}>{o.collection}</div>
          </div>
        </div>
      </td>
      {/* Type */}
      <td style={{ padding: '7px 12px' }}>
        <Tag variant={o.type === 'Listing' ? 'accent' : 'info'} size="xs">{o.type}</Tag>
      </td>
      {/* Marketplace */}
      <td style={{ padding: '7px 12px' }}>
        <span style={{ fontSize: '11px', color: MP_COLOR[o.marketplace], backgroundColor: MP_COLOR[o.marketplace] + '18', border: `1px solid ${MP_COLOR[o.marketplace]}33`, borderRadius: '4px', padding: '2px 8px' }}>{o.marketplace}</span>
      </td>
      {/* Price */}
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>
        <EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{o.price}
        <span style={{ fontSize: '10px', color: above ? '#34d399' : '#f87171', marginLeft: '6px' }}>{above ? '+' : ''}{diff}%</span>
      </td>
      {/* Floor */}
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: '#555', whiteSpace: 'nowrap' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{o.floor}</td>
      {/* Expiry */}
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: o.status === 'Expiring Soon' ? '#fbbf24' : '#555', whiteSpace: 'nowrap' }}>{o.expiry}</td>
      {/* Status */}
      <td style={{ padding: '7px 12px' }}>
        <Tag variant={ORDER_STATUS_VARIANT[o.status]} size="xs">{o.status}</Tag>
      </td>
    </tr>
  );
}
