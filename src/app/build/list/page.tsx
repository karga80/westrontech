'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import { getNftsForOwner, loadAlchemyKey, marketplaceListNft, type OwnedNft } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import ProGate from '@/components/ProGate';
import EthIcon from '@/components/EthIcon';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
import { MOCK_NFTS_RESPONSE } from '@/lib/mockData';
import { Tag, type TagVariant } from '@/components/Tag';

// ─── Types & Data ─────────────────────────────────────────────────────────────

type TxStatus = 'Pending' | 'Signing' | 'Broadcasting' | 'Confirmed' | 'Failed';

const COL_COLORS = ['#f59e0b', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#06b6d4', '#ec4899'];

function ownedNftToNFT(nft: OwnedNft, idx: number, walletId: string): NFT {
  const colName = nft.contract.opensea_collection_name || nft.contract.name || nft.contract.address;
  const colColor = COL_COLORS[Math.abs(colName.split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % COL_COLORS.length];
  return {
    id: idx,
    name: nft.name || `${nft.contract.name ?? 'NFT'} #${nft.token_id}`,
    collection: colName,
    collectionColor: colColor,
    wallet: walletId,
    floor: nft.contract.opensea_floor_price ?? 0,
    rank: '—',
    emoji: '◆',
    listed: false,
    listedPrice: null,
  };
}

const STATIC_WALLETS = [
  { id: 'main', name: 'Main Wallet',  address: '0x3f4a…A91c', nftCount: 7 },
  { id: 'defi', name: 'DeFi Wallet',  address: '0x1234…5678', nftCount: 3 },
  { id: 'cold', name: 'Polygon Cold', address: '0xabcd…ef12', nftCount: 5 },
];

interface NFT {
  id: number; name: string; collection: string; collectionColor: string;
  wallet: string; floor: number; rank: string; emoji: string;
  listed: boolean; listedPrice: string | null;
}

const STATIC_NFTS: NFT[] = [
  { id: 1,  name: 'BAYC #3291',      collection: 'Bored Ape YC',  collectionColor: '#f59e0b', wallet: 'main', floor: 23.5, rank: '892',  emoji: '🦍', listed: false, listedPrice: null },
  { id: 2,  name: 'BAYC #7421',      collection: 'Bored Ape YC',  collectionColor: '#f59e0b', wallet: 'main', floor: 23.5, rank: '1204', emoji: '🦍', listed: false, listedPrice: null },
  { id: 3,  name: 'Azuki #1108',     collection: 'Azuki',          collectionColor: '#f87171', wallet: 'main', floor: 34.2, rank: '340',  emoji: '⛩', listed: true,  listedPrice: '35.0 ETH' },
  { id: 4,  name: 'Doodles #3921',   collection: 'Doodles',        collectionColor: '#60a5fa', wallet: 'main', floor: 2.9,  rank: '5821', emoji: '🌈', listed: false, listedPrice: null },
  { id: 5,  name: 'Doodles #8042',   collection: 'Doodles',        collectionColor: '#60a5fa', wallet: 'main', floor: 2.9,  rank: '3244', emoji: '🌈', listed: false, listedPrice: null },
  { id: 6,  name: 'Pudgy #8234',     collection: 'Pudgy Penguins', collectionColor: '#34d399', wallet: 'main', floor: 4.5,  rank: '340',  emoji: '🐧', listed: false, listedPrice: null },
  { id: 15, name: 'Doodles #0512',   collection: 'Doodles',        collectionColor: '#60a5fa', wallet: 'main', floor: 2.9,  rank: '512',  emoji: '🌈', listed: true,  listedPrice: '3.2 ETH' },
  { id: 7,  name: 'Azuki #4492',     collection: 'Azuki',          collectionColor: '#f87171', wallet: 'defi', floor: 34.2, rank: '582',  emoji: '⛩', listed: false, listedPrice: null },
  { id: 8,  name: 'Clonex #9912',    collection: 'Clonex',         collectionColor: '#a78bfa', wallet: 'defi', floor: 4.1,  rank: '1892', emoji: '🤖', listed: true,  listedPrice: '4.2 ETH' },
  { id: 9,  name: 'Pudgy #9053',     collection: 'Pudgy Penguins', collectionColor: '#34d399', wallet: 'defi', floor: 4.5,  rank: '982',  emoji: '🐧', listed: false, listedPrice: null },
  { id: 10, name: 'BAYC #9053',      collection: 'Bored Ape YC',  collectionColor: '#f59e0b', wallet: 'cold', floor: 23.5, rank: '421',  emoji: '🦍', listed: false, listedPrice: null },
  { id: 11, name: 'Moonbirds #1847', collection: 'Moonbirds',      collectionColor: '#fbbf24', wallet: 'cold', floor: 1.8,  rank: '2847', emoji: '🦉', listed: false, listedPrice: null },
  { id: 12, name: 'Moonbirds #4231', collection: 'Moonbirds',      collectionColor: '#fbbf24', wallet: 'cold', floor: 1.8,  rank: '4102', emoji: '🦉', listed: false, listedPrice: null },
  { id: 13, name: 'Doodles #7291',   collection: 'Doodles',        collectionColor: '#60a5fa', wallet: 'cold', floor: 2.9,  rank: '6710', emoji: '🌈', listed: false, listedPrice: null },
  { id: 14, name: 'Pudgy #4492',     collection: 'Pudgy Penguins', collectionColor: '#34d399', wallet: 'cold', floor: 4.5,  rank: '173',  emoji: '🐧', listed: false, listedPrice: null },
];

// Trait data per collection — each NFT gets a seeded slice based on id.
// floor      = lowest listing price for NFTs holding this trait
// offerFloor = highest open collection bid for NFTs holding this trait
interface NFTTrait { type: string; value: string; rarity: number; floor: number; offerFloor: number; }

const COLLECTION_TRAITS: Record<string, NFTTrait[]> = {
  'Bored Ape YC': [
    { type: 'Background', value: 'Army Green',      rarity: 12.4, floor: 26.2, offerFloor: 24.1 },
    { type: 'Fur',        value: 'Golden Brown',     rarity:  4.8, floor: 28.9, offerFloor: 26.5 },
    { type: 'Eyes',       value: 'Bored',            rarity: 22.1, floor: 25.1, offerFloor: 23.5 },
    { type: 'Mouth',      value: 'Bored Unshaven',   rarity:  7.6, floor: 27.3, offerFloor: 25.0 },
    { type: 'Clothes',    value: 'Striped Tee',      rarity:  8.2, floor: 27.0, offerFloor: 24.8 },
  ],
  'Azuki': [
    { type: 'Type',       value: 'Human',            rarity: 81.9, floor: 36.1, offerFloor: 34.2 },
    { type: 'Hair',       value: 'Red Spiky',        rarity: 12.9, floor: 41.0, offerFloor: 38.0 },
    { type: 'Eyes',       value: 'Determined',       rarity: 26.7, floor: 37.8, offerFloor: 35.1 },
    { type: 'Clothing',   value: 'White Qipao',      rarity:  3.1, floor: 55.5, offerFloor: 52.0 },
    { type: 'Background', value: 'Off White A',      rarity: 17.2, floor: 37.2, offerFloor: 34.5 },
  ],
  'Doodles': [
    { type: 'Background', value: 'Gradient 1',       rarity: 18.4, floor:  3.3, offerFloor:  3.0 },
    { type: 'Head',       value: 'Pink Puff',        rarity:  9.2, floor:  3.7, offerFloor:  3.4 },
    { type: 'Face',       value: 'Happy',            rarity: 31.0, floor:  3.1, offerFloor:  2.9 },
    { type: 'Body',       value: 'Purple Fleece',    rarity:  6.7, floor:  3.9, offerFloor:  3.6 },
    { type: 'Accessories',value: 'Headphones',       rarity:  4.1, floor:  4.5, offerFloor:  4.1 },
  ],
  'Pudgy Penguins': [
    { type: 'Background', value: 'Blue',             rarity:  7.4, floor:  5.3, offerFloor:  4.9 },
    { type: 'Skin',       value: 'Normal',           rarity: 68.2, floor:  4.8, offerFloor:  4.5 },
    { type: 'Head',       value: 'Beanie',           rarity:  3.2, floor:  6.7, offerFloor:  6.2 },
    { type: 'Body',       value: 'Turtleneck',       rarity:  5.8, floor:  5.5, offerFloor:  5.1 },
    { type: 'Eyes',       value: 'Half Closed',      rarity: 11.3, floor:  5.1, offerFloor:  4.7 },
  ],
  'Clonex': [
    { type: 'DNA',        value: 'Human',            rarity: 93.4, floor:  4.4, offerFloor:  4.1 },
    { type: 'Eye Color',  value: 'Hazel',            rarity: 21.0, floor:  4.5, offerFloor:  4.2 },
    { type: 'Body',       value: 'White Suit',       rarity:  8.4, floor:  5.4, offerFloor:  5.0 },
    { type: 'Jewellery',  value: 'Gold Chain',       rarity:  6.1, floor:  5.7, offerFloor:  5.3 },
    { type: 'Background', value: 'Purple',           rarity: 14.2, floor:  4.6, offerFloor:  4.3 },
  ],
  'Moonbirds': [
    { type: 'Body',       value: 'Crescent',         rarity: 15.6, floor:  2.1, offerFloor:  1.9 },
    { type: 'Eyes',       value: 'Open',             rarity: 28.8, floor:  2.0, offerFloor:  1.8 },
    { type: 'Headwear',   value: 'Durag',            rarity:  4.3, floor:  2.7, offerFloor:  2.5 },
    { type: 'Beak',       value: 'Short',            rarity: 62.1, floor:  2.0, offerFloor:  1.8 },
    { type: 'Background', value: 'Pink',             rarity: 11.7, floor:  2.1, offerFloor:  1.9 },
  ],
};

function getNftTraits(nft: NFT): NFTTrait[] {
  const base = COLLECTION_TRAITS[nft.collection] ?? [];
  // Rotate the array by NFT id so each card shows slightly different traits
  const offset = nft.id % base.length;
  return [...base.slice(offset), ...base.slice(0, offset)].map((t, i) => ({
    ...t,
    // Vary rarity + prices slightly per NFT so cards aren't identical
    rarity: Math.round((t.rarity + ((nft.id * (i + 1)) % 5) - 2) * 10) / 10,
    floor: Math.round((t.floor + ((nft.id % 3) - 1) * 0.2) * 100) / 100,
    offerFloor: Math.round((t.offerFloor + ((nft.id % 3) - 1) * 0.2) * 100) / 100,
  }));
}

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

// ─── Tracking View ────────────────────────────────────────────────────────────

function TrackingView({ nftIds, prices, marketplace, onDone, allNfts }: {
  nftIds: number[];
  prices: Record<number, string>;
  marketplace: string;
  onDone: (confirmed: Set<number>) => void;
  allNfts: NFT[];
}) {
  const [statuses, setStatuses] = useState<Record<number, TxStatus>>(() =>
    Object.fromEntries(nftIds.map(id => [id, 'Pending' as TxStatus]))
  );
  const [hashes, setHashes] = useState<Record<number, string>>({});
  const calledDone = useRef(false);

  useEffect(() => {
    if (isTauri) {
      // Tauri mode: call marketplace command for each NFT
      (async () => {
        let apiKey = '';
        const wallets = loadWallets();
        try { apiKey = await loadAlchemyKey(); } catch { /* key not set yet */ }

        for (let i = 0; i < nftIds.length; i++) {
          const id = nftIds[i];
          const nft = allNfts.find(n => n.id === id);
          if (!nft) continue;

          // Map wallet slot to real address
          const slotMap: Record<string, number> = { main: 0, defi: 1, cold: 2 };
          const walletIdx = slotMap[nft.wallet] ?? 0;
          const walletAddress = wallets[walletIdx]?.address ?? wallets[0]?.address ?? '';

          setStatuses(s => ({ ...s, [id]: 'Signing' }));
          try {
            const result = await marketplaceListNft({
              walletAddress,
              contractAddress: nft.collection, // placeholder until real contract addresses are stored
              tokenId: String(nft.id),
              priceEth: parseFloat(prices[id] || String(nft.floor)),
              marketplace: marketplace.toLowerCase() === 'blur' ? 'blur' : 'opensea',
              expiryHours: 72,
              apiKey,
            });
            setStatuses(s => ({ ...s, [id]: result.error ? 'Failed' : 'Broadcasting' }));
            if (result.tx_hash) setHashes(h => ({ ...h, [id]: result.tx_hash! }));
            await new Promise(r => setTimeout(r, 400));
            setStatuses(s => ({ ...s, [id]: result.error ? 'Failed' : 'Confirmed' }));
          } catch {
            setStatuses(s => ({ ...s, [id]: 'Failed' }));
          }
        }
      })();
    } else {
      // Browser mode: simulate progression
      const timers: ReturnType<typeof setTimeout>[] = [];
      nftIds.forEach((id, i) => {
        const b = i * 600;
        const fail = Math.random() < 0.08;
        timers.push(setTimeout(() => setStatuses(s => ({ ...s, [id]: 'Signing' })), b + 400));
        timers.push(setTimeout(() => {
          setStatuses(s => ({ ...s, [id]: 'Broadcasting' }));
          setHashes(h => ({ ...h, [id]: fakeHash() }));
        }, b + 1200));
        timers.push(setTimeout(() => setStatuses(s => ({ ...s, [id]: fail ? 'Failed' : 'Confirmed' })), b + 2400));
      });
      return () => timers.forEach(clearTimeout);
    }
  }, []);

  const confirmed = nftIds.filter(id => statuses[id] === 'Confirmed').length;
  const failed    = nftIds.filter(id => statuses[id] === 'Failed').length;
  const done      = confirmed + failed === nftIds.length;
  const nfts      = nftIds.map(id => allNfts.find(n => n.id === id)!).filter(Boolean);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '18px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: '6px' }}>
            {done ? `Done — ${confirmed} listed, ${failed} failed` : `Listing ${nftIds.length} NFTs on ${marketplace}…`}
          </div>
          <div style={{ width: '360px', height: '3px', backgroundColor: 'var(--wr-border)' }}>
            <div style={{ height: '100%', backgroundColor: '#BEFF00', width: `${(confirmed / nftIds.length) * 100}%`, transition: 'width 0.4s ease' }} />
          </div>
        </div>
        {done && (
          <button onClick={() => { if (!calledDone.current) { calledDone.current = true; onDone(new Set(nftIds.filter(id => statuses[id] === 'Confirmed'))); } }}
            className="btn-cta"
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#000', backgroundColor: '#BEFF00', border: 'none', padding: '10px 22px', cursor: 'pointer' }}>
            Done ✓
          </button>
        )}
      </div>

      <div className="flex gap-2 mb-5">
        {[
          { l: 'Total', v: nftIds.length, c: '#FFFFFF', bg: '#111111', b: '#1A1A1A' },
          { l: 'Confirmed', v: confirmed, c: '#34d399', bg: '#052e16', b: '#166534' },
          { l: 'Processing', v: nftIds.length - confirmed - failed, c: '#60a5fa', bg: '#1c1c3a', b: '#3b3b6a' },
          { l: 'Failed', v: failed, c: '#f87171', bg: '#450a0a', b: '#7f1d1d' },
        ].map(ch => (
          <div key={ch.l} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: ch.c, backgroundColor: ch.bg, border: `1px solid ${ch.b}`, padding: '4px 12px', display: 'flex', gap: '5px' }}>
            <span style={{ fontWeight: 700 }}>{ch.v}</span><span style={{ opacity: 0.65 }}>{ch.l}</span>
          </div>
        ))}
      </div>

      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)' }}>
        <div className="grid px-4 py-2 border-b border-[#1A1A1A]"
          style={{ gridTemplateColumns: '2fr 1.5fr 0.9fr 0.9fr 1fr 1.8fr', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
          <span>NFT</span><span>Collection</span><span>Price</span><span>Market</span><span>Status</span><span>Tx Hash</span>
        </div>
        {nfts.map(nft => {
          const st = statuses[nft.id] ?? 'Pending';
          const hash = hashes[nft.id];
          const txPrefix: Record<TxStatus, string> = { Pending: '', Signing: '✏ ', Broadcasting: '↑ ', Confirmed: '✓ ', Failed: '✕ ' };
          return (
            <div key={nft.id} className="grid px-4 py-3 border-b border-[#1A1A1A] last:border-b-0 items-center"
              style={{ gridTemplateColumns: '2fr 1.5fr 0.9fr 0.9fr 1fr 1.8fr' }}>
              <div className="flex items-center gap-2">
                <div style={{ width: '28px', height: '28px', backgroundColor: nft.collectionColor + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>{nft.emoji}</div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)' }}>{nft.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div style={{ width: '7px', height: '7px', backgroundColor: nft.collectionColor }} />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-2)' }}>{nft.collection}</span>
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-accent)' }}>{prices[nft.id] ? prices[nft.id] : nft.floor}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{marketplace}</span>
              <Tag variant={TX_STATUS_VARIANT[st]} dot={st === 'Pending'} size="xs">{txPrefix[st]}{st}</Tag>
              {hash
                ? <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#3b82f6', textDecoration: 'none' }}>{hash} ↗</a>
                : <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-4)' }}>—</span>
              }
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BulkListPage() {
  const [wallets, setWallets] = useState(STATIC_WALLETS);
  const [allNfts, setAllNfts] = useState<NFT[]>(STATIC_NFTS);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const stored = loadWallets();
    if (!inTauri) {
      // Browser mode: use mock NFTs mapped to first wallet
      if (stored.length > 0) {
        const w = stored.map((sw, i) => ({ id: sw.address, name: sw.name, address: sw.address, nftCount: 0 }));
        setWallets(w);
        setActiveWallets(new Set(w.map(x => x.id)));
        const mockNfts = (MOCK_NFTS_RESPONSE.owned_nfts as OwnedNft[]).map((n, i) => ownedNftToNFT(n, i, w[0].id));
        setAllNfts(mockNfts.length > 0 ? mockNfts : STATIC_NFTS);
      }
      return;
    }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (!key || stored.length === 0) return;
      const w = stored.map(sw => ({ id: sw.address, name: sw.name, address: sw.address, nftCount: 0 }));
      const allFetched: NFT[] = [];
      await Promise.allSettled(w.map(async (wallet) => {
        const res = await getNftsForOwner(wallet.address, key).catch(() => null);
        if (res) {
          const nfts = res.owned_nfts.map((n, i) => ownedNftToNFT(n, allFetched.length + i, wallet.id));
          allFetched.push(...nfts);
          wallet.nftCount = nfts.length;
        }
      }));
      setWallets(w);
      setActiveWallets(new Set(w.map(x => x.id)));
      if (allFetched.length > 0) setAllNfts(allFetched);
    })();
  }, []);

  const [activeWallets, setActiveWallets]   = useState<Set<string>>(new Set(wallets.map(w => w.id)));
  const [activeCollections, setActiveCols]  = useState<Set<string>>(new Set(STATIC_NFTS.map(n => n.collection)));
  const [selected, setSelected]             = useState<Set<number>>(new Set());
  const [nftPrices, setNftPricesMap]        = useState<Record<number, string>>({});
  const [listedNfts, setListedNfts]         = useState<Set<number>>(new Set());
  const [listedPrices, setListedPrices]     = useState<Record<number, string>>({});

  const [marketplaces, setMarketplaces] = useState<Set<string>>(new Set(['OpenSea']));
  const [adjustment, setAdjustment]    = useState('0');
  const [durationValue, setDurationValue] = useState('7');
  const [durationUnit, setDurationUnit]   = useState<'min' | 'hour' | 'day' | 'week' | 'month'>('day');

  const [tracking, setTracking] = useState<{ ids: number[]; prices: Record<number, string> } | null>(null);
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set());
  const [customDuration, setCustomDuration] = useState('');

  const flipCard = (id: number) =>
    setFlippedCards(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // NFTs visible from selected wallets
  const walletNfts = allNfts.filter(n => activeWallets.has(n.wallet));

  // Collections available from selected wallets
  const availableCollections = Array.from(new Set(walletNfts.map(n => n.collection))).map(col => ({
    name: col,
    color: walletNfts.find(n => n.collection === col)!.collectionColor,
  }));

  // Sync activeCollections when allNfts loads (e.g. from Alchemy) — add any new collections
  useEffect(() => {
    const cols = new Set(allNfts.map(n => n.collection));
    setActiveCols(cols);
  }, [allNfts]);

  // Final filtered list
  const visibleNfts = walletNfts.filter(n => activeCollections.has(n.collection));

  const autoPrice = (nft: NFT) => (nft.floor * (1 + (parseFloat(adjustment) || 0) / 100)).toFixed(2);

  const toggleWallet = (id: string) => {
    setActiveWallets(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleCollection = (col: string) => {
    setActiveCols(s => { const n = new Set(s); n.has(col) ? n.delete(col) : n.add(col); return n; });
  };

  const toggleNft = (nft: NFT) => {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(nft.id)) { n.delete(nft.id); }
      else {
        n.add(nft.id);
        if (!nftPrices[nft.id]) setNftPricesMap(p => ({ ...p, [nft.id]: autoPrice(nft) }));
      }
      return n;
    });
  };

  const toggleAll = () => {
    const eligible = visibleNfts.filter(n => !n.listed && !listedNfts.has(n.id));
    const allSelected = eligible.every(n => selected.has(n.id));
    if (allSelected) {
      setSelected(s => { const n = new Set(s); eligible.forEach(nft => n.delete(nft.id)); return n; });
    } else {
      setSelected(s => { const n = new Set(s); eligible.forEach(nft => n.add(nft.id)); return n; });
      setNftPricesMap(p => {
        const upd = { ...p };
        eligible.forEach(nft => { if (!upd[nft.id]) upd[nft.id] = autoPrice(nft); });
        return upd;
      });
    }
  };

  const applyFloorPrice = () => {
    setNftPricesMap(p => {
      const upd = { ...p };
      selected.forEach(id => { const nft = allNfts.find(n => n.id === id); if (nft) upd[id] = nft.floor.toFixed(2); });
      return upd;
    });
  };

  const applyTraitFloor = () => {
    setNftPricesMap(p => {
      const upd = { ...p };
      selected.forEach(id => {
        const nft = allNfts.find(n => n.id === id);
        if (nft) {
          const traits = getNftTraits(nft);
          const max = traits.length > 0 ? Math.max(...traits.map(t => t.offerFloor)) : nft.floor;
          upd[id] = max.toFixed(2);
        }
      });
      return upd;
    });
  };

  const handleList = () => {
    const ids = Array.from(selected);
    const prices: Record<number, string> = {};
    ids.forEach(id => { prices[id] = nftPrices[id] ?? String(allNfts.find(n => n.id === id)?.floor ?? 0); });
    setTracking({ ids, prices });
  };

  const handleDone = (confirmed: Set<number>) => {
    setListedNfts(prev => new Set([...prev, ...confirmed]));
    setListedPrices(prev => {
      const upd = { ...prev };
      confirmed.forEach(id => { upd[id] = nftPrices[id] ? `${nftPrices[id]} ETH` : ''; });
      return upd;
    });
    setSelected(new Set());
    setTracking(null);
  };

  const totalEth = Array.from(selected).reduce((s, id) => s + (parseFloat(nftPrices[id] || '0') || 0), 0);
  const eligibleVisible = visibleNfts.filter(n => !n.listed && !listedNfts.has(n.id));
  const allVisibleSelected = eligibleVisible.length > 0 && eligibleVisible.every(n => selected.has(n.id));

  return (
    <ProGate feature="Bulk List">
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '28px 40px 100px' }}>

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/build" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Bulk Actions</Link>
        <span>›</span>
        <span style={{ color: tracking ? 'var(--wr-accent)' : '#FFFFFF', cursor: tracking ? 'pointer' : 'default' }}
          onClick={() => tracking && setTracking(null)}>Bulk List</span>
        {tracking && <><span>›</span><span style={{ color: 'var(--wr-text)' }}>Tracking</span></>}
      </div>

      {tracking ? (
        <TrackingView nftIds={tracking.ids} prices={tracking.prices} marketplace={Array.from(marketplaces).join(' + ') || 'OpenSea'} onDone={handleDone} allNfts={allNfts} />
      ) : (
        <>
          {/* Top row: title */}
          <div style={{ marginBottom: '16px' }}>
            <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '20px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: '2px' }}>Bulk List</h1>
          </div>

          {/* Wallet filter */}
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>Wallet</span>
            {wallets.map(w => {
              const on = activeWallets.has(w.id);
              return (
                <button key={w.id} onClick={() => toggleWallet(w.id)}
                  style={{
                    fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                    color: on ? '#000' : '#A1A1AA',
                    backgroundColor: on ? '#BEFF00' : 'var(--wr-surface)',
                    border: `1px solid ${on ? 'var(--wr-accent)' : '#2a2a2a'}`,
                    padding: '4px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px',
                  }}>
                  {on && <span style={{ fontSize: '9px' }}>✓</span>}
                  {w.name}
                  <span style={{ fontSize: '9px', opacity: 0.6 }}>{w.nftCount}</span>
                </button>
              );
            })}
            <button onClick={() => setActiveWallets(new Set(wallets.map(w => w.id)))}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '4px 10px', cursor: 'pointer' }}>
              All
            </button>
          </div>

          {/* 2-column layout: collections sidebar + NFT grid */}
          <div style={{ display: 'flex', gap: '0', minHeight: '400px' }}>

            {/* ── Left: Collections sidebar ── */}
            <div style={{ width: '240px', flexShrink: 0, borderRight: '1px solid var(--wr-border)', marginRight: '20px', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', padding: '8px 12px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface-alt)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Collection</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Held</span>
              </div>
              {walletNfts.length === 0 ? (
                <div style={{ padding: '16px 12px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-4)' }}>No collections</div>
              ) : (
                availableCollections.map(({ name, color }) => {
                  const isActive = activeCollections.has(name);
                  const count    = walletNfts.filter(n => n.collection === name).length;
                  return (
                    <div key={name}
                      onClick={() => toggleCollection(name)}
                      style={{ display: 'grid', gridTemplateColumns: '20px 28px 1fr 28px', alignItems: 'center', gap: '8px', padding: '8px 12px', borderBottom: '1px solid var(--wr-border)', cursor: 'pointer', backgroundColor: isActive ? 'var(--wr-hover-bg)' : 'transparent' }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                    >
                      {/* Custom checkbox */}
                      <div style={{
                        width: '13px', height: '13px', flexShrink: 0,
                        backgroundColor: isActive ? '#BEFF00' : 'transparent',
                        border: `1.5px solid ${isActive ? '#BEFF00' : '#555'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer',
                      }}>
                        {isActive && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5L3.5 6L8 1" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      {/* Icon */}
                      <div style={{ width: '28px', height: '28px', backgroundColor: color + '33', border: `1px solid ${color}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '13px' }}>
                        {walletNfts.find(n => n.collection === name)?.emoji ?? '◆'}
                      </div>
                      {/* Name + verified */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: isActive ? 'var(--wr-text)' : 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
                          <circle cx="6" cy="6" r="5.5" fill={color} fillOpacity="0.2" stroke={color} strokeWidth="1"/>
                          <path d="M3.5 6L5.2 7.8L8.5 4.5" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      {/* Count */}
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: isActive ? 'var(--wr-text-2)' : 'var(--wr-text-4)', textAlign: 'right' }}>{count}</span>
                    </div>
                  );
                })
              )}
            </div>

            {/* ── Right: NFT grid ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Grid header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--wr-border)', marginBottom: '12px' }}>
                <input type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAll}
                  style={{ accentColor: 'var(--wr-accent)', width: '13px', height: '13px', cursor: 'pointer' }} />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--wr-text-3)' }}>
                  {visibleNfts.length} ITEMS
                  {selected.size > 0 && <span style={{ color: 'var(--wr-accent)', marginLeft: '8px' }}>· {selected.size} selected</span>}
                </span>
              </div>

              {walletNfts.length === 0 ? (
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-4)', padding: '60px 0', textAlign: 'center' }}>
                  Select a wallet above to see NFTs
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
                  {visibleNfts.map(nft => {
                const isSel     = selected.has(nft.id);
                const isListed  = nft.listed || listedNfts.has(nft.id);
                const dispPrice = listedNfts.has(nft.id) ? listedPrices[nft.id] : nft.listedPrice;
                const rankNum   = parseInt(nft.rank.replace(/,/g, ''));
                const rankColor = rankNum < 500 ? '#f97316' : rankNum < 1500 ? '#60a5fa' : '#6E6E6E';
                const isFlipped = flippedCards.has(nft.id);
                const traits    = getNftTraits(nft);

                return (
                  /* Perspective wrapper */
                  <div key={nft.id} style={{ perspective: '900px' }}>

                    {/* Flip container */}
                    <div
                      onClick={() => flipCard(nft.id)}
                      style={{
                        position: 'relative',
                        transformStyle: 'preserve-3d',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                        transition: 'transform 0.42s ease',
                        borderRadius: '10px',
                        border: `2px solid ${isSel ? 'var(--wr-accent)' : isListed ? '#166534' : '#1f1f1f'}`,
                        cursor: 'pointer',
                        minHeight: '260px',
                      }}
                    >

                      {/* ── FRONT ── */}
                      <div style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', backgroundColor: 'var(--wr-overlay)', borderRadius: '8px', overflow: 'hidden' }}>
                        {/* Image */}
                        <div style={{ position: 'relative', aspectRatio: '1', backgroundColor: nft.collectionColor + '55', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span style={{ fontSize: '52px', lineHeight: 1 }}>{nft.emoji}</span>
                          {/* ETH badge */}
                          <div style={{ position: 'absolute', top: '8px', left: '8px', width: '22px', height: '22px', borderRadius: '50%', backgroundColor: '#1a1a1a99', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: 'var(--wr-text-2)' }}><EthIcon size={10} color="currentColor" style={{ verticalAlign: 'middle' }} /></div>
                          {/* Flip hint */}
                          <div style={{ position: 'absolute', bottom: '6px', right: '7px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#ffffff33' }}>traits ↻</div>
                          {/* Checkbox — stops propagation so it selects, not flips */}
                          {!isListed && (
                            <div onClick={e => { e.stopPropagation(); toggleNft(nft); }}
                              style={{ position: 'absolute', top: '8px', right: '8px', width: '20px', height: '20px', borderRadius: '50%', backgroundColor: isSel ? '#BEFF00' : '#1a1a1a99', backdropFilter: 'blur(4px)', border: `1.5px solid ${isSel ? 'var(--wr-accent)' : '#ffffff33'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#000', fontWeight: 700 }}>
                              {isSel ? '✓' : ''}
                            </div>
                          )}
                          {/* Listed overlay */}
                          {isListed && (
                            <div style={{ position: 'absolute', inset: 0, backgroundColor: '#052e1666', display: 'flex', alignItems: 'flex-end', padding: '8px' }}>
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', fontWeight: 700, color: '#34d399', backgroundColor: '#052e16cc', border: '1px solid #166534', padding: '2px 6px', letterSpacing: '1px' }}>LISTED</span>
                            </div>
                          )}
                        </div>
                        {/* Info */}
                        <div style={{ padding: '8px 10px 10px' }}>
                          <div className="flex items-center justify-between" style={{ marginBottom: '2px' }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '95px' }}>{nft.name}</span>
                            <div className="flex items-center gap-0.5" style={{ flexShrink: 0 }}>
                              <span style={{ fontSize: '8px', color: rankColor }}>◆</span>
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: rankColor, fontWeight: 600 }}>#{nft.rank}</span>
                            </div>
                          </div>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nft.collection}</div>
                          {isListed ? (
                            <><div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#34d399', marginBottom: '1px' }}>Listed</div><div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#34d399' }}>{dispPrice}</div></>
                          ) : isSel ? (
                            <><div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-accent)', marginBottom: '3px' }}>List price</div>
                            <div onClick={e => e.stopPropagation()} className="flex items-center gap-1">
                              <input value={nftPrices[nft.id] ?? ''} onChange={e => setNftPricesMap(p => ({ ...p, [nft.id]: e.target.value }))} type="text" inputMode="decimal"
                                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-accent)', backgroundColor: '#0a1a0a', border: '1px solid #BEFF0055', padding: '3px 6px', width: '100%', outline: 'none', borderRadius: '2px' }} />
                              <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2, flexShrink: 0 }} />
                            </div></>
                          ) : (
                            <><div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', marginBottom: '1px' }}>Floor</div><div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)' }}>{nft.floor}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></div></>
                          )}
                        </div>
                      </div>

                      {/* ── BACK ── */}
                      <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
                        transform: 'rotateY(180deg)',
                        backgroundColor: 'var(--wr-overlay)', borderRadius: '8px',
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                      }}>
                        {/* Back header */}
                        <div style={{ padding: '10px 10px 7px', borderBottom: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '110px' }}>{nft.name}</div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: 'var(--wr-text-3)', marginTop: '1px' }}>Tap again to flip back</div>
                          </div>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text-4)' }}>↩</div>
                        </div>
                        {/* Trait rows — 2-line layout: title on top, metrics below.
                            Row 2 is a 3-col equal grid so Rarity / Floor / Offer
                            columns line up pixel-perfect across every trait. */}
                        <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#3a3a3a #0A0A0A' }}>
                          {traits.map((trait, i) => {
                            const rc = trait.rarity < 5 ? '#f97316' : trait.rarity < 15 ? '#60a5fa' : '#71717A';
                            const METRIC_LABEL = { fontFamily: 'var(--font-jetbrains)', fontSize: '7px', fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase' as const, color: '#555', lineHeight: 1 };
                            const METRIC_VALUE = { fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, lineHeight: 1.1, marginTop: '3px' } as const;
                            return (
                              <div key={i} onClick={e => e.stopPropagation()}
                                style={{ padding: '8px 12px', borderBottom: '1px solid var(--wr-surface)' }}>
                                {/* Row 1 — full trait title (type + value). */}
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '6px', minWidth: 0 }}>
                                  <span style={METRIC_LABEL}>{trait.type}</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>{trait.value}</span>
                                </div>
                                {/* Row 2 — three equal columns so headers & values align perfectly. */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                                  <div>
                                    <div style={METRIC_LABEL}>Rarity</div>
                                    <div style={{ ...METRIC_VALUE, color: rc }}>{trait.rarity}%</div>
                                  </div>
                                  <div>
                                    <div style={METRIC_LABEL}>Floor</div>
                                    <div style={{ ...METRIC_VALUE, color: 'var(--wr-text-1)' }}>{trait.floor}</div>
                                  </div>
                                  <div>
                                    <div style={METRIC_LABEL}>Offer</div>
                                    <div style={{ ...METRIC_VALUE, color: 'var(--wr-accent)' }}>{trait.offerFloor}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          )}
            </div>{/* /right panel */}
          </div>{/* /2-col container */}
        </>
      )}

      {/* Fixed bottom action bar */}
      {!tracking && (
        <div style={{ position: 'fixed', bottom: 0, left: '240px', right: 0, backgroundColor: 'var(--wr-surface)', borderTop: '2px solid #BEFF0033', boxShadow: '0 -12px 40px rgba(0,0,0,0.7)', padding: '14px 40px', display: 'flex', alignItems: 'center', gap: '24px', zIndex: 50 }}>

          {/* Marketplace — multi-select */}
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Marketplace</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              {([
                { id: 'OpenSea', bg: '#2081E2', text: '#fff' },
                { id: 'Blur',    bg: '#FF6600', text: '#fff' },
              ] as const).map(({ id, bg, text }) => {
                const active = marketplaces.has(id);
                return (
                  <button key={id} onClick={() => setMarketplaces(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; })}
                    style={{
                      fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                      padding: '5px 14px', cursor: 'pointer',
                      backgroundColor: active ? bg : 'transparent',
                      color: active ? text : 'var(--wr-text-3)',
                      border: `1px solid ${active ? bg : 'var(--wr-border)'}`,
                    }}>
                    {id}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '40px', backgroundColor: 'var(--wr-border)', flexShrink: 0 }} />

          {/* Price presets */}
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Set Price</div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={applyFloorPrice} disabled={selected.size === 0}
                style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                  padding: '5px 14px', cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                  backgroundColor: 'transparent',
                  color: selected.size > 0 ? 'var(--wr-text)' : '#3a3a3a',
                  border: `1px solid ${selected.size > 0 ? 'var(--wr-border)' : '#2a2a2a'}`,
                }}>
                Floor
              </button>
              <button onClick={applyTraitFloor} disabled={selected.size === 0}
                style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600,
                  padding: '5px 14px', cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
                  backgroundColor: 'transparent',
                  color: selected.size > 0 ? 'var(--wr-text)' : '#3a3a3a',
                  border: `1px solid ${selected.size > 0 ? 'var(--wr-border)' : '#2a2a2a'}`,
                }}>
                Trait Floor
              </button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', height: '40px', backgroundColor: 'var(--wr-border)', flexShrink: 0 }} />

          {/* Duration */}
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Duration</div>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: '0' }}>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={durationValue}
                onChange={e => setDurationValue(e.target.value.replace(/[^0-9]/g, ''))}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, width: '52px', backgroundColor: 'var(--wr-overlay)', border: '1px solid var(--wr-border)', borderRight: 'none', color: 'var(--wr-text)', padding: '5px 8px', outline: 'none', textAlign: 'center', MozAppearance: 'textfield' as const, WebkitAppearance: 'none' as const }} />
              {(['min', 'hour', 'day', 'week', 'month'] as const).map(u => (
                <button key={u} onClick={() => setDurationUnit(u)}
                  style={{
                    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: durationUnit === u ? 700 : 400,
                    padding: '5px 9px', cursor: 'pointer',
                    backgroundColor: durationUnit === u ? 'var(--wr-hover-bg)' : 'var(--wr-overlay)',
                    color: durationUnit === u ? 'var(--wr-text)' : 'var(--wr-text-3)',
                    border: '1px solid var(--wr-border)',
                    borderLeft: 'none',
                  }}>
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Summary + CTA */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '20px' }}>
            {selected.size > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px' }}>{selected.size} NFTs selected</div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '18px', fontWeight: 700, color: 'var(--wr-text)' }}>
                  {totalEth.toFixed(2)}<EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
                </div>
              </div>
            )}
            <button onClick={handleList} disabled={selected.size === 0}
              className={selected.size > 0 ? 'btn-cta' : ''}
              style={{
                fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: selected.size > 0 ? '#000' : '#3a3a3a',
                backgroundColor: selected.size > 0 ? '#BEFF00' : 'var(--wr-overlay)',
                border: 'none', padding: '12px 28px',
                cursor: selected.size > 0 ? 'pointer' : 'not-allowed',
              }}>
              {selected.size > 0 ? `List ${selected.size} NFTs →` : 'Select NFTs'}
            </button>
          </div>
        </div>
      )}
    </main>
    </ProGate>
  );
}
