'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { loadWallets } from '@/lib/walletStore';
import { loadAlchemyKey, marketplacePlaceBid } from '@/lib/tauri';
import { Tag, type TagVariant } from '@/components/Tag';
import ProGate from '@/components/ProGate';
import EthIcon from '@/components/EthIcon';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// ─── Types ─────────────────────────────────────────────────────────────────────

type SortKey = 'floor' | 'change' | 'topOffer' | 'vol' | 'sales' | 'owners' | 'supply';
type SortDir = 'asc' | 'desc';
type TimeFilter = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
type TxStatus = 'Pending' | 'Signing' | 'Broadcasting' | 'Confirmed' | 'Failed';

interface Collection {
  id: string; name: string; emoji: string; color: string;
  verified: boolean; starred: boolean;
  floor: number; change: number; topOffer: number;
  vol: number; sales: number; owners: number; supply: number;
  desc: string;
}

interface Trait {
  id: string; category: string; value: string;
  supply: number; rarity: number; topOffer: number;
}

interface QueuedBid {
  uid: string;               // unique key
  collectionId: string;
  collectionName: string;
  emoji: string;
  color: string;
  label: string;             // 'Collection Offer' or 'Trait: Background / Blue'
  price: string;
}

// ─── Data ──────────────────────────────────────────────────────────────────────

const INITIAL_COLLECTIONS: Collection[] = [
  { id: 'courtyard', name: 'Courtyard.io',           emoji: '🏛', color: '#6366f1', verified: true,  starred: false, floor: 3.90,   change:  4.0,  topOffer: 0,     vol: 1200,  sales: 25469, owners: 70131, supply: 257257, desc: 'Physical collectibles onchain. RWA-backed NFTs.' },
  { id: 'pudgy',     name: 'Pudgy Penguins',          emoji: '🐧', color: '#5b7cfa', verified: true,  starred: true,  floor: 4.124,  change: -1.5,  topOffer: 4.00,  vol: 57.62, sales: 13,    owners: 5092,  supply: 8888,   desc: 'A collection of 8,888 NFTs living on the Ethereum blockchain.' },
  { id: 'punks',     name: 'CryptoPunks',             emoji: '👾', color: '#5b7cfa', verified: true,  starred: true,  floor: 29.00,  change: -1.4,  topOffer: 0,     vol: 28.98, sales: 1,     owners: 3825,  supply: 9994,   desc: '10,000 unique algorithmically generated characters by Larva Labs.' },
  { id: 'milady',    name: 'Milady Maker',             emoji: '👧', color: '#ec4899', verified: true,  starred: false, floor: 1.18,   change: -3.8,  topOffer: 1.11,  vol: 24.42, sales: 21,    owners: 5159,  supply: 9998,   desc: 'Radical street style NFT collection of 10k Miladys.' },
  { id: 'warplets',  name: 'The Warplets',             emoji: '🌀', color: '#8b5cf6', verified: true,  starred: false, floor: 0.003,  change: -1.1,  topOffer: 0.003, vol: 22.70, sales: 7372,  owners: 21617, supply: 49141,  desc: 'Warplets are a new kind of NFT living in the Warpcast ecosystem.' },
  { id: 'veefriends',name: 'VeeFriends',               emoji: '🐾', color: '#ffb020', verified: true,  starred: false, floor: 1.30,   change:  2.4,  topOffer: 1.21,  vol: 15.53, sales: 4,     owners: 4657,  supply: 10255,  desc: 'Gary Vaynerchuk\'s hand-drawn NFT collection.' },
  { id: 'doodles',   name: 'Doodles',                  emoji: '🌈', color: '#ffb020', verified: true,  starred: true,  floor: 0.4865, change: -3.3,  topOffer: 0.475, vol: 15.02, sales: 28,    owners: 4465,  supply: 9998,   desc: 'A community-driven collectibles project by Evan Keast & Jordan Castro.' },
  { id: 'bayc',      name: 'Bored Ape Yacht Club',     emoji: '🦍', color: '#a855f7', verified: true,  starred: true,  floor: 14.20,  change: -2.6,  topOffer: 13.80, vol: 14.10, sales: 8,     owners: 6432,  supply: 10000,  desc: 'A collection of 10,000 Bored Ape NFTs — unique digital collectibles.' },
  { id: 'mayc',      name: 'Mutant Ape Yacht Club',    emoji: '🧬', color: '#7c3aed', verified: true,  starred: true,  floor: 0.7597, change: -2.6,  topOffer: 0.761, vol: 13.32, sales: 16,    owners: 12089, supply: 19559,  desc: 'A collection of 20,000 Mutant Apes created from existing BAYCs.' },
  { id: 'azuki',     name: 'Azuki',                    emoji: '⛩',  color: '#ff8a96', verified: true,  starred: false, floor: 0.676,  change: -1.0,  topOffer: 0.661, vol: 10.90, sales: 10,    owners: 4392,  supply: 10000,  desc: 'A brand for the metaverse. Built by the community. Join the garden.' },
  { id: 'clonex',    name: 'Clone X',                  emoji: '🤖', color: '#4fe9b4', verified: true,  starred: false, floor: 1.92,   change:  0.5,  topOffer: 1.88,  vol: 9.14,  sales: 25,    owners: 9841,  supply: 20000,  desc: 'RTFKT x Takashi Murakami 3D Avatar collection. Metaverse-ready.' },
  { id: 'moon',      name: 'Moonbirds',                emoji: '🦉', color: '#90a6ff', verified: true,  starred: false, floor: 1.40,   change: -0.2,  topOffer: 1.35,  vol: 8.20,  sales: 22,    owners: 6100,  supply: 10000,  desc: 'A collection of 10,000 utility-enabled PFPs by PROOF Collective.' },
];

const COLLECTION_TRAITS: Record<string, Trait[]> = {
  pudgy: [
    { id: 't1', category: 'Background', value: 'Blue',        supply: 74,  rarity: 7.4,  topOffer: 5.10 },
    { id: 't2', category: 'Background', value: 'Pink',        supply: 98,  rarity: 9.8,  topOffer: 4.95 },
    { id: 't3', category: 'Background', value: 'Yellow',      supply: 112, rarity: 11.2, topOffer: 4.90 },
    { id: 't4', category: 'Body',       value: 'Hoodie',      supply: 210, rarity: 21.0, topOffer: 4.85 },
    { id: 't5', category: 'Body',       value: 'Turtleneck',  supply: 145, rarity: 14.5, topOffer: 5.00 },
    { id: 't6', category: 'Head',       value: 'Beanie',      supply: 320, rarity: 32.0, topOffer: 5.00 },
    { id: 't7', category: 'Head',       value: 'Crown',       supply: 44,  rarity: 4.4,  topOffer: 6.20 },
    { id: 't8', category: 'Eyes',       value: 'Laser Eyes',  supply: 18,  rarity: 1.8,  topOffer: 9.20 },
    { id: 't9', category: 'Eyes',       value: 'Heart Eyes',  supply: 56,  rarity: 5.6,  topOffer: 5.80 },
    { id: 'ta', category: 'Skin',       value: 'Gold',        supply: 42,  rarity: 4.2,  topOffer: 6.80 },
  ],
  bayc: [
    { id: 't1', category: 'Fur',        value: 'Gold',        supply: 46,  rarity: 0.5,  topOffer: 58.00 },
    { id: 't2', category: 'Fur',        value: 'Solid Gold',  supply: 22,  rarity: 0.2,  topOffer: 75.00 },
    { id: 't3', category: 'Fur',        value: 'Black',       supply: 384, rarity: 3.8,  topOffer: 16.50 },
    { id: 't4', category: 'Eyes',       value: '3D',          supply: 211, rarity: 2.1,  topOffer: 47.50 },
    { id: 't5', category: 'Eyes',       value: 'Laser Eyes',  supply: 31,  rarity: 0.3,  topOffer: 62.00 },
    { id: 't6', category: 'Mouth',      value: 'Rage',        supply: 84,  rarity: 0.8,  topOffer: 52.00 },
    { id: 't7', category: 'Mouth',      value: 'Grin',        supply: 490, rarity: 4.9,  topOffer: 15.50 },
    { id: 't8', category: 'Hat',        value: 'Bayc Hat Red',supply: 77,  rarity: 0.8,  topOffer: 48.00 },
    { id: 't9', category: 'Clothes',    value: 'Bone Tee',    supply: 112, rarity: 1.1,  topOffer: 42.00 },
  ],
  azuki: [
    { id: 't1', category: 'Type',       value: 'Human',       supply: 819, rarity: 81.9, topOffer: 0.68 },
    { id: 't2', category: 'Type',       value: 'Spirit',      supply: 97,  rarity: 9.7,  topOffer: 1.20 },
    { id: 't3', category: 'Hair',       value: 'Red Spiky',   supply: 129, rarity: 12.9, topOffer: 6.20 },
    { id: 't4', category: 'Hair',       value: 'White',       supply: 58,  rarity: 5.8,  topOffer: 8.40 },
    { id: 't5', category: 'Eyes',       value: 'Crossed',     supply: 267, rarity: 26.7, topOffer: 0.70 },
    { id: 't6', category: 'Eyes',       value: 'Closed',      supply: 188, rarity: 18.8, topOffer: 0.69 },
    { id: 't7', category: 'Clothing',   value: 'Red Kimono',  supply: 144, rarity: 14.4, topOffer: 1.10 },
    { id: 't8', category: 'Background', value: 'Off White A', supply: 214, rarity: 21.4, topOffer: 0.68 },
  ],
  doodles: [
    { id: 't1', category: 'Head',       value: 'Cat',         supply: 88,  rarity: 8.8,  topOffer: 3.10 },
    { id: 't2', category: 'Head',       value: 'Alien',       supply: 34,  rarity: 3.4,  topOffer: 5.80 },
    { id: 't3', category: 'Background', value: 'Pink',        supply: 412, rarity: 41.2, topOffer: 2.60 },
    { id: 't4', category: 'Background', value: 'Gradient',    supply: 211, rarity: 21.1, topOffer: 2.80 },
    { id: 't5', category: 'Face',       value: 'Happy',       supply: 644, rarity: 64.4, topOffer: 2.50 },
    { id: 't6', category: 'Body',       value: 'Holographic', supply: 66,  rarity: 6.6,  topOffer: 4.20 },
  ],
  punks: [
    { id: 't1', category: 'Type',       value: 'Ape',         supply: 24,  rarity: 0.2,  topOffer: 89.00 },
    { id: 't2', category: 'Type',       value: 'Alien',       supply: 9,   rarity: 0.09, topOffer: 320.00 },
    { id: 't3', category: 'Type',       value: 'Zombie',      supply: 88,  rarity: 0.9,  topOffer: 75.00 },
    { id: 't4', category: 'Hat',        value: 'Top Hat',     supply: 115, rarity: 1.1,  topOffer: 46.00 },
    { id: 't5', category: 'Hat',        value: 'Cowboy Hat',  supply: 142, rarity: 1.4,  topOffer: 44.00 },
    { id: 't6', category: 'Eyes',       value: '3D Glasses',  supply: 286, rarity: 2.9,  topOffer: 36.00 },
    { id: 't7', category: 'Mouth',      value: 'Smile',       supply: 238, rarity: 2.4,  topOffer: 33.00 },
  ],
};

// fallback traits for collections without specific data
const DEFAULT_TRAITS = (floor: number): Trait[] => [
  { id: 't1', category: 'Background', value: 'Rare',    supply: 120,  rarity: 1.2,  topOffer: +(floor * 1.15).toFixed(3) },
  { id: 't2', category: 'Background', value: 'Common',  supply: 3400, rarity: 34.0, topOffer: +(floor * 0.98).toFixed(3) },
  { id: 't3', category: 'Type',       value: 'Special', supply: 44,   rarity: 0.4,  topOffer: +(floor * 2.20).toFixed(3) },
  { id: 't4', category: 'Body',       value: 'Gold',    supply: 88,   rarity: 0.9,  topOffer: +(floor * 1.80).toFixed(3) },
  { id: 't5', category: 'Eyes',       value: 'Glowing', supply: 210,  rarity: 2.1,  topOffer: +(floor * 1.30).toFixed(3) },
  { id: 't6', category: 'Hat',        value: 'Crown',   supply: 66,   rarity: 0.7,  topOffer: +(floor * 1.60).toFixed(3) },
];

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

const WALLET_COLORS = ['#2fc4d6', '#a855f7', '#ffb020', '#4fe9b4'];

interface BidWallet {
  id: string; label: string; address: string; color: string;
  ethBalance: number; wethBalance: number;
}

const STATIC_BID_WALLETS: BidWallet[] = [
  { id: 'w1', label: 'Main Wallet',   address: '', color: '#2fc4d6', ethBalance: 4.218,  wethBalance: 1.500 },
  { id: 'w2', label: 'Trading Vault', address: '', color: '#a855f7', ethBalance: 12.044, wethBalance: 8.200 },
  { id: 'w3', label: 'Cold Storage',  address: '', color: '#ffb020', ethBalance: 0.812,  wethBalance: 0.000 },
];

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function BulkBidPage() {
  const [collections, setCollections] = useState<Collection[]>(INITIAL_COLLECTIONS);
  const [tab, setTab] = useState<'top' | 'trending' | 'watchlist'>('top');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('1d');
  const [sortKey, setSortKey] = useState<SortKey>('vol');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [modalCol, setModalCol] = useState<Collection | null>(null);
  const [queue, setQueue] = useState<QueuedBid[]>([]);
  const [tracking, setTracking] = useState(false);
  const [txRows, setTxRows] = useState<Array<{ id: string; label: string; collectionName: string; status: TxStatus; hash: string; price: string }>>([]);
  const [progress, setProgress] = useState(0);

  const [wallets, setWallets] = useState(STATIC_BID_WALLETS);
  const [activeWalletId, setActiveWalletId] = useState('w1');

  useEffect(() => {
    const stored = loadWallets();
    if (stored.length > 0) {
      const mapped: BidWallet[] = stored.map((w, i) => ({
        id: `w${i + 1}`,
        label: w.name,
        address: w.address,
        color: WALLET_COLORS[i % WALLET_COLORS.length],
        ethBalance: 0,
        wethBalance: 0,
      }));
      setWallets(mapped);
      setActiveWalletId(mapped[0].id);
    }
  }, []);

  const toggleStar = (id: string) =>
    setCollections(p => p.map(c => c.id === id ? { ...c, starred: !c.starred } : c));

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sorted = [...collections]
    .filter(c => tab === 'watchlist' ? c.starred : true)
    .sort((a, b) => sortDir === 'asc' ? (a[sortKey] as number) - (b[sortKey] as number) : (b[sortKey] as number) - (a[sortKey] as number));

  const addToQueue = (bids: QueuedBid[]) => {
    setQueue(prev => {
      const next = [...prev];
      for (const bid of bids) {
        const existing = next.findIndex(b => b.uid === bid.uid);
        if (existing >= 0) next[existing] = bid;
        else next.push(bid);
      }
      return next;
    });
  };

  const removeFromQueue = (uid: string) => setQueue(p => p.filter(b => b.uid !== uid));

  const totalEth = queue.reduce((s, b) => s + (parseFloat(b.price) || 0), 0);

  const placeBids = async () => {
    const rows = queue.map(b => ({
      id: b.uid, label: b.label, collectionName: b.collectionName,
      status: 'Pending' as TxStatus, hash: fakeHash(), price: b.price,
    }));
    setTxRows(rows); setProgress(0); setTracking(true);

    if (isTauri) {
      let apiKey = '';
      const activeWallet = wallets.find(w => w.id === activeWalletId);
      const walletAddress = activeWallet?.address ?? '';
      try { apiKey = await loadAlchemyKey(); } catch { /* key not set */ }

      for (let i = 0; i < rows.length; i++) {
        const bid = queue[i];
        setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Signing' } : x));
        try {
          const result = await marketplacePlaceBid({
            walletAddress,
            contractAddress: bid.collectionId,
            priceEth: parseFloat(bid.price) || 0,
            quantity: 1,
            marketplace: 'opensea',
            expiryHours: 24,
            apiKey,
          });
          const status: TxStatus = result.error ? 'Failed' : 'Broadcasting';
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status } : x));
          await new Promise(res => setTimeout(res, 400));
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: result.error ? 'Failed' : 'Confirmed' } : x));
        } catch {
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Failed' } : x));
        }
        setProgress(Math.round(((i + 1) / rows.length) * 100));
      }
    } else {
      rows.forEach((_, i) => {
        const d = i * 900;
        setTimeout(() => setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Signing' } : x)), d + 200);
        setTimeout(() => setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Broadcasting' } : x)), d + 600);
        setTimeout(() => {
          setTxRows(r => r.map((x, j) => j === i ? { ...x, status: 'Confirmed' } : x));
          setProgress(Math.round(((i + 1) / rows.length) * 100));
        }, d + 1400);
      });
    }
  };

  // ── Tracking View ────────────────────────────────────────────────────────────
  if (tracking) {
    const done = txRows.filter(r => r.status === 'Confirmed' || r.status === 'Failed').length;
    return (
      <main style={{ backgroundColor: 'var(--wr-bg)', minHeight: '100%', padding: '28px 48px 48px', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '32px' }}>
          <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Bulk Actions</Link>
          <span>›</span>
          <span style={{ color: 'var(--wr-accent)', cursor: 'pointer' }} onClick={() => { setTracking(false); setQueue([]); }}>Bulk Bid</span>
          <span>›</span>
          <span style={{ color: 'var(--wr-text)' }}>Tracking</span>
        </div>
        <h2 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px' }}>Placing {txRows.length} Bid{txRows.length !== 1 ? 's' : ''}</h2>
        <p style={{ fontSize: '13px', color: 'var(--wr-text-3)', marginBottom: '28px' }}>{done} of {txRows.length} confirmed</p>
        <div style={{ height: '4px', backgroundColor: 'var(--wr-border)', borderRadius: '2px', marginBottom: '32px' }}>
          <div style={{ height: '100%', width: `${progress}%`, backgroundColor: '#2fc4d6', borderRadius: '2px', transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ border: '1px solid var(--wr-border)', borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--wr-surface)', borderBottom: '1px solid var(--wr-border)' }}>
                {['Collection', 'Bid Type', 'Price', 'Tx Hash', 'Status'].map(h => (
                  <th key={h} style={{ padding: '12px 16px', textAlign: 'left', fontSize: '11px', color: '#555', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txRows.map(row => (
                <tr key={row.id} style={{ borderBottom: '1px solid #111' }}>
                  <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--wr-text)' }}>{row.collectionName}</td>
                  <td style={{ padding: '14px 16px', fontSize: '12px', color: 'var(--wr-text-3)' }}>{row.label}</td>
                  <td style={{ padding: '14px 16px', fontSize: '13px', color: 'var(--wr-accent)', fontFamily: 'var(--font-jetbrains)' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{row.price}</td>
                  <td style={{ padding: '14px 16px', fontSize: '12px', color: '#555', fontFamily: 'monospace' }}>{row.hash}</td>
                  <td style={{ padding: '14px 16px' }}>
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

  // ── Main ─────────────────────────────────────────────────────────────────────
  const TH = ({ label, k, align = 'right' }: { label: string; k: SortKey; align?: 'left' | 'right' }) => {
    const active = sortKey === k;
    return (
      <th onClick={() => handleSort(k)} style={{ padding: '7px 12px', textAlign: align, fontSize: '10px', color: active ? '#2fc4d6' : '#555', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
        {label} {active ? (sortDir === 'desc' ? '↓' : '↑') : <span style={{ opacity: 0.4 }}>↕</span>}
      </th>
    );
  };

  return (
    <ProGate feature="Bulk Bid">
    <>
      <main style={{ backgroundColor: 'var(--wr-bg)', minHeight: '100%', color: 'var(--wr-text)', fontFamily: 'var(--font-jetbrains)', display: 'flex', flexDirection: 'column', paddingBottom: queue.length > 0 ? '80px' : '0' }}>

        {/* Breadcrumb */}
        <div style={{ padding: '20px 32px 0', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', color: 'var(--wr-text-3)', fontFamily: 'var(--font-jetbrains)' }}>
          <Link href="/bulk" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Bulk Actions</Link>
          <span>›</span>
          <span style={{ color: 'var(--wr-text)' }}>Bulk Bid</span>
        </div>

        {/* Top controls */}
        <div style={{ padding: '16px 32px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', borderBottom: '1px solid #111' }}>
          <div style={{ display: 'flex', gap: '4px' }}>
            {(['top', 'trending', 'watchlist'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)',
                backgroundColor: tab === t ? '#2fc4d61A' : 'transparent', color: tab === t ? '#2fc4d6' : '#6e7590' }}>
                {t === 'watchlist' ? '★ Watchlist' : t === 'trending' ? '↗ Trending' : '◉ Top'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '2px', backgroundColor: 'var(--wr-surface)', borderRadius: '8px', padding: '3px' }}>
            {(['all', '30d', '7d', '1d', '1h', '15m'] as const).map(t => (
              <button key={t} onClick={() => setTimeFilter(t as TimeFilter)} style={{ padding: '4px 10px', borderRadius: '5px', fontSize: '11px', fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', textTransform: 'uppercase',
                backgroundColor: timeFilter === t ? 'var(--wr-overlay)' : 'transparent', color: timeFilter === t ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Wallet selector ─────────────────────────────────────────────────── */}
        <div style={{ padding: '12px 32px', borderBottom: '1px solid #10121b', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '4px', flexShrink: 0 }}>Bid from</span>
          {wallets.map(w => {
            const active = activeWalletId === w.id;
            return (
              <button key={w.id} onClick={() => setActiveWalletId(w.id)}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px', padding: '7px 14px', borderRadius: '6px', border: `1px solid ${active ? w.color + '55' : '#14161f'}`, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', backgroundColor: active ? w.color + '18' : 'transparent' }}>
                {/* Name row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: active ? w.color : '#232533', flexShrink: 0 }} />
                  <span style={{ fontSize: '12px', fontWeight: 600, color: active ? w.color : 'var(--wr-text-3)' }}>{w.label}</span>
                </div>
                {/* Balance row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '12px' }}>
                  <span style={{ fontSize: '11px', color: active ? 'var(--wr-text-2)' : '#444' }}>
                    <span style={{ color: active ? w.color : '#555', fontWeight: 600 }}>{w.ethBalance.toFixed(3)}</span>
                    <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
                  </span>
                  <span style={{ color: '#232533', fontSize: '10px' }}>·</span>
                  <span style={{ fontSize: '11px', color: active ? 'var(--wr-text-2)' : '#444' }}>
                    <span style={{ color: active ? '#a78bfa' : '#555', fontWeight: 600 }}>{w.wethBalance.toFixed(3)}</span>
                    <span style={{ color: '#444', marginLeft: '2px' }}>WETH</span>
                  </span>
                </div>
              </button>
            );
          })}
          {(() => {
            const w = wallets.find(x => x.id === activeWalletId);
            return w?.address ? (
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#444', fontFamily: 'monospace' }}>
                {w.address.slice(0, 6)}…{w.address.slice(-4)}
              </span>
            ) : null;
          })()}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '860px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'var(--wr-bg)' }}>
              <tr style={{ borderBottom: '1px solid #111' }}>
                <th style={{ width: '28px', padding: '7px 6px 7px 24px' }} />
                <th style={{ padding: '7px 12px', textAlign: 'left', fontSize: '10px', color: '#555', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Collection</th>
                <TH label="Floor Price" k="floor" />
                <TH label={`${timeFilter.toUpperCase()} Change`} k="change" />
                <TH label="Top Offer" k="topOffer" />
                <TH label={`${timeFilter.toUpperCase()} Vol`} k="vol" />
                <TH label="Sales" k="sales" />
                <TH label="Owners" k="owners" />
                <TH label="Supply" k="supply" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((col, idx) => {
                const inQueue = queue.some(b => b.collectionId === col.id);
                return (
                  <CollectionRow key={col.id} col={col} idx={idx} inQueue={inQueue}
                    onStar={() => toggleStar(col.id)}
                    onClick={() => setModalCol(col)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── Bid Queue Bottom Bar ─────────────────────────────────────────────── */}
      {queue.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 40, backgroundColor: 'var(--wr-surface-alt)', borderTop: '1px solid #2fc4d633', boxShadow: '0 -8px 32px rgba(0,0,0,0.7)', padding: '0 32px', height: '68px', display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Bid chips */}
          <div style={{ flex: 1, display: 'flex', gap: '8px', overflowX: 'auto', alignItems: 'center' }}>
            {queue.map(bid => (
              <div key={bid.uid} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', borderRadius: '6px', padding: '4px 10px', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{ fontSize: '13px' }}>{bid.emoji}</span>
                <span style={{ fontSize: '11px', color: 'var(--wr-text-2)' }}>{bid.collectionName}</span>
                <span style={{ fontSize: '11px', color: '#555' }}>·</span>
                <span style={{ fontSize: '11px', color: 'var(--wr-text-3)' }}>{bid.label}</span>
                <span style={{ fontSize: '11px', color: '#2fc4d6', marginLeft: '4px' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{bid.price}</span>
                <button onClick={() => removeFromQueue(bid.uid)} style={{ background: 'none', border: 'none', color: '#444', fontSize: '13px', cursor: 'pointer', lineHeight: 1, marginLeft: '2px', padding: 0 }}>×</button>
              </div>
            ))}
          </div>
          {/* Total + CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexShrink: 0 }}>
            {(() => {
              const w = wallets.find(x => x.id === activeWalletId);
              return w ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: w.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '11px', fontWeight: 600, color: w.color, fontFamily: 'var(--font-jetbrains)' }}>{w.label}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', paddingLeft: '12px' }}>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains)' }}>
                      <span style={{ color: w.color, fontWeight: 600 }}>{w.ethBalance.toFixed(3)}</span>
                      <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
                    </span>
                    <span style={{ color: '#333', fontSize: '10px' }}>·</span>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-jetbrains)' }}>
                      <span style={{ color: '#a78bfa', fontWeight: 600 }}>{w.wethBalance.toFixed(3)}</span>
                      <span style={{ color: '#555', marginLeft: '2px' }}>WETH</span>
                    </span>
                  </div>
                </div>
              ) : null;
            })()}
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '11px', color: '#555' }}>{queue.length} bid{queue.length !== 1 ? 's' : ''}</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#2fc4d6' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{totalEth.toFixed(4)}</div>
            </div>
            <button onClick={placeBids} style={{ height: '40px', padding: '0 24px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, backgroundColor: '#2fc4d6', color: '#000' }}>
              Place {queue.length} Bid{queue.length !== 1 ? 's' : ''} →
            </button>
          </div>
        </div>
      )}

      {/* ── Collection Modal ─────────────────────────────────────────────────── */}
      {modalCol && (
        <CollectionModal
          col={modalCol}
          traits={COLLECTION_TRAITS[modalCol.id] ?? DEFAULT_TRAITS(modalCol.floor)}
          existingBids={queue.filter(b => b.collectionId === modalCol.id)}
          onAdd={addToQueue}
          onRemove={removeFromQueue}
          onClose={() => setModalCol(null)}
        />
      )}
    </>
    </ProGate>
  );
}

// ─── Collection Table Row ──────────────────────────────────────────────────────

function CollectionRow({ col, idx, inQueue, onStar, onClick }: {
  col: Collection; idx: number; inQueue: boolean;
  onStar: () => void; onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const pos = col.change >= 0;
  const volStr = col.vol >= 1000 ? `${(col.vol / 1000).toFixed(1)}K` : `${col.vol}`;

  return (
    <tr onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onClick}
      style={{ borderBottom: '1px solid var(--wr-border)', backgroundColor: inQueue ? '#2fc4d608' : hover ? 'var(--wr-hover-bg)' : 'transparent', transition: 'background-color 0.1s', cursor: 'pointer' }}>
      <td style={{ padding: '7px 6px 7px 24px' }} onClick={e => { e.stopPropagation(); onStar(); }}>
        <span style={{ color: col.starred ? '#ffb020' : hover ? '#444' : '#232533', fontSize: '16px', cursor: 'pointer', transition: 'color 0.1s' }}>★</span>
      </td>
      <td style={{ padding: '7px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '10px', color: '#333', width: '18px', textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
          <div style={{ width: '28px', height: '28px', borderRadius: '6px', backgroundColor: col.color + '26', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{col.emoji}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)' }}>{col.name}</span>
            {col.verified && <span style={{ fontSize: '10px', color: '#2fc4d6' }}>✓</span>}
          </div>
          {inQueue && <span style={{ fontSize: '9px', color: '#2fc4d6', backgroundColor: '#2fc4d61A', border: '1px solid #2fc4d633', borderRadius: '4px', padding: '1px 5px' }}>Bidding</span>}
        </div>
      </td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>
        {col.floor >= 100 ? `${col.floor.toFixed(0)} USDC` : <>{col.floor}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></>}
      </td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: pos ? '#4fe9b4' : '#ff8a96', whiteSpace: 'nowrap' }}>
        {col.change === 0 ? '0%' : `${pos ? '+' : ''}${col.change}%`}
      </td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text-2)', whiteSpace: 'nowrap' }}>
        {col.topOffer > 0 ? `${col.topOffer} WETH` : '—'}
      </td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>{volStr}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text-2)', whiteSpace: 'nowrap' }}>{col.sales.toLocaleString()}</td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text-2)', whiteSpace: 'nowrap' }}>{col.owners.toLocaleString()}</td>
      <td style={{ padding: '7px 12px', textAlign: 'right', fontSize: '12px', color: 'var(--wr-text-2)', whiteSpace: 'nowrap' }}>{col.supply.toLocaleString()}</td>
    </tr>
  );
}

// ─── Collection Modal ──────────────────────────────────────────────────────────

function CollectionModal({ col, traits, existingBids, onAdd, onRemove, onClose }: {
  col: Collection;
  traits: Trait[];
  existingBids: QueuedBid[];
  onAdd: (bids: QueuedBid[]) => void;
  onRemove: (uid: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'collection' | 'traits'>('collection');
  const [collectionPrice, setCollectionPrice] = useState(
    col.topOffer > 0 ? col.topOffer.toString() : col.floor.toFixed(4)
  );
  // Per-trait bid prices and selection
  const [traitPrices, setTraitPrices] = useState<Record<string, string>>(
    Object.fromEntries(traits.map(t => [t.id, t.topOffer.toString()]))
  );
  const [selectedTraits, setSelectedTraits] = useState<Set<string>>(new Set());
  // Accordion — all categories open by default
  const [openCats, setOpenCats] = useState<Set<string>>(new Set(Array.from(new Set(traits.map(t => t.category)))));
  const toggleCat = (cat: string) => setOpenCats(s => { const n = new Set(s); n.has(cat) ? n.delete(cat) : n.add(cat); return n; });

  const collBidUid = `${col.id}::collection`;
  const collectionBidExists = existingBids.some(b => b.uid === collBidUid);

  const toggleTrait = (id: string) => {
    setSelectedTraits(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAddCollection = () => {
    if (collectionBidExists) { onRemove(collBidUid); onClose(); return; }
    onAdd([{ uid: collBidUid, collectionId: col.id, collectionName: col.name, emoji: col.emoji, color: col.color, label: 'Collection Offer', price: collectionPrice }]);
    onClose();
  };

  const handleAddTraits = () => {
    const bids: QueuedBid[] = [];
    for (const tid of selectedTraits) {
      const t = traits.find(x => x.id === tid)!;
      bids.push({ uid: `${col.id}::${tid}`, collectionId: col.id, collectionName: col.name, emoji: col.emoji, color: col.color, label: `${t.category}: ${t.value}`, price: traitPrices[tid] });
    }
    if (bids.length) { onAdd(bids); onClose(); }
  };

  // Group traits by category
  const categories = Array.from(new Set(traits.map(t => t.category)));

  const pos = col.change >= 0;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: '740px', maxWidth: '95vw', height: '660px', maxHeight: '90vh', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', borderRadius: '16px', display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: 'var(--font-jetbrains)' }}>

        {/* ── Modal Header ─────────────────────────────────────────────────── */}
        <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid var(--wr-border)' }}>
          {/* Close */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          {/* Collection identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '12px', backgroundColor: col.color + '26', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', flexShrink: 0 }}>{col.emoji}</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--wr-text)' }}>{col.name}</span>
                {col.verified && <span style={{ fontSize: '12px', color: '#2fc4d6' }}>✓</span>}
              </div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '4px', maxWidth: '420px' }}>{col.desc}</div>
            </div>
          </div>
          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0', border: '1px solid var(--wr-border)', borderRadius: '10px', overflow: 'hidden' }}>
            {[
              { label: 'Floor', value: `${col.floor} ETH` },
              { label: `${1}D Change`, value: `${pos ? '+' : ''}${col.change}%`, color: pos ? '#4fe9b4' : '#ff8a96' },
              { label: 'Top Offer', value: col.topOffer > 0 ? `${col.topOffer} WETH` : '—' },
              { label: '1D Volume', value: `${col.vol} ETH` },
              { label: 'Owners', value: col.owners.toLocaleString() },
              { label: 'Supply', value: col.supply.toLocaleString() },
            ].map((stat, i) => (
              <div key={stat.label} style={{ padding: '12px 14px', borderLeft: i > 0 ? '1px solid #14161f' : 'none' }}>
                <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{stat.label}</div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: stat.color ?? '#f2f2f7' }}>{stat.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div style={{ padding: '0 28px', borderBottom: '1px solid var(--wr-border)', display: 'flex', gap: '0' }}>
          {(['collection', 'traits'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              style={{ padding: '12px 20px', fontSize: '13px', fontWeight: 500, border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', background: 'none', textTransform: 'capitalize',
                color: activeTab === t ? '#f2f2f7' : '#555',
                borderBottom: activeTab === t ? `2px solid #2fc4d6` : '2px solid transparent',
              }}>
              {t === 'collection' ? 'Collection Offer' : `Trait Bids (${traits.length})`}
            </button>
          ))}
        </div>

        {/* ── Tab Content ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', scrollbarWidth: 'thin', scrollbarColor: '#232533 transparent' }}>

          {/* Collection Offer tab */}
          {activeTab === 'collection' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <p style={{ fontSize: '13px', color: 'var(--wr-text-3)', margin: 0 }}>
                Place a collection-wide offer. Any NFT from <strong style={{ color: 'var(--wr-text)' }}>{col.name}</strong> that matches can fill your bid.
              </p>
              {/* Price input */}
              <div>
                <div style={{ fontSize: '11px', color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Offer Price</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border-hover)', borderRadius: '8px', padding: '10px 14px' }}>
                    <EthIcon size={10} color="#2fc4d6" style={{ verticalAlign: 'middle', marginRight: 2 }} />
                    <input type="number" value={collectionPrice} onChange={e => setCollectionPrice(e.target.value)} step="0.001" min="0"
                      style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--wr-text)', fontSize: '16px', fontFamily: 'var(--font-jetbrains)', fontWeight: 600 }} />
                    <span style={{ fontSize: '12px', color: '#555' }}>WETH</span>
                  </div>
                  <div style={{ fontSize: '12px', color: '#555', whiteSpace: 'nowrap' }}>
                    Floor: <span style={{ color: 'var(--wr-text-2)' }}>{col.floor}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></span>
                  </div>
                </div>
                {/* % of floor */}
                <div style={{ fontSize: '11px', color: '#555', marginTop: '6px' }}>
                  {col.floor > 0 ? `${((parseFloat(collectionPrice) / col.floor) * 100).toFixed(1)}% of floor` : ''}
                </div>
              </div>
              {/* Quick price buttons */}
              <div>
                <div style={{ fontSize: '11px', color: '#555', marginBottom: '8px' }}>Quick set</div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {[['Floor', col.floor], ['−5%', col.floor * 0.95], ['Top Offer', col.topOffer || col.floor], ['−10%', col.floor * 0.90]].map(([label, val]) => (
                    <button key={label as string} onClick={() => setCollectionPrice((val as number).toFixed(4))}
                      style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '11px', border: '1px solid var(--wr-border)', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', backgroundColor: 'transparent', color: 'var(--wr-text-3)' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* Expiry */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ fontSize: '12px', color: '#555' }}>Expiry</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {['1h', '12h', '24h', '7d', '30d'].map((e, i) => (
                    <button key={e} style={{ padding: '4px 10px', borderRadius: '5px', fontSize: '11px', border: '1px solid', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)',
                      backgroundColor: i === 2 ? 'var(--wr-overlay)' : 'transparent', borderColor: i === 2 ? 'var(--wr-border-hover)' : 'var(--wr-border)', color: i === 2 ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>{e}</button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Trait Bids tab */}
          {activeTab === 'traits' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ marginBottom: '14px', fontSize: '12px', color: '#555' }}>
                Select traits to bid on. Each trait is a separate bid.
              </div>
              {categories.map(cat => {
                const catTraits = traits.filter(t => t.category === cat);
                const isOpen = openCats.has(cat);
                const selectedInCat = catTraits.filter(t => selectedTraits.has(t.id)).length;
                return (
                  <div key={cat} style={{ border: '1px solid var(--wr-border)', borderRadius: '8px', overflow: 'hidden', marginBottom: '4px' }}>
                    {/* Accordion header */}
                    <div onClick={() => toggleCat(cat)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 14px', cursor: 'pointer', backgroundColor: isOpen ? 'var(--wr-surface)' : 'transparent', userSelect: 'none' }}
                      onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-surface)'; }}
                      onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-2)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{cat}</span>
                        <span style={{ fontSize: '10px', color: '#444' }}>{catTraits.length} traits</span>
                        {selectedInCat > 0 && (
                          <span style={{ fontSize: '9px', color: '#2fc4d6', backgroundColor: '#2fc4d61A', border: '1px solid #2fc4d633', borderRadius: '4px', padding: '1px 6px' }}>{selectedInCat} selected</span>
                        )}
                      </div>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                        style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', flexShrink: 0 }}>
                        <path d="M2 4L6 8L10 4" stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    {/* Accordion body */}
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--wr-border)' }}>
                        {/* Column headers */}
                        <div style={{ display: 'grid', gridTemplateColumns: '20px 1fr 70px 85px 110px', gap: '12px', alignItems: 'center', padding: '6px 14px', backgroundColor: 'var(--wr-overlay)' }}>
                          <div />
                          <span style={{ fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Value</span>
                          <span style={{ fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'right' }}>Rarity</span>
                          <span style={{ fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'right' }}>Supply</span>
                          <span style={{ fontSize: '9px', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'right' }}>Bid (WETH)</span>
                        </div>
                        {catTraits.map(trait => {
                          const sel = selectedTraits.has(trait.id);
                          const uid = `${col.id}::${trait.id}`;
                          const inQueue = existingBids.some(b => b.uid === uid);
                          return (
                            <div key={trait.id}
                              onClick={() => toggleTrait(trait.id)}
                              style={{ display: 'grid', gridTemplateColumns: '20px 1fr 70px 85px 110px', gap: '12px', alignItems: 'center', padding: '8px 14px', cursor: 'pointer', borderTop: '1px solid #0b0c14',
                                backgroundColor: sel ? '#2fc4d608' : inQueue ? '#2fc4d604' : 'transparent',
                              }}>
                              {/* Checkbox */}
                              <div style={{ width: '13px', height: '13px', borderRadius: '3px', border: `1.5px solid ${sel ? '#2fc4d6' : '#333'}`, backgroundColor: sel ? '#2fc4d6' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {sel && <span style={{ color: '#000', fontSize: '9px', lineHeight: 1 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: '12px', color: 'var(--wr-text)', fontWeight: sel ? 500 : 400 }}>{trait.value}</span>
                              <span style={{ fontSize: '11px', color: trait.rarity < 1 ? '#ff8a96' : trait.rarity < 5 ? '#ffb020' : '#6e7590', textAlign: 'right' }}>{trait.rarity}%</span>
                              <span style={{ fontSize: '11px', color: '#555', textAlign: 'right' }}>{trait.supply.toLocaleString()}</span>
                              <div onClick={e => e.stopPropagation()}
                                style={{ display: 'flex', alignItems: 'center', gap: '4px', backgroundColor: 'var(--wr-surface)', border: `1px solid ${sel ? '#2fc4d655' : 'var(--wr-border)'}`, borderRadius: '5px', padding: '4px 8px' }}>
                                <EthIcon size={10} color="#2fc4d6" style={{ verticalAlign: 'middle', marginRight: 2 }} />
                                <input type="number" value={traitPrices[trait.id]} onChange={e => setTraitPrices(p => ({ ...p, [trait.id]: e.target.value }))} step="0.001" min="0"
                                  style={{ width: '60px', background: 'none', border: 'none', outline: 'none', color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', textAlign: 'right' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Modal Footer ─────────────────────────────────────────────────── */}
        <div style={{ padding: '16px 28px', borderTop: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ fontSize: '12px', color: '#555' }}>
            {activeTab === 'collection'
              ? (collectionBidExists ? <span style={{ color: '#2fc4d6' }}>✓ Collection offer queued</span> : 'Add to bid queue')
              : selectedTraits.size > 0
                ? <span>{selectedTraits.size} trait{selectedTraits.size !== 1 ? 's' : ''} selected · <EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle', marginRight: 2 }} />{Array.from(selectedTraits).reduce((s, id) => s + (parseFloat(traitPrices[id]) || 0), 0).toFixed(4)}</span>
                : 'Select traits above'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ height: '38px', padding: '0 18px', borderRadius: '7px', border: '1px solid var(--wr-border-hover)', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', backgroundColor: 'transparent', color: 'var(--wr-text-3)' }}>
              Cancel
            </button>
            {activeTab === 'collection' ? (
              <button onClick={handleAddCollection}
                style={{ height: '38px', padding: '0 20px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600,
                  backgroundColor: collectionBidExists ? 'var(--wr-overlay)' : '#2fc4d6', color: collectionBidExists ? '#ff8a96' : '#000' }}>
                {collectionBidExists ? 'Remove Bid' : 'Add Collection Bid →'}
              </button>
            ) : (
              <button onClick={handleAddTraits} disabled={selectedTraits.size === 0}
                style={{ height: '38px', padding: '0 20px', borderRadius: '7px', border: 'none', cursor: selectedTraits.size > 0 ? 'pointer' : 'default', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600,
                  backgroundColor: selectedTraits.size > 0 ? '#2fc4d6' : '#111', color: selectedTraits.size > 0 ? '#000' : '#333' }}>
                {selectedTraits.size > 0 ? `Add ${selectedTraits.size} Trait Bid${selectedTraits.size !== 1 ? 's' : ''} →` : 'Add Trait Bids →'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
