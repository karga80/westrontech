'use client';

import { useState, useEffect, useRef, Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tag, NFT_ACTIVITY_VARIANT } from '@/components/Tag';
import { fetchCollectionStats, fetchCollectionEvents, fetchCollectionHolders, fetchCollectionOffers, fetchCollectionTraits, fetchCollectionNfts, getEthBalance, getTokenBalances, type CollectionStats, type CollectionEvent, type CollectionHolder, type CollectionOffer, type CollectionTrait, type TraitValue } from '@/lib/tauri';
import {
  addTrackedNft, isTracked, loadTrackedNfts, removeTrackedNft, trackedNftId,
  type TrackedNft,
} from '@/lib/trackedNftStore';
import { subscribeTrackedNfts } from '@/lib/trackedNftStore';
import { TrackedNftNotificationModal } from '@/components/TrackedNftNotificationModal';
import { openSeaApi, type OpenSeaNftItem, type SortOption, SORT_OPTIONS } from '@/lib/opensea-api';
import { loadWallets } from '@/lib/walletStore';

// ─── Monitor NFT Collection Detail ───────────────────────────────────────────

type Tab = 'Items' | 'Offers' | 'Holders' | 'Activity' | 'Make Collection Bid' | 'Analytics' | 'Alerts';

const TABS: Tab[] = ['Items', 'Offers', 'Holders', 'Activity', 'Make Collection Bid', 'Analytics', 'Alerts'];

// ── Mock collection data keyed by name ────────────────────────────────────────
const COLLECTION_DATA: Record<string, {
  name: string; symbol: string; color: string; floor: string; change: number;
  vol24h: string; vol7d: string; sales7d: string; totalSupply: string;
  owners: string; marketCap: string; royalty: string; opensea_slug: string;
}> = {
  'Bored Ape Yacht Club': { name: 'Bored Ape Yacht Club', symbol: 'BAYC', color: '#f59e0b', floor: '14.2 ETH', change: -2.3, vol24h: '349.8 ETH', vol7d: '1,349.8 ETH', sales7d: '94', totalSupply: '10,000', owners: '5,829', marketCap: '142,000 ETH', royalty: '2.5%', opensea_slug: 'boredapeyachtclub' },
  'CryptoPunks':          { name: 'CryptoPunks', symbol: 'PUNK', color: '#818cf8', floor: '33.1 ETH', change: 1.5, vol24h: '43.9 ETH', vol7d: '56.2 ETH', sales7d: '2', totalSupply: '10,000', owners: '3,411', marketCap: '331,000 ETH', royalty: '0%', opensea_slug: 'cryptopunks' },
  'Azuki':                { name: 'Azuki', symbol: 'AZUKI', color: '#a78bfa', floor: '3.8 ETH', change: -1.3, vol24h: '43.9 ETH', vol7d: '56.2 ETH', sales7d: '4', totalSupply: '10,000', owners: '4,102', marketCap: '38,000 ETH', royalty: '5%', opensea_slug: 'azuki' },
  'Fidgy Penguins':       { name: 'Fidgy Penguins', symbol: 'FP', color: '#60a5fa', floor: '1.6 ETH', change: -1.3, vol24h: '18.8 ETH', vol7d: '1.1 ETH', sales7d: '3', totalSupply: '8,888', owners: '2,954', marketCap: '14,221 ETH', royalty: '5%', opensea_slug: 'pudgypenguins' },
};

const FALLBACK = { name: '', symbol: '?', color: '#6e6e6e', floor: '—', change: 0, vol24h: '—', vol7d: '—', sales7d: '—', totalSupply: '—', owners: '—', marketCap: '—', royalty: '—', opensea_slug: '' };

// ── Mock feed data ─────────────────────────────────────────────────────────────
const FEED_ITEMS = [
  { type: 'Sale',     typeColor: '#34d399', typeBg: '#065f46', typeBorder: '#065f46', title: 'BAYC #7391 sold for 14.5 ETH', sub: 'Buyer: 0x3a2f…c841 · Seller: 0x81d2…f320', timeAgo: '3 min ago',  date: '2 Apr 2026' },
  { type: 'Listing',  typeColor: '#22d3ee', typeBg: '#083344', typeBorder: '#164e63', title: 'BAYC #2108 listed for 16.0 ETH', sub: 'By: 0x9cd1…44ba', timeAgo: '11 min ago', date: '2 Apr 2026' },
  { type: 'Sale',     typeColor: '#34d399', typeBg: '#065f46', typeBorder: '#065f46', title: 'BAYC #0451 sold for 13.9 ETH', sub: 'Buyer: 0x5dh1…4b3 · Seller: 0x72f4…a109', timeAgo: '42 min ago', date: '2 Apr 2026' },
  { type: 'Bid',      typeColor: '#fcd34d', typeBg: '#451a03', typeBorder: '#78350f', title: 'Offer 13.2 ETH on BAYC #5523', sub: 'By: 0x1a9c…d204', timeAgo: '1 hr ago',   date: '2 Apr 2026' },
  { type: 'Transfer', typeColor: '#a78bfa', typeBg: '#2e1065', typeBorder: '#4c1d95', title: 'BAYC #8820 transferred', sub: 'From: 0x82a3…f012 → To: 0x3311…9a2e', timeAgo: '2 hrs ago',  date: '2 Apr 2026' },
  { type: 'Sale',     typeColor: '#34d399', typeBg: '#065f46', typeBorder: '#065f46', title: 'BAYC #1133 sold for 15.2 ETH', sub: 'Buyer: 0xcf3d…b4a1 · Seller: 0x4d21…8f33', timeAgo: '3 hrs ago',  date: '2 Apr 2026' },
];

// ── Mock holders data ──────────────────────────────────────────────────────────
const HOLDERS = [
  { rank: 1,  address: '0x3352…ef42', label: 'dexidda.eth',   held: 12, pct: '0.12%', value: '170.4 ETH', firstBuy: '14.1 ETH', avgCost: '12.8 ETH', tags: ['Whale'] },
  { rank: 2,  address: '0x9af3…12c0', label: 'NFTWhale',       held: 9,  pct: '0.09%', value: '127.8 ETH', firstBuy: '11.4 ETH', avgCost: '11.9 ETH', tags: ['Holder'] },
  { rank: 3,  address: '0x7b1c…4e09', label: '0x7b1c…4e09',   held: 7,  pct: '0.07%', value: '99.4 ETH',  firstBuy: '13.0 ETH', avgCost: '12.1 ETH', tags: [] },
  { rank: 4,  address: '0x2f4a…8831', label: 'apegang.eth',    held: 6,  pct: '0.06%', value: '85.2 ETH',  firstBuy: '9.8 ETH',  avgCost: '10.4 ETH', tags: ['Trader'] },
  { rank: 5,  address: '0x5c2d…001f', label: '0x5c2d…001f',   held: 5,  pct: '0.05%', value: '71.0 ETH',  firstBuy: '12.2 ETH', avgCost: '11.7 ETH', tags: [] },
  { rank: 6,  address: '0xd901…3b2e', label: 'collector99',    held: 4,  pct: '0.04%', value: '56.8 ETH',  firstBuy: '10.1 ETH', avgCost: '10.9 ETH', tags: ['Smart Money'] },
];

// ── Mock NFT Items data ────────────────────────────────────────────────────────
const NFT_ITEMS = [
  { id: '#7391', rank: 142,  price: '33.1 ETH', lastSale: '32.0 ETH', owner: '0x3a2f…c841', traits: ['Alien', 'Pipe'] },
  { id: '#2108', rank: 381,  price: '33.5 ETH', lastSale: '31.5 ETH', owner: '0x9cd1…44ba', traits: ['Ape', 'Shades'] },
  { id: '#0451', rank: 55,   price: '36.0 ETH', lastSale: '35.2 ETH', owner: '0x72f4…a109', traits: ['Zombie', 'Cap'] },
  { id: '#5523', rank: 903,  price: '33.1 ETH', lastSale: '33.1 ETH', owner: '0x1a9c…d204', traits: ['Normal', 'Gold Chain'] },
  { id: '#8820', rank: 2041, price: '33.2 ETH', lastSale: '30.0 ETH', owner: '0x82a3…f012', traits: ['Normal', 'Headband'] },
  { id: '#1133', rank: 187,  price: '34.9 ETH', lastSale: '34.0 ETH', owner: '0xcf3d…b4a1', traits: ['Ape', 'Tiara'] },
  { id: '#3821', rank: 612,  price: '33.1 ETH', lastSale: '29.5 ETH', owner: '0x82a1…c02d', traits: ['Normal', 'Cigarette'] },
  { id: '#6042', rank: 1204, price: '33.3 ETH', lastSale: '31.0 ETH', owner: '0x5d41…9911', traits: ['Normal', 'Bandana'] },
  { id: '#0019', rank: 28,   price: '45.0 ETH', lastSale: '42.0 ETH', owner: '0xd901…3b2e', traits: ['Alien', 'No Attr'] },
  { id: '#4411', rank: 778,  price: '33.1 ETH', lastSale: '32.5 ETH', owner: '0x3311…9a2e', traits: ['Normal', 'Mohawk'] },
  { id: '#2994', rank: 1501, price: '33.1 ETH', lastSale: '28.0 ETH', owner: '0x4d21…8f33', traits: ['Normal', 'Earring'] },
  { id: '#7102', rank: 441,  price: '33.6 ETH', lastSale: '33.0 ETH', owner: '0x9af3…12c0', traits: ['Zombie', 'Shades'] },
];

// ── Mock trait filters ────────────────────────────────────────────────────────
// Collection traits render from live Alchemy/OpenSea data (`liveTraits`); no mock fixtures.

// ── Alert rules ────────────────────────────────────────────────────────────────
type AlertRule = { id: number; label: string; enabled: boolean; channel: string };
const ALERT_CHANNELS = ['macOS', 'Discord', 'macOS + Discord'] as const;
const ALERTS: AlertRule[] = [
  { id: 1, label: 'Floor drops below 12 ETH',       enabled: true,  channel: 'macOS + Discord' },
  { id: 2, label: 'Floor rises above 20 ETH',       enabled: false, channel: 'macOS' },
  { id: 3, label: 'Volume spike > 500 ETH in 1hr',  enabled: true,  channel: 'Discord' },
  { id: 4, label: 'Whale buy ≥ 5 items in 10 min',  enabled: true,  channel: 'macOS + Discord' },
];

// ── Stats bar data ─────────────────────────────────────────────────────────────
function MiniBarChart({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 32 }}>
      {values.map((v, i) => (
        <div key={i} style={{ width: 6, height: `${(v / max) * 100}%`, backgroundColor: color, opacity: 0.7 + (i / values.length) * 0.3, borderRadius: 1 }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function MonitorCollectionInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const hoverOn  = (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; };
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; };
  const [tab, setTab] = useState<Tab>('Items');
  const [alerts, setAlerts] = useState<AlertRule[]>(ALERTS);
  const toggleAlert = (id: number) => setAlerts(prev => prev.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a));
  const deleteAlert = (id: number) => setAlerts(prev => prev.filter(a => a.id !== id));
  const [alertEditor, setAlertEditor] = useState<{ mode: 'add' | 'edit'; id: number | null; label: string; channel: string } | null>(null);
  const openAddAlert = () => setAlertEditor({ mode: 'add', id: null, label: '', channel: ALERT_CHANNELS[0] });
  const openEditAlert = (a: AlertRule) => setAlertEditor({ mode: 'edit', id: a.id, label: a.label, channel: a.channel });
  const closeAlertEditor = () => setAlertEditor(null);
  const saveAlertEditor = () => {
    if (!alertEditor) return;
    const label = alertEditor.label.trim();
    if (!label) return;
    if (alertEditor.mode === 'add') {
      const nextId = alerts.reduce((m, a) => Math.max(m, a.id), 0) + 1;
      setAlerts(prev => [...prev, { id: nextId, label, channel: alertEditor.channel, enabled: true }]);
    } else if (alertEditor.id != null) {
      setAlerts(prev => prev.map(a => a.id === alertEditor.id ? { ...a, label, channel: alertEditor.channel } : a));
    }
    setAlertEditor(null);
  };

  const collectionName = searchParams.get('name') ?? '';
  const slugParam = searchParams.get('slug') ?? '';
  // Prefer COLLECTION_DATA entry; fall back to user-added collection via slug param
  const col = COLLECTION_DATA[collectionName] ?? {
    ...FALLBACK,
    name: collectionName || slugParam,
    symbol: slugParam.slice(0, 4).toUpperCase() || '?',
    opensea_slug: slugParam,
  };

  const [liveNfts, setLiveNfts] = useState<OpenSeaNftItem[] | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('Price low to high');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const [nftsCursor, setNftsCursor] = useState<string | null>(null);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [nftsError, setNftsError] = useState<string | null>(null);
  const [liveStats, setLiveStats] = useState<CollectionStats | null>(null);
  const [liveEvents, setLiveEvents] = useState<CollectionEvent[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  type FeedFilterType = 'sale' | 'listing' | 'offer' | 'transfer' | 'mint' | 'collection_offer' | 'trait_offer';
  const [feedFilters, setFeedFilters] = useState<Set<FeedFilterType>>(new Set()); // empty = All
  const [liveHolders, setLiveHolders] = useState<CollectionHolder[] | null>(null);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [liveOffers, setLiveOffers] = useState<CollectionOffer[] | null>(null);
  const [offersLoading, setOffersLoading] = useState(false);
  const [liveTraits, setLiveTraits] = useState<CollectionTrait[] | null>(null);
  const [traitsLoading, setTraitsLoading] = useState(false);
  const [selectedTraitCategory, setSelectedTraitCategory] = useState<string | null>(null);
  const [traitSearch, setTraitSearch] = useState('');

  const activeSlug = col.opensea_slug || slugParam;
  const contractParam = searchParams.get('contract') ?? '';
  const imageParam = searchParams.get('image') ?? '';
  const wallets = loadWallets();

  // ── Items filter state (declared early — used in fetch effects) ─────────
  type FilterStatus = 'all' | 'listed' | 'unlisted' | 'owned';
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  // Listings price map (identifier → price_eth) — used to fill prices when
  // fetching by /collection/{slug}/nfts (which omits price data).
  const [listingsPriceMap, setListingsPriceMap] = useState<Record<string, number>>({});
  const LISTINGS_FETCH_LIMIT = 300;

  // ── Tracked NFT state (favoriting + notification config) ────────────────
  // trackedSet: quick lookup to know whether a given NFT is already tracked
  // (refreshed from localStorage whenever the store fires a change event so
  // toggles on one card reflect instantly on every other card).
  const [trackedSet, setTrackedSet] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const refresh = () => setTrackedSet(new Set(loadTrackedNfts().map(n => n.id)));
    refresh();
    const unsub = subscribeTrackedNfts(refresh);
    return () => { unsub(); };
  }, []);

  // Multi-select mode (bulk favorite). When active, NFT cards show a checkbox
  // and the toolbar gains "Track selected" + "Cancel" actions.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedTokenIds, setSelectedTokenIds] = useState<Set<string>>(() => new Set());

  // Notification modal state — `target` is either a single already-tracked
  // NFT being edited, or (for bulk) we seed from DEFAULT_NOTIFICATIONS and
  // apply to `targetIds`.
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifModalTarget, setNotifModalTarget] = useState<TrackedNft | null>(null);
  const [notifModalIds, setNotifModalIds] = useState<string[] | undefined>(undefined);
  const [listingsFetchedCount, setListingsFetchedCount] = useState(0);

  // Fetch stats + top offer on mount
  useEffect(() => {
    if (!activeSlug) return;
    fetchCollectionStats(activeSlug).then(setLiveStats).catch(() => {});
    fetchCollectionOffers(activeSlug, 5)
      .then(data => { if (liveOffers === null) setLiveOffers(data); })
      .catch(() => {});
  }, [activeSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch NFT items when Items tab active; re-fetch on filter/sort change
  useEffect(() => {
    if (tab !== 'Items' || !activeSlug) return;
    setLiveNfts(null);
    setNftsCursor(null);
    setNftsError(null);
    setNftsLoading(true);
    openSeaApi.fetchNFTsByCollection(activeSlug, {
      status: filterStatus,
      walletAddress: wallets[0]?.address,
      sort: sortBy,
    })
      .then(page => { setLiveNfts(page.items); setNftsCursor(page.next); })
      .catch(err => { setNftsError(typeof err === 'string' ? err : 'Failed to load items'); setLiveNfts([]); })
      .finally(() => setNftsLoading(false));
  }, [tab, activeSlug, filterStatus, sortBy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch listings (price data) for the collection — used to fill prices on
  // "all" / "unlisted" tab views and to show the listed count in the toolbar.
  //
  // Pages through /listings/collection/{slug}/best (via the TS openSeaApi
  // wrapper which supports cursor pagination) up to LISTINGS_FETCH_LIMIT
  // items. A single 100-item page wasn't enough for collections with >100
  // active listings — items priced above the first page didn't get merged.
  useEffect(() => {
    if (tab !== 'Items' || !activeSlug) return;
    const slug = activeSlug;
    setListingsPriceMap({});
    setListingsFetchedCount(0);

    let cancelled = false;
    (async () => {
      const map: Record<string, number> = {};
      let fetchedCount = 0;
      let cursor: string | null = null;

      try {
        for (let page = 0; page < 3 && fetchedCount < LISTINGS_FETCH_LIMIT; page++) {
          // eslint-disable-next-line no-await-in-loop
          const res = await openSeaApi.fetchNFTsByCollection(slug, {
            status: 'listed',
            sort: 'Price low to high',
            cursor,
            limit: 100,
          });
          if (cancelled) return;
          for (const l of res.items) {
            if (l.identifier && l.price_eth != null) map[l.identifier] = l.price_eth;
          }
          fetchedCount += res.items.length;
          cursor = res.next;
          if (!cursor) break;
        }
        if (!cancelled) {
          setListingsPriceMap(map);
          setListingsFetchedCount(fetchedCount);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('fetch listings for price map failed:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [tab, activeSlug]);

  // Fetch events when Activity tab active or filter changes.
  // Valid OpenSea event_type API values: sale, listing, offer, order, transfer, cancel, redemption
  // collection_offer and trait_offer are NOT valid API filter values — map them to "order"
  // then let Rust normalization + client-side filter distinguish them.
  useEffect(() => {
    if (tab !== 'Activity' || !activeSlug) return;
    setLiveEvents(null);
    setEventsLoading(true);
    // Always fetch all events; client-side filter handles multi-select
    fetchCollectionEvents(activeSlug, '', 50)
      .then(data => { setLiveEvents(data); })
      .catch(() => { setLiveEvents([]); })
      .finally(() => setEventsLoading(false));
  }, [tab, activeSlug]);

  // Fetch collection offers when Offers tab active
  useEffect(() => {
    if (tab !== 'Offers' || !activeSlug) return;
    setLiveOffers(null);
    setOffersLoading(true);
    fetchCollectionOffers(activeSlug, 50)
      .then(data => { setLiveOffers(data); })
      .catch(err => { console.error('fetchCollectionOffers error:', err); setLiveOffers([]); })
      .finally(() => setOffersLoading(false));
  }, [tab, activeSlug]);

  // Fetch traits when Items tab or Make Collection Bid tab active
  useEffect(() => {
    if (tab !== 'Items' && tab !== 'Make Collection Bid') return;
    if (!activeSlug) return;
    if (liveTraits !== null) return;
    setTraitsLoading(true);
    fetchCollectionTraits(activeSlug, liveStats?.total_supply ?? 0)
      .then(data => { setLiveTraits(data); })
      .catch(() => { setLiveTraits([]); })
      .finally(() => setTraitsLoading(false));
  }, [tab, activeSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch holders when Holders tab active
  useEffect(() => {
    if (tab !== 'Holders' || !activeSlug) return;
    if (liveHolders !== null) return;
    if (!contractParam) return;
    setHoldersLoading(true);
    fetchCollectionHolders(contractParam, 50)
      .then(data => { setLiveHolders(data); })
      .catch(() => { setLiveHolders([]); })
      .finally(() => setHoldersLoading(false));
  }, [tab, activeSlug, contractParam]);

  // Mock balances — replaced by real Tauri calls when API is wired
  const mockBalances = (id: string) => {
    const seed = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const eth  = ((seed % 800) / 100 + 0.5).toFixed(3);
    const weth = ((seed % 400) / 100 + 0.1).toFixed(3);
    return { eth, weth };
  };

  type NftItem = typeof NFT_ITEMS[0];

  // ── Buy modal state ──────────────────────────────────────────────────────
  const [buyNft,        setBuyNft]       = useState<NftItem | null>(null);
  const [buyWallet,     setBuyWallet]    = useState('');
  const [buyDropOpen,   setBuyDropOpen]  = useState(false);
  const buyDropRef = useRef<HTMLDivElement>(null);
  const [buyStep,       setBuyStep]      = useState<'confirm' | 'processing' | 'done'>('confirm');

  useEffect(() => {
    if (!buyDropOpen) return;
    const h = (e: MouseEvent) => { if (buyDropRef.current && !buyDropRef.current.contains(e.target as Node)) setBuyDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [buyDropOpen]);

  // ── Offer modal state ────────────────────────────────────────────────────
  type OfferConfig = { amount: string; qty: number };
  const [offerNft,     setOfferNft]    = useState<NftItem | null>(null);
  const [offerConfigs, setOfferConfigs] = useState<Record<string, OfferConfig>>({});
  type ExpiryUnit = 'minutes' | 'hours' | 'days' | 'months';
  const [offerExpiryQty,  setOfferExpiryQty]  = useState('7');
  const [offerExpiryUnit, setOfferExpiryUnit] = useState<ExpiryUnit>('days');
  const [offerExpiryOpen, setOfferExpiryOpen] = useState(false);
  const offerExpiryRef = useRef<HTMLDivElement>(null);
  const [offerStep,    setOfferStep]   = useState<'form' | 'processing' | 'done'>('form');
  type TxnStatus = 'signing' | 'broadcasting' | 'confirmed' | 'failed';
  const [txnProgress, setTxnProgress] = useState<Record<string, TxnStatus>>({});
  const offerTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const submitOffers = () => {
    if (!offerValid) return;
    const ids = Object.keys(offerConfigs);
    // init all to 'signing'
    setTxnProgress(Object.fromEntries(ids.map(id => [id, 'signing'])));
    setOfferStep('processing');
    // stagger: each wallet advances with a small offset
    ids.forEach((id, i) => {
      const t1 = setTimeout(() => setTxnProgress(p => ({ ...p, [id]: 'broadcasting' })), 900 + i * 300);
      const t2 = setTimeout(() => setTxnProgress(p => ({ ...p, [id]: 'confirmed' })), 2000 + i * 300);
      offerTimersRef.current.push(t1, t2);
    });
    // transition to done after all confirmed
    const total = setTimeout(() => setOfferStep('done'), 2200 + ids.length * 300);
    offerTimersRef.current.push(total);
  };

  const [filterPriceMin, setFilterPriceMin] = useState('');
  const [filterPriceMax, setFilterPriceMax] = useState('');
  const [filterRarityMin, setFilterRarityMin] = useState('');
  const [filterRarityMax, setFilterRarityMax] = useState('');
  const [appliedRarityMin, setAppliedRarityMin] = useState('');
  const [appliedRarityMax, setAppliedRarityMax] = useState('');
  const [filterSectionOpen, setFilterSectionOpen] = useState<Record<string, boolean>>({ Rarity: false, Price: false, Marketplaces: false, Traits: true });
  const [filterTraitOpen, setFilterTraitOpen] = useState<Record<string, boolean>>({});

  // ── Collection Bid tab state ─────────────────────────────────────────────
  const [colBidQty, setColBidQty] = useState(1);
  const [colBidAmount, setColBidAmount] = useState('');
  const [colBidExpiry, setColBidExpiry] = useState('12 hours');
  const [colBidExpiryOpen, setColBidExpiryOpen] = useState(false);
  const colBidExpiryRef = useRef<HTMLDivElement>(null);
  const [colBidTraits, setColBidTraits] = useState<{ category: string; value: string }[]>([]);
  const [colBidTraitPickerOpen, setColBidTraitPickerOpen] = useState(false);
  const colBidTraitPickerRef = useRef<HTMLDivElement>(null);
  const colBidTraitDropRef = useRef<HTMLDivElement>(null);
  const colBidTraitBtnRef = useRef<HTMLButtonElement>(null);
  const [colBidTraitDropPos, setColBidTraitDropPos] = useState<{ top: number; right: number } | null>(null);
  const [colBidTraitCat, setColBidTraitCat] = useState('');
  const [colBidTraitSearch, setColBidTraitSearch] = useState('');
  const [colBidStep, setColBidStep] = useState<'form' | 'review' | 'processing' | 'done'>('form');
  const [colBidWallet, setColBidWallet] = useState<string>('');
  const [colBidWalletBalances, setColBidWalletBalances] = useState<Record<string, { eth?: number; weth?: number }>>({});
  const [colBidWalletDropOpen, setColBidWalletDropOpen] = useState(false);
  const colBidWalletDropRef = useRef<HTMLDivElement>(null);
  const colBidExpiryBtnRef = useRef<HTMLButtonElement>(null);
  const [colBidExpiryDropPos, setColBidExpiryDropPos] = useState<{ bottom: number; right: number } | null>(null);
  const [filterTraitSelected, setFilterTraitSelected] = useState<Record<string, string[]>>({});
  const toggleFilterSection = (k: string) => setFilterSectionOpen(p => ({ ...p, [k]: !p[k] }));
  const toggleFilterTrait = (k: string) => setFilterTraitOpen(p => ({ ...p, [k]: !p[k] }));

  // Auto-open all trait categories when traits first load
  useEffect(() => {
    if (!liveTraits || liveTraits.length === 0) return;
    setFilterTraitOpen(prev => {
      const next = { ...prev };
      liveTraits.forEach(t => { if (!(t.category in next)) next[t.category] = true; });
      return next;
    });
  }, [liveTraits]);
  const toggleTraitValue = (cat: string, val: string) =>
    setFilterTraitSelected(p => {
      const cur = p[cat] ?? [];
      return { ...p, [cat]: cur.includes(val) ? cur.filter(v => v !== val) : [...cur, val] };
    });

  // Client-side filter + sort applied on top of API results
  const displayNfts = useMemo(() => {
    if (!liveNfts) return null;
    // Merge listing prices into items (the /collection/{slug}/nfts endpoint
    // doesn't include price; /listings/collection/{slug}/best does).
    let items = liveNfts.map(n =>
      n.price_eth != null ? n : { ...n, price_eth: listingsPriceMap[n.identifier] ?? null }
    );
    const minRank = parseInt(appliedRarityMin);
    const maxRank = parseInt(appliedRarityMax);
    if (!isNaN(minRank) && minRank > 0) items = items.filter(n => n.rarity != null && n.rarity.rank >= minRank);
    if (!isNaN(maxRank) && maxRank > 0) items = items.filter(n => n.rarity != null && n.rarity.rank <= maxRank);
    const minEth = parseFloat(filterPriceMin);
    const maxEth = parseFloat(filterPriceMax);
    if (!isNaN(minEth)) items = items.filter(n => n.price_eth != null && n.price_eth >= minEth);
    if (!isNaN(maxEth)) items = items.filter(n => n.price_eth != null && n.price_eth <= maxEth);
    const activeTraits = Object.entries(filterTraitSelected).filter(([, vals]) => vals.length > 0);
    if (activeTraits.length > 0) {
      items = items.filter(nft =>
        activeTraits.every(([cat, vals]) =>
          (nft.traits ?? []).some(t => t.trait_type === cat && vals.includes(t.value))
        )
      );
    }
    // Client-side sort (supplements API-side sort for unlisted/all status)
    switch (sortBy) {
      case 'Most rare':
        items.sort((a, b) => (a.rarity?.rank ?? Infinity) - (b.rarity?.rank ?? Infinity));
        break;
      case 'Least rare':
        items.sort((a, b) => (b.rarity?.rank ?? 0) - (a.rarity?.rank ?? 0));
        break;
      case 'Price low to high':
        items.sort((a, b) => (a.price_eth ?? Infinity) - (b.price_eth ?? Infinity));
        break;
      case 'Price high to low':
        items.sort((a, b) => (b.price_eth ?? -Infinity) - (a.price_eth ?? -Infinity));
        break;
      case 'Highest last sale':
        items.sort((a, b) => (b.last_sale_eth ?? -Infinity) - (a.last_sale_eth ?? -Infinity));
        break;
      case 'Lowest last sale':
        items.sort((a, b) => (a.last_sale_eth ?? Infinity) - (b.last_sale_eth ?? Infinity));
        break;
    }
    return items;
  }, [liveNfts, listingsPriceMap, appliedRarityMin, appliedRarityMax, filterPriceMin, filterPriceMax, filterTraitSelected, sortBy]);

  useEffect(() => {
    if (!sortDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) setSortDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sortDropdownOpen]);

  useEffect(() => {
    if (!colBidExpiryOpen) return;
    const h = (e: MouseEvent) => { if (colBidExpiryRef.current && !colBidExpiryRef.current.contains(e.target as Node)) setColBidExpiryOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colBidExpiryOpen]);

  useEffect(() => {
    if (!colBidTraitPickerOpen) return;
    const h = (e: MouseEvent) => {
      const inBtn = colBidTraitPickerRef.current?.contains(e.target as Node);
      const inDrop = colBidTraitDropRef.current?.contains(e.target as Node);
      if (!inBtn && !inDrop) setColBidTraitPickerOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colBidTraitPickerOpen]);

  useEffect(() => {
    if (!colBidWalletDropOpen) return;
    const h = (e: MouseEvent) => { if (colBidWalletDropRef.current && !colBidWalletDropRef.current.contains(e.target as Node)) setColBidWalletDropOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colBidWalletDropOpen]);

  // Fetch ETH + WETH balances when Collection Bid tab opens
  useEffect(() => {
    if (tab !== 'Make Collection Bid' || wallets.length === 0) return;
    if (!colBidWallet) setColBidWallet(wallets[0].address);
    const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
    wallets.forEach(w => {
      getEthBalance(w.address, '').then(b => {
        setColBidWalletBalances(prev => ({ ...prev, [w.address]: { ...(prev[w.address] ?? {}), eth: b.eth } }));
      }).catch(() => {});
      getTokenBalances(w.address, '').then(toks => {
        const wethTok = toks.find(t => t.contract_address.toLowerCase() === WETH);
        if (wethTok?.token_balance && wethTok.token_balance !== '0x0' && wethTok.token_balance !== '0x00') {
          const weth = Number(BigInt(wethTok.token_balance)) / 1e18;
          setColBidWalletBalances(prev => ({ ...prev, [w.address]: { ...(prev[w.address] ?? {}), weth } }));
        }
      }).catch(() => {});
    });
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!offerExpiryOpen) return;
    const handler = (e: MouseEvent) => {
      if (offerExpiryRef.current && !offerExpiryRef.current.contains(e.target as Node)) setOfferExpiryOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [offerExpiryOpen]);

  const toggleOfferWallet = (id: string) => {
    setOfferConfigs(prev => {
      if (prev[id]) { const { [id]: _, ...rest } = prev; return rest; }
      return { ...prev, [id]: { amount: '', qty: 1 } };
    });
  };
  const setOfferField = (id: string, field: keyof OfferConfig, value: string | number) =>
    setOfferConfigs(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const offerValid = Object.keys(offerConfigs).length > 0 &&
    Object.values(offerConfigs).every(c => parseFloat(c.amount) > 0 && c.qty >= 1);

  useEffect(() => {
    const t = searchParams.get('tab') as Tab | null;
    if (t && TABS.includes(t)) setTab(t);
  }, [searchParams]);

  return (
    <div className="min-h-full bg-[#000000] text-white flex flex-col">

      {/* ── BUY MODAL ── */}
      {buyNft && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setBuyNft(null); }}>
          <div style={{ width: 420, backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px' }}
            onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
              <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>
                {buyStep === 'done' ? 'Purchase Complete' : 'Confirm Purchase'}
              </h2>
              <button onClick={() => setBuyNft(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px' }}>×</button>
            </div>

            {buyStep === 'confirm' && (
              <>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
                  Review and sign to complete the purchase
                </p>

                {/* Wallet dropdown */}
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
                    Buying Wallet
                  </label>
                  <div ref={buyDropRef} style={{ position: 'relative' }}>
                    <button onClick={() => setBuyDropOpen(o => !o)} style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: buyWallet ? 'var(--wr-text)' : 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface-alt)', border: `1px solid ${buyDropOpen ? 'var(--wr-accent)' : 'var(--wr-border)'}`, padding: '10px 36px 10px 12px', textAlign: 'left', cursor: 'pointer', outline: 'none' }}>
                      {buyWallet ? (() => { const w = wallets.find(x => x.id === buyWallet)!; const b = mockBalances(w.id); return `${w.name} · ${b.eth} ETH · ${b.weth} WETH`; })() : 'Select wallet…'}
                    </button>
                    <span style={{ position: 'absolute', right: '12px', top: '50%', transform: `translateY(-50%) rotate(${buyDropOpen ? 180 : 0}deg)`, color: 'var(--wr-text-3)', fontSize: '10px', pointerEvents: 'none', transition: 'transform 0.15s' }}>▾</span>
                    {buyDropOpen && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 10, backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                        {wallets.map(w => { const b = mockBalances(w.id); const short = `${w.address.slice(0,6)}…${w.address.slice(-4)}`; const sel = buyWallet === w.id; return (
                          <div key={w.id} onClick={() => { setBuyWallet(w.id); setBuyDropOpen(false); }}
                            style={{ padding: '10px 12px', cursor: 'pointer', backgroundColor: sel ? 'var(--wr-accent-dim)' : 'transparent', borderBottom: '1px solid var(--wr-border)' }}
                            onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = sel ? 'var(--wr-accent-dim)' : 'transparent'; }}>
                            <div className="flex items-center justify-between">
                              <div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: sel ? 'var(--wr-accent)' : 'var(--wr-text)' }}>{w.name}</div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)' }}>{short}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text)' }}>{b.eth} ETH</div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>{b.weth} WETH</div>
                              </div>
                            </div>
                          </div>
                        );})}
                      </div>
                    )}
                  </div>
                </div>

                {/* NFT summary */}
                <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: '4px' }}>
                    {col.symbol} {buyNft.id}
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    {buyNft.traits.map(t => (
                      <span key={t} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '8px', color: '#a1a1aa', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '1px 5px' }}>{t}</span>
                    ))}
                  </div>
                  <div className="flex justify-between">
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>Price</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{buyNft.price}</span>
                  </div>
                  <div className="flex justify-between" style={{ marginTop: '4px' }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>Est. Gas</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>~0.003 ETH</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setBuyNft(null)} style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '11px 0', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button
                    onClick={() => { if (!buyWallet) return; setBuyStep('processing'); setTimeout(() => setBuyStep('done'), 2200); }}
                    style={{ flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000', backgroundColor: buyWallet ? '#beff00' : 'var(--wr-surface-alt)', border: 'none', padding: '11px 0', cursor: buyWallet ? 'pointer' : 'not-allowed', opacity: buyWallet ? 1 : 0.5 }}>
                    Confirm & Buy
                  </button>
                </div>
              </>
            )}

            {buyStep === 'processing' && (
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', marginBottom: '8px' }}>Broadcasting transaction…</div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#a1a1aa' }}>Please wait</div>
              </div>
            )}
            {buyStep === 'done' && (
              <>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#34d399', marginBottom: '20px' }}>
                  ✓ {col.symbol} {buyNft.id} purchased for {buyNft.price}
                </p>
                <button onClick={() => setBuyNft(null)} style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000', backgroundColor: '#beff00', border: 'none', padding: '11px 0', cursor: 'pointer' }}>Done</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── OFFER MODAL ── */}
      {offerNft && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setOfferNft(null); }}>
          <div style={{ width: 480, backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', padding: '28px', maxHeight: '90vh', overflowY: 'auto' }}
            onMouseDown={e => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
              <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>
                {offerStep === 'done' ? 'Offers Submitted' : 'Make an Offer'}
              </h2>
              <button onClick={() => setOfferNft(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px' }}>×</button>
            </div>

            {offerStep === 'form' && (
              <>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
                  {col.symbol} {offerNft.id} · Floor {offerNft.price}
                </p>

                {/* Expiry */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>Expiry</label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={offerExpiryQty}
                      onChange={e => setOfferExpiryQty(e.target.value.replace(/[^0-9]/g, ''))}
                      style={{ width: '56px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '7px 0', outline: 'none', textAlign: 'center' }}
                    />
                    <div ref={offerExpiryRef} style={{ position: 'relative', width: '140px' }}>
                      <button
                        onClick={() => setOfferExpiryOpen(v => !v)}
                        style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '7px 10px', cursor: 'pointer' }}>
                        <span style={{ textTransform: 'capitalize' }}>{offerExpiryUnit}</span>
                        <span style={{ display: 'inline-block', transform: offerExpiryOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', color: 'var(--wr-text-3)', fontSize: '9px' }}>▼</span>
                      </button>
                      {offerExpiryOpen && (
                        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', zIndex: 200 }}>
                          {(['minutes', 'hours', 'days', 'months'] as ExpiryUnit[]).map(unit => (
                            <button key={unit} onClick={() => { setOfferExpiryUnit(unit); setOfferExpiryOpen(false); }}
                              style={{ width: '100%', display: 'block', textAlign: 'left', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: offerExpiryUnit === unit ? 700 : 400, color: offerExpiryUnit === unit ? 'var(--wr-accent)' : 'var(--wr-text-1)', backgroundColor: 'transparent', border: 'none', padding: '7px 10px', cursor: 'pointer', textTransform: 'capitalize' }}>
                              {unit}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Multi-wallet selector */}
                <div style={{ marginBottom: '8px' }}>
                  <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '8px' }}>
                    Wallets — select one or more
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {wallets.map(w => {
                      const b = mockBalances(w.id);
                      const short = `${w.address.slice(0,6)}…${w.address.slice(-4)}`;
                      const cfg = offerConfigs[w.id];
                      const sel = !!cfg;
                      return (
                        <div key={w.id}>
                          {/* Wallet row */}
                          <div onClick={() => toggleOfferWallet(w.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', cursor: 'pointer', backgroundColor: sel ? 'var(--wr-accent-dim)' : 'var(--wr-surface-alt)', border: `1px solid ${sel ? 'var(--wr-accent)' : 'var(--wr-border)'}`, borderBottom: sel ? 'none' : undefined }}>
                            {/* Checkbox */}
                            <div style={{ width: 14, height: 14, border: `1.5px solid ${sel ? 'var(--wr-accent)' : 'var(--wr-text-3)'}`, backgroundColor: sel ? 'var(--wr-accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {sel && <span style={{ color: '#000', fontSize: '9px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)' }}>{w.name}</div>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)' }}>{short}</div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text)' }}>{b.eth} ETH</div>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>{b.weth} WETH</div>
                            </div>
                          </div>
                          {/* Per-wallet config (expanded when selected) */}
                          {sel && (
                            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-accent)', borderTop: 'none', padding: '10px 12px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                              <div style={{ flex: 2 }}>
                                <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '4px' }}>Amount (WETH)</label>
                                <input
                                  type="text" inputMode="decimal"
                                  value={cfg.amount}
                                  onClick={e => e.stopPropagation()}
                                  onChange={e => { const v = e.target.value; if (/^\d*\.?\d*$/.test(v)) setOfferField(w.id, 'amount', v); }}
                                  placeholder="0.00"
                                  className="focus:border-[#BEFF00] placeholder-[#3a3a3a]"
                                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '7px 10px', width: '100%', outline: 'none' }}
                                />
                              </div>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '4px' }}>Qty</label>
                                <div style={{ display: 'flex', border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface-alt)' }}>
                                  <button onClick={e => { e.stopPropagation(); setOfferField(w.id, 'qty', Math.max(1, cfg.qty - 1)); }} style={{ width: 28, fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}>−</button>
                                  <span style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', lineHeight: '32px' }}>{cfg.qty}</span>
                                  <button onClick={e => { e.stopPropagation(); setOfferField(w.id, 'qty', cfg.qty + 1); }} style={{ width: 28, fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer' }}>+</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* CTA row */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
                  <button onClick={() => setOfferNft(null)}
                    style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '12px 0', cursor: 'pointer' }}>
                    Cancel
                  </button>
                  <button onClick={submitOffers} disabled={!offerValid}
                    style={{ flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000000', backgroundColor: offerValid ? '#BEFF00' : '#BEFF0040', border: 'none', padding: '12px 0', cursor: offerValid ? 'pointer' : 'not-allowed', letterSpacing: '0.5px' }}>
                    Submit {Object.keys(offerConfigs).length > 1 ? `${Object.keys(offerConfigs).length} Offers` : 'Offer'}
                  </button>
                </div>
              </>
            )}

            {/* ── Processing: per-wallet TXN progress ── */}
            {offerStep === 'processing' && (
              <div style={{ paddingTop: '4px' }}>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
                  {col.symbol} {offerNft.id} · {offerExpiryQty} {offerExpiryUnit}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {Object.entries(offerConfigs).map(([id, cfg]) => {
                    const w = wallets.find(x => x.id === id);
                    const status = txnProgress[id] ?? 'signing';
                    const steps: TxnStatus[] = ['signing', 'broadcasting', 'confirmed'];
                    const stepIdx = steps.indexOf(status);
                    return w ? (
                      <div key={id} style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '14px 16px' }}>
                        {/* Wallet + amount */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)' }}>{w.name}</div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>{w.address.slice(0,6)}…{w.address.slice(-4)}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)' }}>{cfg.amount} WETH</div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>qty {cfg.qty}</div>
                          </div>
                        </div>
                        {/* Step track */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                          {steps.map((step, i) => {
                            const done  = stepIdx > i;
                            const active = stepIdx === i;
                            const label = step.charAt(0).toUpperCase() + step.slice(1);
                            return (
                              <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : undefined }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${done || active ? '#BEFF00' : 'var(--wr-border)'}`, backgroundColor: done ? '#BEFF00' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                    {done
                                      ? <span style={{ color: '#000', fontSize: '10px', fontWeight: 900 }}>✓</span>
                                      : active
                                        ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: '#BEFF00', animation: 'wr-pulse 1s ease-in-out infinite' }} />
                                        : null}
                                  </div>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: done || active ? 'var(--wr-text)' : 'var(--wr-text-3)', letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>{label}</span>
                                </div>
                                {i < steps.length - 1 && (
                                  <div style={{ flex: 1, height: 2, backgroundColor: done ? '#BEFF00' : 'var(--wr-border)', marginBottom: '13px', margin: '0 4px 13px 4px' }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
              </div>
            )}

            {/* ── Done ── */}
            {offerStep === 'done' && (
              <>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
                  {col.symbol} {offerNft.id} · {offerExpiryQty} {offerExpiryUnit}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                  {Object.entries(offerConfigs).map(([id, cfg]) => {
                    const w = wallets.find(x => x.id === id);
                    return w ? (
                      <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid #1a3320', padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{ width: 20, height: 20, borderRadius: '50%', backgroundColor: '#BEFF00', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <span style={{ color: '#000', fontSize: '10px', fontWeight: 900 }}>✓</span>
                          </div>
                          <div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)' }}>{w.name}</div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>Offer submitted</div>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#34d399' }}>{cfg.amount} WETH</div>
                          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>qty {cfg.qty}</div>
                        </div>
                      </div>
                    ) : null;
                  })}
                </div>
                <button onClick={() => { setOfferNft(null); setTxnProgress({}); }}
                  style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000000', backgroundColor: '#BEFF00', border: 'none', padding: '13px 0', cursor: 'pointer', letterSpacing: '0.5px' }}>
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── HEADER ── */}
      <div className="border-b border-[#1a1a1a] px-12 pt-6 pb-0">
        {/* Breadcrumb */}
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '16px' }}>
          <Link href="/monitor" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Monitor</Link>
          <span>›</span>
          <span style={{ color: 'var(--wr-text)' }}>{col.name || 'Collection'}</span>
        </div>

        <div className="flex items-start gap-4 mb-4">
          {/* Avatar — real image or gradient fallback */}
          {imageParam ? (
            <img src={imageParam} alt={col.name} className="w-11 h-11 rounded object-cover shrink-0" />
          ) : (
            <div className="w-11 h-11 rounded flex items-center justify-center text-white text-[15px] font-bold shrink-0"
              style={{ background: `linear-gradient(135deg, ${col.color}99 0%, ${col.color} 100%)` }}>
              {col.symbol[0]}
            </div>
          )}

          {/* Name + symbol */}
          <div className="flex-1 min-w-0">
            <div className="text-[22px] font-bold text-white leading-none">{col.name}</div>
            <div className="text-[#6e6e6e] text-[11px] mt-0.5 font-mono">{col.symbol} · ERC-721 · Ethereum Mainnet</div>
          </div>

          {/* KPI bar */}
          {(() => {
            const floor = liveStats?.floor_price_eth != null ? `${liveStats.floor_price_eth.toFixed(3)} ETH` : col.floor;
            const floorChange = liveStats?.vol_1d_change != null ? liveStats.vol_1d_change * 100 : null;
            const topOffer = liveOffers != null && liveOffers.length > 0
              ? `${Math.max(...liveOffers.map(o => o.price_eth)).toFixed(3)} ETH`
              : '—';
            const totalVol = liveStats?.total_volume_eth != null
              ? liveStats.total_volume_eth >= 1000
                ? `${(liveStats.total_volume_eth / 1000).toFixed(1)}K ETH`
                : `${liveStats.total_volume_eth.toFixed(1)} ETH`
              : '—';
            return (
              <div className="flex items-center gap-3 shrink-0">
                <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-center min-w-[90px]">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-jetbrains)' }}>Floor</div>
                  <div className="text-[13px] font-bold text-white" style={{ fontFamily: 'var(--font-jetbrains)' }}>{floor}</div>
                </div>
                <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-center min-w-[90px]">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-jetbrains)' }}>1D Floor Chg</div>
                  {floorChange != null ? (
                    <div className={`text-[13px] font-bold ${floorChange >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`} style={{ fontFamily: 'var(--font-jetbrains)' }}>
                      {floorChange >= 0 ? '+' : ''}{floorChange.toFixed(1)}%
                    </div>
                  ) : (
                    <div className="text-[13px] font-bold text-[#6e6e6e]" style={{ fontFamily: 'var(--font-jetbrains)' }}>—</div>
                  )}
                </div>
                <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-center min-w-[90px]">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-jetbrains)' }}>Top Offer</div>
                  <div className="text-[13px] font-bold text-white" style={{ fontFamily: 'var(--font-jetbrains)' }}>{topOffer}</div>
                </div>
                <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-center min-w-[90px]">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-jetbrains)' }}>2H Volume</div>
                  <div className="text-[13px] font-bold text-[#6e6e6e]" style={{ fontFamily: 'var(--font-jetbrains)' }}>—</div>
                </div>
                <div className="bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-center min-w-[90px]">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1" style={{ fontFamily: 'var(--font-jetbrains)' }}>Total Vol</div>
                  <div className="text-[13px] font-bold text-white" style={{ fontFamily: 'var(--font-jetbrains)' }}>{totalVol}</div>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-0">
          {TABS.map(t => {
            const isActive = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
                  isActive ? 'text-[#beff00] border-[#beff00]' : 'text-[#6e6e6e] border-transparent hover:text-[#a1a1aa]'
                }`}
                style={{ backgroundColor: isActive ? 'var(--wr-hover-bg)' : 'transparent' }}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 px-12 py-6">

        {/* ── FEED TAB ── */}
        {tab === 'Activity' && (
          <>
            {/* Filter bar */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-1">
                {([
                  { key: 'all',              label: 'All' },
                  { key: 'sale',             label: 'Sales' },
                  { key: 'listing',          label: 'Listings' },
                  { key: 'offer',            label: 'Item Offers' },
                  { key: 'collection_offer', label: 'Collection Offers' },
                  { key: 'trait_offer',      label: 'Trait Offers' },
                  { key: 'transfer',         label: 'Transfers' },
                  { key: 'mint',             label: 'Mints' },
                ] as { key: FeedFilterType | 'all'; label: string }[]).map(f => {
                  const isAll = f.key === 'all';
                  const active = isAll ? feedFilters.size === 0 : feedFilters.has(f.key as FeedFilterType);
                  return (
                    <button key={f.key}
                      onClick={() => {
                        if (isAll) {
                          setFeedFilters(new Set());
                        } else {
                          setFeedFilters(prev => {
                            const next = new Set(prev);
                            if (next.has(f.key as FeedFilterType)) {
                              next.delete(f.key as FeedFilterType);
                            } else {
                              next.add(f.key as FeedFilterType);
                            }
                            return next;
                          });
                        }
                      }}
                      style={{
                        fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                        padding: '4px 10px', cursor: 'pointer',
                        color: active ? '#000' : '#6e6e6e',
                        backgroundColor: active ? '#beff00' : 'transparent',
                        border: active ? '1px solid #beff00' : '1px solid #1a1a1a',
                        transition: 'all 0.1s',
                      }}>
                      {f.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#6e6e6e' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#34d399', display: 'inline-block' }} />
                Live
              </div>
            </div>

            {/* Feed table */}
            <div className="border border-[#1a1a1a] overflow-x-auto">
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 110px 50px 120px 120px 100px', borderBottom: '1px solid #1a1a1a', padding: '0 16px' }}>
                {['EVENT', 'ITEM', 'PRICE', 'QTY', 'FROM', 'TO', 'TIME'].map(h => (
                  <div key={h} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em', padding: '10px 0 10px 0' }}>{h}</div>
                ))}
              </div>

              {eventsLoading && (
                <div className="px-4 py-6 text-[11px] text-[#6e6e6e]">Loading events…</div>
              )}
              {!eventsLoading && liveEvents !== null && liveEvents.length === 0 && (
                <div className="px-4 py-6 text-[11px] text-[#6e6e6e]">No events found.</div>
              )}

              {!eventsLoading && (liveEvents ?? [])
                .filter(ev => {
                  if (feedFilters.size === 0) return true;
                  const ZERO = '0x0000000000000000000000000000000000000000';
                  if (feedFilters.has('mint')) {
                    if (ev.event_type === 'transfer' && ev.from_address === ZERO) return true;
                  }
                  return feedFilters.has(ev.event_type as FeedFilterType);
                })
                .map((ev, i) => {
                const shortAddr = (a?: string | null) => {
                  if (!a) return '';
                  if (a.length <= 10) return a;
                  return `${a.slice(0, 6)}…${a.slice(-4)}`;
                };

                // Event type tag spec (from design system — Tags Section › NFT Activity Tags)
                const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
                const isMintEv = (ev.event_type === 'transfer' && ev.from_address === ZERO_ADDR) || ev.event_type === 'redemption';
                type TagSpec = { label: string; color: string; bg: string };
                const tagSpec: TagSpec = (() => {
                  if (isMintEv) return { label: 'Mint',       color: '#3B82F6', bg: '#16203640' };
                  switch (ev.event_type) {
                    case 'sale':             return { label: 'Sale',       color: '#22C55E', bg: '#16231640' };
                    case 'listing':          return { label: 'List',       color: '#F59E0B', bg: '#23201640' };
                    case 'offer':            return { label: 'Offer',      color: '#A855F7', bg: '#22163640' };
                    case 'collection_offer': return { label: 'Col. Offer', color: '#A855F7', bg: '#22163640' };
                    case 'order':            return { label: 'Col. Offer', color: '#A855F7', bg: '#22163640' };
                    case 'trait_offer':      return { label: 'Trait Offer',color: '#A855F7', bg: '#22163640' };
                    case 'transfer':         return { label: 'Transfer',   color: '#6B7280', bg: '#1A1A1A' };
                    case 'cancel':           return { label: 'Cancel',     color: '#EF4444', bg: '#23163640' };
                    default:                 return { label: ev.event_type,color: '#6B7280', bg: '#1A1A1A' };
                  }
                })();
                const isCollectionOffer = ev.event_type === 'collection_offer' || ev.event_type === 'order';
                const hasLink = ev.event_type === 'sale' || ev.event_type === 'transfer' || ev.event_type === 'redemption';

                // Price color: green=ETH, red=WETH, white=otherwise
                const sym = ev.payment_symbol ?? 'ETH';
                const priceColor = ev.event_type === 'sale'
                  ? (sym === 'WETH' ? '#f87171' : '#34d399')
                  : '#e4e4e7';

                // Time
                const ts = ev.timestamp ? new Date(ev.timestamp * 1000) : null;
                const timeStr = ts ? (() => {
                  const diff = Math.floor((Date.now() - ts.getTime()) / 1000);
                  if (diff < 60) return `${diff}s ago`;
                  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
                  return `${Math.floor(diff / 86400)}d ago`;
                })() : '';

                // FROM / TO addresses
                const fromAddr = ev.event_type === 'sale' ? shortAddr(ev.seller)
                  : ev.event_type === 'listing' ? shortAddr(ev.seller)
                  : ev.event_type === 'offer' || ev.event_type === 'collection_offer' || ev.event_type === 'trait_offer' || ev.event_type === 'order' ? shortAddr(ev.seller ?? ev.from_address)
                  : ev.event_type === 'transfer' ? shortAddr(ev.from_address)
                  : ev.event_type === 'redemption' ? 'NullAddress'
                  : shortAddr(ev.from_address);

                const toAddr = ev.event_type === 'sale' ? shortAddr(ev.buyer)
                  : ev.event_type === 'transfer' ? shortAddr(ev.to_address)
                  : ev.event_type === 'redemption' ? shortAddr(ev.to_address)
                  : '';

                const nftName = ev.nft_name ?? (ev.token_id ? `#${ev.token_id}` : '—');

                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 110px 50px 120px 120px 100px', padding: '0 16px', borderBottom: '1px solid #1a1a1a', alignItems: 'center', minHeight: '52px' }}
                    onMouseEnter={hoverOn} onMouseLeave={hoverOff}>

                    {/* EVENT col */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: 4, backgroundColor: tagSpec.bg }}>
                        <div style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tagSpec.color, flexShrink: 0 }} />
                        <span style={{ fontFamily: 'var(--font-inter, Inter, sans-serif)', fontSize: '12px', fontWeight: 500, color: tagSpec.color, whiteSpace: 'nowrap' }}>{tagSpec.label}</span>
                      </div>
                    </div>

                    {/* ITEM / COLLECTION col */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        {ev.nft_image_url ? (
                          <img src={ev.nft_image_url} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 4, backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#6e6e6e', fontFamily: 'var(--font-jetbrains)' }}>NFT</div>
                        )}
                        {/* ETH badge */}
                        <div style={{ position: 'absolute', bottom: -2, right: -2, width: 12, height: 12, borderRadius: '50%', backgroundColor: '#627eea', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1.5px solid #0a0a0a' }}>
                          <svg width="6" height="9" viewBox="0 0 10 15" fill="none">
                            <path d="M5 0L0 7.5L5 10.5L10 7.5L5 0Z" fill="white" opacity="0.7"/>
                            <path d="M5 11.5L0 8.5L5 15L10 8.5L5 11.5Z" fill="white"/>
                          </svg>
                        </div>
                      </div>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {isCollectionOffer ? col.name : nftName}
                      </span>
                    </div>

                    {/* PRICE col */}
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500 }}>
                      {ev.price_eth != null ? (
                        <span style={{ color: priceColor }}>{ev.price_eth.toFixed(4)} <span style={{ color: '#6e6e6e', fontSize: '10px' }}>{sym}</span></span>
                      ) : (
                        <span style={{ color: '#6e6e6e' }}>—</span>
                      )}
                    </div>

                    {/* QTY col */}
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#e4e4e7' }}>1</div>

                    {/* FROM col */}
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#a1a1aa' }}>{fromAddr || '—'}</div>

                    {/* TO col */}
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#a1a1aa' }}>{toAddr || ''}</div>

                    {/* TIME col */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', justifyContent: 'flex-end' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e' }}>{timeStr}</span>
                      {hasLink && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 8L8 2M4 2h4v4" stroke="#6e6e6e" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── OFFERS TAB ── */}
        {tab === 'Offers' && (() => {
          const offers = liveOffers ?? [];
          // Group offers by price level
          type OfferGroup = { price_eth: number; symbol: string; volume: number; count: number; bidders: { addr: string; img: string | null }[] };
          const groupMap = new Map<string, OfferGroup>();
          for (const o of offers) {
            const key = o.price_eth.toFixed(6);
            const existing = groupMap.get(key);
            if (existing) {
              existing.volume += o.price_eth * o.quantity;
              existing.count += 1;
              if (!existing.bidders.find(b => b.addr === o.maker_address)) {
                existing.bidders.push({ addr: o.maker_address, img: o.maker_image_url });
              }
            } else {
              groupMap.set(key, {
                price_eth: o.price_eth,
                symbol: o.payment_symbol,
                volume: o.price_eth * o.quantity,
                count: 1,
                bidders: [{ addr: o.maker_address, img: o.maker_image_url }],
              });
            }
          }
          const groups = Array.from(groupMap.values()).sort((a, b) => b.price_eth - a.price_eth);
          const maxPrice = groups[0]?.price_eth ?? 1;
          const totalVolume = groups.reduce((s, g) => s + g.volume, 0);
          const totalCount = groups.reduce((s, g) => s + g.count, 0);

          return (
            <div>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>
                  {offersLoading ? '…' : `${totalCount} offers`}
                </span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>
                  Total collection offers{' '}
                  <span style={{ color: '#e4e4e7', fontWeight: 700 }}>{totalVolume > 0 ? totalVolume.toFixed(4) : '—'} WETH</span>
                </span>
              </div>

              {/* Table */}
              <div style={{ border: '1px solid #1a1a1a' }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '10px 16px', borderBottom: '1px solid #1a1a1a' }}>
                  {['OFFER PRICE', 'VOLUME', 'OFFERS', 'BIDDERS'].map(h => (
                    <div key={h} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em' }}>{h}</div>
                  ))}
                </div>

                {offersLoading && (
                  <div style={{ padding: '24px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e' }}>Loading offers…</div>
                )}
                {!offersLoading && groups.length === 0 && (
                  <div style={{ padding: '24px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e' }}>No active offers.</div>
                )}
                {!offersLoading && groups.map((g, i) => {
                  const barPct = (g.price_eth / maxPrice) * 100;
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', padding: '0 16px', borderBottom: i < groups.length - 1 ? '1px solid #1a1a1a' : 'none', alignItems: 'center', minHeight: '48px' }}>
                      {/* OFFER PRICE with progress bar */}
                      <div style={{ position: 'relative', paddingRight: '16px' }}>
                        <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', height: '28px', width: `${barPct}%`, backgroundColor: '#14532d', borderRadius: '2px', minWidth: '8px' }} />
                        <span style={{ position: 'relative', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: '#e4e4e7', paddingLeft: '8px' }}>
                          {g.price_eth.toFixed(4)}{' '}
                          <span style={{ color: '#6e6e6e', fontSize: '10px' }}>{g.symbol}</span>
                        </span>
                      </div>
                      {/* VOLUME */}
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>
                        {g.volume.toFixed(4)} <span style={{ fontSize: '10px', color: '#6e6e6e' }}>{g.symbol}</span>
                      </div>
                      {/* OFFERS */}
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#e4e4e7' }}>{g.count}</div>
                      {/* BIDDERS */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ display: 'flex' }}>
                          {g.bidders.slice(0, 4).map((b, bi) => (
                            <div key={bi} style={{ width: 22, height: 22, borderRadius: '50%', border: '1.5px solid #0a0a0a', marginLeft: bi > 0 ? -8 : 0, overflow: 'hidden', backgroundColor: '#2a2a2a', flexShrink: 0 }}>
                              {b.img ? (
                                <img src={b.img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <div style={{ width: '100%', height: '100%', backgroundColor: `hsl(${(parseInt(b.addr.slice(2, 8), 16) % 360)},50%,35%)` }} />
                              )}
                            </div>
                          ))}
                        </div>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#a1a1aa', marginLeft: '4px' }}>{g.bidders.length}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* ── HOLDERS TAB ── */}
        {tab === 'Holders' && (
          <div className="flex flex-col gap-6">
            {/* Summary */}
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
              {[
                { label: 'Total Supply', value: liveStats?.total_supply != null ? liveStats.total_supply.toLocaleString() : col.totalSupply },
                { label: 'Unique Owners', value: liveStats?.num_owners != null ? liveStats.num_owners.toLocaleString() : col.owners },
                { label: 'Market Cap', value: liveStats?.market_cap_eth != null ? `${liveStats.market_cap_eth.toFixed(0)} ETH` : col.marketCap },
                { label: 'Creator Royalty', value: col.royalty },
              ].map(s => (
                <div key={s.label} className="border border-[#1a1a1a] bg-[#111111] px-4 py-3">
                  <div className="text-[9px] text-[#6e6e6e] uppercase tracking-wider mb-1">{s.label}</div>
                  <div className="text-[16px] font-bold text-white">{s.value}</div>
                </div>
              ))}
            </div>

            {/* Holders table */}
            <div>
              <p className="text-[9px] font-bold text-[#6e6e6e] uppercase tracking-widest mb-3">Top Holders</p>
              <div className="border border-[#1a1a1a] overflow-hidden">
                <div className="grid px-4 py-2 border-b border-[#1a1a1a]"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '40px 2fr 80px 80px' }}>
                  {['#', 'Wallet', 'Held', '% Supply'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e6e6e] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {holdersLoading && (
                  <div className="px-4 py-6 text-[11px] text-[#6e6e6e]">Loading holders…</div>
                )}
                {!holdersLoading && !contractParam && (
                  <div className="px-4 py-6 text-[11px] text-[#6e6e6e]">Contract address not available.</div>
                )}
                {!holdersLoading && liveHolders !== null && liveHolders.length === 0 && (
                  <div className="px-4 py-6 text-[11px] text-[#6e6e6e]">No holders data.</div>
                )}
                {!holdersLoading && (liveHolders ?? []).map((h, i) => {
                  const totalSupply = liveStats?.total_supply ?? 0;
                  const pct = totalSupply > 0 ? ((h.token_count / totalSupply) * 100).toFixed(2) + '%' : '—';
                  const shortAddr = `${h.owner_address.slice(0, 6)}…${h.owner_address.slice(-4)}`;
                  return (
                    <div key={h.owner_address}
                      className="grid items-center px-4 py-3 border-b border-[#1a1a1a] last:border-0 transition-colors cursor-pointer"
                      style={{ gridTemplateColumns: '40px 2fr 80px 80px' }}
                      onMouseEnter={hoverOn} onMouseLeave={hoverOff}
                      onClick={() => router.push(`/monitor/wallet?address=${h.owner_address}`)}
                    >
                      <span className="text-[10px] text-[#6e6e6e] font-mono">{i + 1}</span>
                      <div className="text-[11px] text-white font-mono">{shortAddr}</div>
                      <span className="text-[11px] text-white font-bold">{h.token_count}</span>
                      <span className="text-[10px] text-[#6e6e6e]">{pct}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── ITEMS TAB ── */}
        {tab === 'Items' && (
          <div style={{ display: 'flex', gap: '0', alignItems: 'flex-start' }}>

            {/* ── Filter Sidebar ── */}
            <div style={{ width: '220px', flexShrink: 0, borderRight: '1px solid var(--wr-border)', paddingRight: '20px', marginRight: '24px', minHeight: '60vh' }}>

              {/* Status */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  Status
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {([['all', 'All'], ['listed', 'Listed'], ['unlisted', 'Not Listed'], ['owned', 'Owned by you']] as [FilterStatus, string][]).map(([val, label]) => (
                    <button key={val} onClick={() => setFilterStatus(val)}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: filterStatus === val ? 700 : 400, color: filterStatus === val ? 'var(--wr-text)' : 'var(--wr-text-3)', backgroundColor: filterStatus === val ? 'var(--wr-surface-alt)' : 'transparent', border: `1px solid ${filterStatus === val ? 'var(--wr-border-hover)' : 'var(--wr-border)'}`, padding: '5px 12px', cursor: 'pointer', borderRadius: '6px' }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--wr-border)', marginBottom: '4px' }} />

              {/* Rarity */}
              <div style={{ borderBottom: '1px solid var(--wr-border)' }}>
                <button onClick={() => toggleFilterSection('Rarity')}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '13px 0', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', color: 'var(--wr-text-3)' }}>Rarity</span>
                  <span style={{ color: 'var(--wr-text-3)', fontSize: '10px', display: 'inline-block', transform: filterSectionOpen['Rarity'] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                </button>
                {filterSectionOpen['Rarity'] && (
                  <div style={{ paddingBottom: '12px' }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
                      <input type="text" placeholder="Min" value={filterRarityMin} onChange={e => setFilterRarityMin(e.target.value.replace(/[^0-9]/g, ''))}
                        onKeyDown={e => { if (e.key === 'Enter') { setAppliedRarityMin(filterRarityMin); setAppliedRarityMax(filterRarityMax); } }}
                        style={{ width: '72px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 8px', outline: 'none' }} />
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>—</span>
                      <input type="text" placeholder="Max" value={filterRarityMax} onChange={e => setFilterRarityMax(e.target.value.replace(/[^0-9]/g, ''))}
                        onKeyDown={e => { if (e.key === 'Enter') { setAppliedRarityMin(filterRarityMin); setAppliedRarityMax(filterRarityMax); } }}
                        style={{ width: '72px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 8px', outline: 'none' }} />
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>#</span>
                    </div>
                    <button
                      onClick={() => { setAppliedRarityMin(filterRarityMin); setAppliedRarityMax(filterRarityMax); }}
                      style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: 'var(--wr-accent)', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                      Apply
                    </button>
                    {(appliedRarityMin || appliedRarityMax) && (
                      <button
                        onClick={() => { setFilterRarityMin(''); setFilterRarityMax(''); setAppliedRarityMin(''); setAppliedRarityMax(''); }}
                        style={{ width: '100%', marginTop: '4px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '4px 0', cursor: 'pointer' }}>
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Price */}
              <div style={{ borderBottom: '1px solid var(--wr-border)' }}>
                <button onClick={() => toggleFilterSection('Price')}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '13px 0', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', color: 'var(--wr-text-3)' }}>Price</span>
                  <span style={{ color: 'var(--wr-text-3)', fontSize: '10px', display: 'inline-block', transform: filterSectionOpen['Price'] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                </button>
                {filterSectionOpen['Price'] && (
                  <div style={{ paddingBottom: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <input type="text" placeholder="Min" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value.replace(/[^0-9.]/g, ''))}
                      style={{ width: '72px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 8px', outline: 'none' }} />
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>—</span>
                    <input type="text" placeholder="Max" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value.replace(/[^0-9.]/g, ''))}
                      style={{ width: '72px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-1)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 8px', outline: 'none' }} />
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>ETH</span>
                  </div>
                )}
              </div>

              {/* Marketplaces */}
              <div style={{ borderBottom: '1px solid var(--wr-border)' }}>
                <button onClick={() => toggleFilterSection('Marketplaces')}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '13px 0', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', color: 'var(--wr-text-3)' }}>Marketplaces</span>
                  <span style={{ color: 'var(--wr-text-3)', fontSize: '10px', display: 'inline-block', transform: filterSectionOpen['Marketplaces'] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                </button>
                {filterSectionOpen['Marketplaces'] && (
                  <div style={{ paddingBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {['OpenSea', 'Blur'].map(mp => (
                      <label key={mp} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
                        <input type="checkbox" style={{ accentColor: 'var(--wr-accent)', width: 13, height: 13 }} /> {mp}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Traits — collapsible */}
              <div style={{ borderBottom: '1px solid var(--wr-border)' }}>
                <button onClick={() => toggleFilterSection('Traits')}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '13px 0', cursor: 'pointer' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '15px', color: 'var(--wr-text-3)' }}>
                    Traits
                    {Object.values(filterTraitSelected).flat().length > 0 && (
                      <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--wr-accent)', fontWeight: 700 }}>
                        {Object.values(filterTraitSelected).flat().length}
                      </span>
                    )}
                  </span>
                  <span style={{ color: 'var(--wr-text-3)', fontSize: '10px', display: 'inline-block', transform: filterSectionOpen['Traits'] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                </button>
                {filterSectionOpen['Traits'] && (
                  <div>
                    {traitsLoading && (
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', padding: '8px 0' }}>Loading traits…</div>
                    )}
                    {(liveTraits ?? []).map(trait => (
                      <div key={trait.category} style={{ borderTop: '1px solid var(--wr-border)' }}>
                        <button onClick={() => toggleFilterTrait(trait.category)}
                          style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: '10px 0 10px 8px', cursor: 'pointer' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text-3)' }}>{trait.category}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{trait.values.length}</span>
                            <span style={{ color: 'var(--wr-text-3)', fontSize: '9px', display: 'inline-block', transform: filterTraitOpen[trait.category] ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>▼</span>
                          </div>
                        </button>
                        {filterTraitOpen[trait.category] && (
                          <div style={{ paddingBottom: '10px', paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '200px', overflowY: 'auto' }}>
                            {trait.values.map(traitVal => {
                              const sel = (filterTraitSelected[trait.category] ?? []).includes(traitVal.value);
                              return (
                                <label key={traitVal.value} onClick={() => toggleTraitValue(trait.category, traitVal.value)}
                                  style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: sel ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
                                  <div style={{ width: 13, height: 13, border: `1.5px solid ${sel ? 'var(--wr-accent)' : 'var(--wr-border)'}`, backgroundColor: sel ? 'var(--wr-accent)' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {sel && <span style={{ color: '#000', fontSize: '8px', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                  </div>
                                  <span style={{ flex: 1 }}>{traitVal.value}</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flexShrink: 0 }}>{traitVal.count}</span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* ── Right: Toolbar + Grid ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Sort toolbar */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                    {(() => {
                      const listedSuffix = listingsFetchedCount > 0
                        ? `${listingsFetchedCount}${listingsFetchedCount >= LISTINGS_FETCH_LIMIT ? '+' : ''} listed`
                        : '0 listed';
                      const head = filterStatus === 'all'
                        ? listedSuffix
                        : filterStatus.charAt(0).toUpperCase() + filterStatus.slice(1);
                      return head;
                    })()}
                    {Object.values(filterTraitSelected).flat().length > 0 && ` · ${Object.values(filterTraitSelected).flat().length} trait${Object.values(filterTraitSelected).flat().length > 1 ? 's' : ''}`}
                  </span>
                </div>
                {/* Bulk-track toolbar — appears in select mode. */}
                {selectMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                      {selectedTokenIds.size} selected
                    </span>
                    <button
                      disabled={selectedTokenIds.size === 0}
                      onClick={() => {
                        if (!displayNfts) return;
                        const newlyTracked: string[] = [];
                        displayNfts.forEach(asset => {
                          if (!selectedTokenIds.has(asset.identifier)) return;
                          const contract = contractParam || '';
                          if (!contract) return;
                          const entry = addTrackedNft({
                            contract,
                            tokenId: asset.identifier,
                            name: asset.name ?? `${col.symbol} #${asset.identifier}`,
                            collectionSlug: activeSlug,
                            collectionName: col.name ?? activeSlug,
                            imageUrl: asset.display_image_url ?? asset.image_url ?? null,
                            rarity: asset.rarity?.rank ?? null,
                            lastSaleEth: null,
                            floorEth: liveStats?.floor_price_eth ?? null,
                            traitFloorEth: null,
                          });
                          newlyTracked.push(entry.id);
                        });
                        setNotifModalTarget(null);
                        setNotifModalIds(newlyTracked);
                        setNotifModalOpen(true);
                        setSelectMode(false);
                        setSelectedTokenIds(new Set());
                      }}
                      className="btn-cta"
                      style={{
                        fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700,
                        color: '#000', backgroundColor: selectedTokenIds.size > 0 ? '#BEFF00' : '#5a6b00',
                        border: '1px solid', borderColor: selectedTokenIds.size > 0 ? '#BEFF00' : '#5a6b00',
                        padding: '5px 14px', cursor: selectedTokenIds.size > 0 ? 'pointer' : 'not-allowed',
                      }}
                    >
                      + Track {selectedTokenIds.size > 0 ? `(${selectedTokenIds.size})` : ''}
                    </button>
                    <button
                      onClick={() => { setSelectMode(false); setSelectedTokenIds(new Set()); }}
                      style={{
                        fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                        color: 'var(--wr-text-3)', backgroundColor: 'transparent',
                        border: '1px solid var(--wr-border)', padding: '5px 12px', cursor: 'pointer',
                      }}
                    >Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => setSelectMode(true)}
                    style={{
                      fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                      color: 'var(--wr-text-3)', backgroundColor: 'transparent',
                      border: '1px solid var(--wr-border)', padding: '5px 12px', cursor: 'pointer',
                      marginRight: '8px',
                    }}
                  >Select</button>
                )}
                <div className="relative" ref={sortDropdownRef}>
                  <button
                    onClick={() => setSortDropdownOpen(o => !o)}
                    className="flex items-center gap-1.5 text-[9px] font-semibold px-2.5 py-1 border border-[#1a1a1a] text-[#a1a1aa] hover:border-[#3a3a3a] hover:text-white transition-colors"
                  >
                    <span style={{ fontFamily: 'var(--font-jetbrains)' }}>{sortBy}</span>
                    <svg width="8" height="5" viewBox="0 0 8 5" fill="none"><path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  {sortDropdownOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 py-1 min-w-[160px]" style={{ background: '#111', border: '1px solid #2a2a2a' }}>
                      {SORT_OPTIONS.map(opt => (
                        <button
                          key={opt}
                          onClick={() => { setSortBy(opt); setSortDropdownOpen(false); }}
                          className="w-full text-left px-3 py-1.5 transition-colors hover:bg-[#1a1a1a]"
                          style={{
                            fontFamily: 'var(--font-jetbrains)',
                            fontSize: '9px',
                            color: sortBy === opt ? '#beff00' : '#a1a1aa',
                          }}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            {/* NFT Grid */}
            {nftsLoading && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '40px 0', textAlign: 'center' }}>
                Loading items…
              </div>
            )}
            {!nftsLoading && nftsError && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171', padding: '20px 0' }}>
                {nftsError}
              </div>
            )}
            {!nftsLoading && !nftsError && displayNfts !== null && displayNfts.length === 0 && (
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', padding: '40px 0', textAlign: 'center' }}>
                No items found.
              </div>
            )}
            {!nftsLoading && !nftsError && displayNfts !== null && displayNfts.length > 0 && (
              <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '8px' }}>
                {displayNfts.map(asset => {
                  const nftId = `#${asset.identifier}`;
                  const imgUrl = asset.display_image_url ?? asset.image_url;
                  const price = asset.price_eth != null ? `${asset.price_eth.toFixed(4)} ETH` : '—';
                  const rank = asset.rarity?.rank ?? 0;
                  const mockNftItem = { id: nftId, rank, price, lastSale: '—', owner: '', traits: [] };
                  const assetTrackId = contractParam ? trackedNftId(contractParam, asset.identifier) : '';
                  const isAssetTracked = trackedSet.has(assetTrackId);
                  const isAssetSelected = selectedTokenIds.has(asset.identifier);
                  const cardBorder = isAssetSelected
                    ? '#BEFF00'
                    : isAssetTracked
                      ? '#fbbf24'
                      : 'var(--wr-border)';
                  return (
                    <div
                      key={nftId}
                      onClick={() => {
                        if (!selectMode) return;
                        setSelectedTokenIds(prev => {
                          const next = new Set(prev);
                          if (next.has(asset.identifier)) next.delete(asset.identifier); else next.add(asset.identifier);
                          return next;
                        });
                      }}
                      style={{ backgroundColor: 'var(--wr-surface)', border: `1px solid ${cardBorder}`, cursor: selectMode ? 'pointer' : 'default', overflow: 'hidden', position: 'relative' }}
                      onMouseEnter={e => { if (!isAssetSelected && !isAssetTracked) (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--wr-border-hover)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = cardBorder; }}
                    >
                      {/* NFT image */}
                      <div style={{ aspectRatio: '1', backgroundColor: `${col.color}22`, position: 'relative', overflow: 'hidden' }}>
                        {imgUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imgUrl} alt={nftId} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 700, color: col.color, opacity: 0.6 }}>{nftId}</div>
                          </div>
                        )}

                        {/* Favorite star — toggles tracking. In select mode a checkbox
                            overlay shows instead so the whole card acts as a bulk target. */}
                        {selectMode ? (
                          <div style={{
                            position: 'absolute', top: '6px', left: '6px',
                            width: '18px', height: '18px', border: '1.5px solid',
                            borderColor: isAssetSelected ? '#BEFF00' : 'rgba(255,255,255,0.7)',
                            backgroundColor: isAssetSelected ? '#BEFF00' : 'rgba(0,0,0,0.55)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isAssetSelected && (
                              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 5.5l2.2 2.2L9 2.5" stroke="#000" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (!contractParam) return;
                              const id = trackedNftId(contractParam, asset.identifier);
                              if (isTracked(contractParam, asset.identifier)) {
                                removeTrackedNft(contractParam, asset.identifier);
                              } else {
                                const entry = addTrackedNft({
                                  contract: contractParam,
                                  tokenId: asset.identifier,
                                  name: asset.name ?? `${col.symbol} ${nftId}`,
                                  collectionSlug: activeSlug,
                                  collectionName: col.name ?? activeSlug,
                                  imageUrl: imgUrl ?? null,
                                  rarity: rank > 0 ? rank : null,
                                  lastSaleEth: null,
                                  floorEth: liveStats?.floor_price_eth ?? null,
                                  traitFloorEth: null,
                                });
                                setNotifModalTarget(entry);
                                setNotifModalIds(undefined);
                                setNotifModalOpen(true);
                              }
                              // Force local state update; subscribe listener will also fire
                              setTrackedSet(prev => {
                                const next = new Set(prev);
                                if (next.has(id)) next.delete(id); else next.add(id);
                                return next;
                              });
                            }}
                            aria-label={isAssetTracked ? 'Untrack' : 'Track NFT'}
                            title={isAssetTracked ? 'Tracked — click to remove' : 'Track NFT'}
                            style={{
                              position: 'absolute', top: '6px', left: '6px',
                              width: '24px', height: '24px', padding: 0,
                              backgroundColor: 'rgba(0,0,0,0.55)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer',
                              color: isAssetTracked ? '#fbbf24' : 'rgba(255,255,255,0.75)',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill={isAssetTracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round">
                              <path d="M6 1.2l1.5 3 3.3.5-2.4 2.3.6 3.3L6 8.8 3 10.3l.6-3.3L1.2 4.7l3.3-.5z" />
                            </svg>
                          </button>
                        )}
                        {/* Edit-notifications bell — only when tracked and not in select mode */}
                        {!selectMode && isAssetTracked && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const rec = loadTrackedNfts().find(n => n.id === assetTrackId);
                              if (!rec) return;
                              setNotifModalTarget(rec);
                              setNotifModalIds(undefined);
                              setNotifModalOpen(true);
                            }}
                            aria-label="Notification rules"
                            title="Notification rules"
                            style={{
                              position: 'absolute', top: '6px', left: '36px',
                              width: '24px', height: '24px', padding: 0,
                              backgroundColor: 'rgba(0,0,0,0.55)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', color: '#fbbf24',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 4.7a3 3 0 016 0V7.5l.8 1.3H2.2L3 7.5z" />
                              <path d="M4.7 10h2.6" />
                            </svg>
                          </button>
                        )}

                        {rank > 0 && (
                          <div style={{ position: 'absolute', top: '6px', right: '6px', backgroundColor: 'rgba(0,0,0,0.7)', padding: '2px 6px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#a1a1aa' }}>
                            #{rank}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ padding: '10px 12px 8px' }}>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>
                          {asset.name ?? `${col.symbol} ${nftId}`}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', marginBottom: '2px' }}>
                              {asset.price_eth != null ? 'PRICE' : 'FLOOR'}
                            </div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{price}</div>
                          </div>
                          {rank > 0 && (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', marginBottom: '2px' }}>RANK</div>
                              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: '#a78bfa' }}>#{rank}</div>
                            </div>
                          )}
                        </div>
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
                          <button
                            onClick={e => { e.stopPropagation(); setBuyWallet(''); setBuyStep('confirm'); setBuyNft(mockNftItem); }}
                            className="btn-cta"
                            style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: '#000', backgroundColor: '#beff00', border: 'none', padding: '6px 0', cursor: 'pointer' }}>
                            Buy
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setOfferConfigs({}); setOfferStep('form'); setOfferNft(mockNftItem); }}
                            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.4)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none'; }}
                            style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-info)', backgroundColor: 'var(--wr-info-bg)', border: '1px solid var(--wr-info)', padding: '6px 0', cursor: 'pointer', transition: 'filter 0.12s ease' }}>
                            Offer
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {nftsCursor && (
                <div style={{ textAlign: 'center', marginTop: '20px' }}>
                  <button
                    onClick={() => {
                      if (!nftsCursor || !activeSlug) return;
                      setNftsLoading(true);
                      openSeaApi.fetchNFTsByCollection(activeSlug, {
                        status: filterStatus,
                        walletAddress: wallets[0]?.address,
                        sort: sortBy,
                        cursor: nftsCursor,
                      })
                        .then(page => { setLiveNfts(prev => [...(prev ?? []), ...page.items]); setNftsCursor(page.next); })
                        .catch(() => {})
                        .finally(() => setNftsLoading(false));
                    }}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 24px', cursor: 'pointer' }}>
                    Load more
                  </button>
                </div>
              )}
              </>
            )}
            </div>
          </div>
        )}

        {/* Traits tab removed — traits moved to Items sidebar */}
        {false && (
          <div style={{ display: 'flex', gap: 0, minHeight: '500px' }}>
            <div style={{ width: '200px', flexShrink: 0, borderRight: '1px solid #1a1a1a', overflowY: 'auto', maxHeight: '700px' }}>
              <div style={{ padding: '10px 16px 6px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em' }}>TRAITS</div>
              {traitsLoading && (
                <div style={{ padding: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#6e6e6e' }}>Loading…</div>
              )}
              {(liveTraits ?? []).map(trait => {
                const catActive = selectedTraitCategory === trait.category;
                return (
                  <div key={trait.category}
                    onClick={() => setSelectedTraitCategory(catActive ? null : trait.category)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '8px 16px', cursor: 'pointer',
                      backgroundColor: catActive ? '#111' : 'transparent',
                      borderLeft: catActive ? '2px solid #beff00' : '2px solid transparent',
                    }}
                    onMouseEnter={e => { if (!catActive) (e.currentTarget as HTMLElement).style.backgroundColor = '#0d0d0d'; }}
                    onMouseLeave={e => { if (!catActive) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                  >
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: catActive ? '#e4e4e7' : '#a1a1aa' }}>{trait.category}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e' }}>{trait.values.length}</span>
                  </div>
                );
              })}
            </div>

            {/* Right main panel */}
            <div style={{ flex: 1, paddingLeft: '16px', minWidth: 0 }}>
              {/* Search bar + trait count */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #1a1a1a', backgroundColor: '#0d0d0d', padding: '7px 12px' }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <circle cx="6.5" cy="6.5" r="5" stroke="#6e6e6e" strokeWidth="1.5"/>
                    <path d="M10.5 10.5L14 14" stroke="#6e6e6e" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  <input
                    value={traitSearch}
                    onChange={e => setTraitSearch(e.target.value)}
                    placeholder="Search by item or trait"
                    style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#e4e4e7' }}
                  />
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#6e6e6e', whiteSpace: 'nowrap', letterSpacing: '0.06em' }}>
                  {(liveTraits ?? []).reduce((sum, t) => sum + t.values.length, 0)} TRAITS
                </span>
              </div>

              {traitsLoading && (
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e', padding: '40px 0', textAlign: 'center' }}>Loading traits…</div>
              )}
              {!traitsLoading && (liveTraits ?? []).length === 0 && (
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#6e6e6e', padding: '40px 0', textAlign: 'center' }}>No traits data available.</div>
              )}

              {!traitsLoading && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                  {(liveTraits ?? [])
                    .filter(t => !selectedTraitCategory || t.category === selectedTraitCategory)
                    .flatMap(trait =>
                      trait.values
                        .filter(v => !traitSearch || v.value.toLowerCase().includes(traitSearch.toLowerCase()) || trait.category.toLowerCase().includes(traitSearch.toLowerCase()))
                        .map((v: TraitValue, vi) => {
                          // Use liveNfts images as visual placeholders (cycle by index)
                          const allNfts = liveNfts ?? [];
                          const imgSlots = 4;
                          const startIdx = vi % Math.max(allNfts.length, 1);
                          const overflow = Math.max(0, v.count - imgSlots);

                          return (
                            <div key={`${trait.category}-${v.value}`} style={{ border: '1px solid #1a1a1a', backgroundColor: '#0d0d0d', overflow: 'hidden', cursor: 'pointer' }}>
                              {/* NFT image grid */}
                              <div style={{ position: 'relative' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                                  {Array.from({ length: 4 }).map((_, si) => {
                                    const nft = allNfts[(startIdx + si) % Math.max(allNfts.length, 1)];
                                    const imgSrc = nft?.image_url ?? nft?.display_image_url ?? null;
                                    return (
                                      <div key={si} style={{ aspectRatio: '1', backgroundColor: '#111', overflow: 'hidden' }}>
                                        {imgSrc ? (
                                          <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                        ) : (
                                          <div style={{ width: '100%', height: '100%', backgroundColor: '#161616', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                                              <rect x="3" y="3" width="18" height="18" rx="2" stroke="#2a2a2a" strokeWidth="1.5"/>
                                              <circle cx="8.5" cy="8.5" r="1.5" stroke="#2a2a2a" strokeWidth="1.2"/>
                                              <path d="M3 16l5-5 4 4 3-3 6 6" stroke="#2a2a2a" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                                            </svg>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                                {/* Overflow badge */}
                                {overflow > 0 && (
                                  <div style={{ position: 'absolute', bottom: '4px', right: '4px', backgroundColor: 'rgba(0,0,0,0.75)', border: '1px solid #2a2a2a', padding: '2px 6px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#e4e4e7', fontWeight: 700 }}>
                                    +{overflow > 999 ? `${(overflow / 1000).toFixed(1)}k` : overflow}
                                  </div>
                                )}
                              </div>
                              {/* Info rows */}
                              <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#6e6e6e', letterSpacing: '0.06em', textTransform: 'uppercase' }}>TYPE</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#e4e4e7' }}>{v.value}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '3px' }}>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#6e6e6e', letterSpacing: '0.06em' }}>COUNT</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#a1a1aa' }}>{v.count.toLocaleString()}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#6e6e6e', letterSpacing: '0.06em' }}>SUPPLY</span>
                                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#34d399' }}>{v.supply_percent.toFixed(1)}%</span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                    )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MAKE COLLECTION BID TAB ── */}
        {tab === 'Make Collection Bid' && (() => {
          const topOfferEth = liveOffers != null && liveOffers.length > 0 ? Math.max(...liveOffers.map(o => o.price_eth)) : null;
          const floorEth = liveStats?.floor_price_eth ?? null;
          const bidVal = parseFloat(colBidAmount);
          const totalVal = !isNaN(bidVal) && bidVal > 0 ? bidVal * colBidQty : 0;
          const floorDiff = floorEth && !isNaN(bidVal) && bidVal > 0 ? ((bidVal - floorEth) / floorEth * 100) : null;
          const EXPIRY_OPTIONS = ['1 hour', '6 hours', '12 hours', '1 day', '3 days', '7 days', '1 month'];
          const imgUrl = searchParams.get('image') ?? '';

          if (colBidStep === 'processing') return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)' }}>Signing & broadcasting…</div>
            </div>
          );

          if (colBidStep === 'done') return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: '16px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '24px', color: 'var(--wr-success)', fontWeight: 700 }}>✓</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-success)' }}>Collection offer submitted</div>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-2)' }}>
                {totalVal.toFixed(4)} WETH · {colBidExpiry}
                {colBidTraits.length > 0 && ` · ${colBidTraits.map(t => `${t.category}: ${t.value}`).join(', ')}`}
              </div>
              <button onClick={() => { setColBidStep('form'); setColBidAmount(''); setColBidQty(1); setColBidTraits([]); }}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 24px', cursor: 'pointer', marginTop: '8px' }}>
                Place Another
              </button>
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '20px', fontWeight: 700, color: 'var(--wr-text)' }}>
                  Create collection offer
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', letterSpacing: '0.08em' }}>SET PRICE TO</span>
                  <button
                    onClick={() => topOfferEth != null && setColBidAmount(topOfferEth.toFixed(4))}
                    disabled={topOfferEth == null}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: topOfferEth ? 'var(--wr-text)' : 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 16px', cursor: topOfferEth ? 'pointer' : 'default' }}>
                    Top offer{topOfferEth != null ? ` (${topOfferEth.toFixed(3)} WETH)` : ''}
                  </button>
                </div>
              </div>

              {/* Wallet selector */}
              {wallets.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '0.1em', color: 'var(--wr-text-3)', marginBottom: '8px', textTransform: 'uppercase' }}>Offering Wallet</div>
                  <div ref={colBidWalletDropRef} style={{ position: 'relative', maxWidth: '360px' }}>
                    <button
                      onClick={() => setColBidWalletDropOpen(o => !o)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: `1px solid ${colBidWalletDropOpen ? 'var(--wr-accent)' : 'var(--wr-border)'}`, padding: '10px 14px', cursor: 'pointer', outline: 'none' }}>
                      {(() => {
                        const w = wallets.find(x => x.address === colBidWallet) ?? wallets[0];
                        const bal = colBidWalletBalances[w.address];
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{w.name}</span>
                            <span style={{ color: 'var(--wr-text-3)', fontSize: '10px', whiteSpace: 'nowrap' }}>{w.address.slice(0,6)}…{w.address.slice(-4)}</span>
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center', whiteSpace: 'nowrap' }}>
                              {bal?.eth != null && <span style={{ color: 'var(--wr-text-2)', fontSize: '11px' }}>{bal.eth.toFixed(4)} ETH</span>}
                              {bal?.weth != null && <span style={{ color: 'var(--wr-text-3)', fontSize: '11px' }}>{bal.weth.toFixed(4)} WETH</span>}
                            </div>
                          </div>
                        );
                      })()}
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: colBidWalletDropOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0, marginLeft: '10px' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                    {colBidWalletDropOpen && (
                      <div style={{ position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 50, backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border)', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
                        {wallets.map(w => {
                          const bal = colBidWalletBalances[w.address];
                          const selected = (colBidWallet || wallets[0].address) === w.address;
                          return (
                            <div key={w.id} onClick={() => { setColBidWallet(w.address); setColBidWalletDropOpen(false); }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', cursor: 'pointer', backgroundColor: selected ? 'var(--wr-accent-dim)' : 'transparent', borderBottom: '1px solid var(--wr-border)' }}
                              onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = selected ? 'var(--wr-accent-dim)' : 'transparent'; }}>
                              <div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: selected ? 'var(--wr-accent)' : 'var(--wr-text)' }}>{w.name}</div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{w.address.slice(0,8)}…{w.address.slice(-6)}</div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: bal?.eth != null ? 'var(--wr-text)' : 'var(--wr-text-3)' }}>
                                  {bal?.eth != null ? `${bal.eth.toFixed(4)} ETH` : '—'}
                                </div>
                                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>
                                  {bal?.weth != null ? `${bal.weth.toFixed(4)} WETH` : '—'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Table header */}
              <div style={{ display: 'grid', gridTemplateColumns: colBidTraits.length > 0 ? '2fr 1fr 1fr 1fr 1fr 1fr' : '2fr 1fr 1fr 1fr 1fr', gap: '0', padding: '0 0 8px', borderBottom: '1px solid var(--wr-border)' }}>
                {(colBidTraits.length > 0
                  ? ['COLLECTION', 'FLOOR', 'TRAIT FLOOR', 'TOP TRAIT OFFER', 'OFFERED AT', 'OFFER TOTAL']
                  : ['COLLECTION', 'FLOOR', 'TOP OFFER', 'OFFERED AT', 'OFFER TOTAL']
                ).map(h => (
                  <div key={h} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: 'var(--wr-text-3)', letterSpacing: '0.1em' }}>{h}</div>
                ))}
              </div>

              {/* Collection row */}
              <div style={{ display: 'grid', gridTemplateColumns: colBidTraits.length > 0 ? '2fr 1fr 1fr 1fr 1fr 1fr' : '2fr 1fr 1fr 1fr 1fr', gap: '0', padding: '16px 0', borderBottom: '1px solid var(--wr-border)', alignItems: 'center' }}>
                {/* Collection */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {imgUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imgUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <div style={{ width: 32, height: 32, backgroundColor: col.color + '44', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: col.color }}>{col.symbol[0]}</span>
                    </div>
                  )}
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{col.name || activeSlug}</span>
                  {/* Quantity stepper */}
                  <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', marginLeft: '8px' }}>
                    <button onClick={() => setColBidQty(q => Math.max(1, q - 1))}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', padding: '4px 10px', cursor: 'pointer', lineHeight: 1 }}>−</button>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', minWidth: '24px', textAlign: 'center' }}>{colBidQty}</span>
                    <button onClick={() => setColBidQty(q => q + 1)}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', padding: '4px 10px', cursor: 'pointer', lineHeight: 1 }}>+</button>
                  </div>
                </div>
                {/* Floor */}
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>
                  {floorEth != null ? `${floorEth.toFixed(4)} ETH` : '—'}
                </div>
                {/* Trait Floor — only when a trait is selected */}
                {colBidTraits.length > 0 && (
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text-3)' }}>—</div>
                )}
                {/* Top offer / Top trait offer */}
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>
                  {topOfferEth != null ? `${topOfferEth.toFixed(3)} WETH` : '—'}
                </div>
                {/* Offer total — editable */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="text" placeholder="0.00" value={colBidAmount}
                    onChange={e => setColBidAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ width: '90px', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 10px', outline: 'none' }}
                  />
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>WETH</span>
                </div>
                {/* Offer total = offered at × quantity */}
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>{((parseFloat(colBidAmount) || 0) * colBidQty).toFixed(4)}</span>
                  <span style={{ fontSize: '12px', fontWeight: 400, color: 'var(--wr-text-3)' }}>WETH</span>
                </div>
              </div>

              {/* Trait section */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '18px 0', borderBottom: '1px solid var(--wr-border)' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, color: 'var(--wr-text)', marginBottom: colBidTraits.length > 0 ? '12px' : 0 }}>Trait</div>
                  {colBidTraits.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {colBidTraits.map((t, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '4px 10px' }}>
                          <span style={{ color: 'var(--wr-text-3)' }}>{t.category}:</span> {t.value}
                          <button onClick={() => setColBidTraits(prev => prev.filter((_, j) => j !== i))}
                            style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '12px', padding: '0 0 0 4px', lineHeight: 1 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* + Add trait picker */}
                <div ref={colBidTraitPickerRef}>
                  <button
                    ref={colBidTraitBtnRef}
                    onClick={() => {
                      if (!colBidTraitPickerOpen && colBidTraitBtnRef.current) {
                        const r = colBidTraitBtnRef.current.getBoundingClientRect();
                        const dropH = 450;
                        const spaceBelow = window.innerHeight - r.bottom - 20;
                        const top = spaceBelow < dropH ? r.top - dropH - 4 : r.bottom + 4;
                        setColBidTraitDropPos({ top, right: window.innerWidth - r.right });
                      }
                      setColBidTraitPickerOpen(o => !o);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer' }}>
                    <span style={{ fontSize: '16px', lineHeight: 1, marginTop: '-1px' }}>+</span> Add
                  </button>
                </div>
                {colBidTraitPickerOpen && colBidTraitDropPos && (liveTraits ?? []).length > 0 && (
                  <div ref={colBidTraitDropRef} style={{ position: 'fixed', top: colBidTraitDropPos.top, right: colBidTraitDropPos.right, zIndex: 9999, background: 'var(--wr-surface)', border: '1px solid var(--wr-border)', width: '300px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
                    {/* Search */}
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--wr-border)' }}>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Search traits…"
                        value={colBidTraitSearch}
                        onChange={e => setColBidTraitSearch(e.target.value)}
                        style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '6px 10px', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    {/* Categories + values — concrete maxHeight so overflow:scroll works */}
                    <div style={{ maxHeight: '400px', overflowY: 'scroll' }}>
                      {(liveTraits ?? []).map(trait => {
                        const q = colBidTraitSearch.toLowerCase();
                        const filteredVals = trait.values.filter(tv =>
                          !q || trait.category.toLowerCase().includes(q) || tv.value.toLowerCase().includes(q)
                        );
                        if (filteredVals.length === 0) return null;
                        return (
                          <div key={trait.category}>
                            {/* Category header */}
                            <div style={{ padding: '6px 14px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface-alt)', borderBottom: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span>{trait.category}</span>
                              <span>{filteredVals.length}</span>
                            </div>
                            {/* Values */}
                            {filteredVals.map(tv => {
                              const isSelected = colBidTraits.some(t => t.category === trait.category && t.value === tv.value);
                              return (
                                <button key={tv.value}
                                  onClick={() => {
                                    setColBidTraits(prev =>
                                      isSelected
                                        ? prev.filter(t => !(t.category === trait.category && t.value === tv.value))
                                        : [...prev, { category: trait.category, value: tv.value }]
                                    );
                                  }}
                                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isSelected ? 'var(--wr-accent-dim)' : 'transparent'; }}
                                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px 8px 22px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: isSelected ? 'var(--wr-accent)' : 'var(--wr-text)', backgroundColor: isSelected ? 'var(--wr-accent-dim)' : 'transparent', border: 'none', borderBottom: '1px solid var(--wr-border)', cursor: 'pointer', textAlign: 'left', boxSizing: 'border-box' }}>
                                  <span style={{ flex: 1 }}>{tv.value}</span>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                    <span style={{ color: 'var(--wr-text-3)', fontSize: '10px' }}>{tv.count}</span>
                                    {isSelected && <span style={{ color: 'var(--wr-accent)', fontSize: '10px', fontWeight: 700 }}>✓</span>}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Total offer value */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--wr-border)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, color: 'var(--wr-text)' }}>Total offer value</span>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, color: 'var(--wr-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--wr-text-3)', fontSize: '12px' }}>($0.00)</span>
                  <span>{totalVal > 0 ? totalVal.toFixed(4) : '0.00'} WETH</span>
                </div>
              </div>

              {/* Floor difference */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--wr-border)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: 'var(--wr-text-3)' }}>Floor difference</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', color: floorDiff != null ? (floorDiff >= 0 ? '#34d399' : '#f87171') : 'var(--wr-text-3)' }}>
                  {floorDiff != null ? `${floorDiff >= 0 ? '+' : ''}${floorDiff.toFixed(1)}%` : '—'}
                </span>
              </div>

              {/* Spacer + Bottom action bar */}
              <div style={{ flex: 1 }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', paddingTop: '28px', marginTop: '20px', borderTop: '1px solid var(--wr-border)' }}>
                {/* Expiry dropdown */}
                <div ref={colBidExpiryRef}>
                  <button
                    ref={colBidExpiryBtnRef}
                    onClick={() => {
                      if (!colBidExpiryOpen && colBidExpiryBtnRef.current) {
                        const r = colBidExpiryBtnRef.current.getBoundingClientRect();
                        setColBidExpiryDropPos({ bottom: window.innerHeight - r.top + 4, right: window.innerWidth - r.right });
                      }
                      setColBidExpiryOpen(o => !o);
                    }}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: `1px solid ${colBidExpiryOpen ? 'var(--wr-accent)' : 'var(--wr-border)'}`, padding: '10px 16px', cursor: 'pointer', minWidth: '140px', justifyContent: 'space-between' }}>
                    <span>{colBidExpiry}</span>
                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: colBidExpiryOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}><path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </div>
                {colBidExpiryOpen && colBidExpiryDropPos && (
                  <div style={{ position: 'fixed', bottom: colBidExpiryDropPos.bottom, right: colBidExpiryDropPos.right, zIndex: 9999, backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', minWidth: '160px', boxShadow: '0 -4px 16px rgba(0,0,0,0.25)' }}>
                    {EXPIRY_OPTIONS.map(opt => {
                      const isSelected = colBidExpiry === opt;
                      return (
                        <button key={opt} onClick={() => { setColBidExpiry(opt); setColBidExpiryOpen(false); }}
                          onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = isSelected ? 'var(--wr-accent-dim)' : 'transparent'; }}
                          style={{ width: '100%', display: 'block', padding: '9px 16px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: isSelected ? 'var(--wr-accent)' : 'var(--wr-text)', backgroundColor: isSelected ? 'var(--wr-accent-dim)' : 'transparent', border: 'none', borderBottom: '1px solid var(--wr-border)', cursor: 'pointer', textAlign: 'left', fontWeight: isSelected ? 600 : 400 }}>
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Review / Submit button */}
                {colBidStep === 'form' ? (() => {
                  const bidEnabled = !!colBidAmount && parseFloat(colBidAmount) > 0;
                  return (
                  <button
                    onClick={() => setColBidStep('review')}
                    disabled={!bidEnabled}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, letterSpacing: '0.02em', color: bidEnabled ? '#000000' : 'var(--wr-text-4)', backgroundColor: bidEnabled ? '#BEFF00' : 'var(--wr-overlay)', border: `1px solid ${bidEnabled ? '#BEFF00' : 'var(--wr-border)'}`, padding: '11px 32px', cursor: bidEnabled ? 'pointer' : 'not-allowed', transition: 'opacity 0.15s', opacity: bidEnabled ? 1 : 0.5 }}>
                    Review collection offer
                  </button>
                  );
                })() : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
                      {colBidQty}× {colBidAmount} WETH · {colBidExpiry}
                      {colBidTraits.length > 0 && ` · ${colBidTraits.map(t => t.value).join(', ')}`}
                    </div>
                    <button onClick={() => setColBidStep('form')}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '10px 16px', cursor: 'pointer' }}>
                      Edit
                    </button>
                    <button onClick={() => { setColBidStep('processing'); setTimeout(() => setColBidStep('done'), 2400); }}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000', backgroundColor: 'var(--wr-accent)', border: 'none', padding: '10px 28px', cursor: 'pointer' }}>
                      Confirm &amp; Submit
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── ANALYTICS TAB ── */}
        {tab === 'Analytics' && (
          <div className="flex flex-col gap-6">
            {/* Key metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
              {[
                {
                  label: 'FLOOR PRICE',
                  value: liveStats?.floor_price_eth != null ? `${liveStats.floor_price_eth.toFixed(4)} ETH` : col.floor,
                  sub: null,
                },
                {
                  label: '24H VOLUME',
                  value: liveStats?.vol_1d_eth != null ? `${liveStats.vol_1d_eth.toFixed(2)} ETH` : '—',
                  sub: liveStats?.vol_1d_change != null ? `${liveStats.vol_1d_change >= 0 ? '+' : ''}${(liveStats.vol_1d_change * 100).toFixed(1)}%` : null,
                  subColor: liveStats?.vol_1d_change != null ? (liveStats.vol_1d_change >= 0 ? '#34d399' : '#f87171') : undefined,
                },
                {
                  label: '7D VOLUME',
                  value: liveStats?.vol_7d_eth != null ? `${liveStats.vol_7d_eth.toFixed(2)} ETH` : col.vol7d,
                  sub: liveStats?.vol_7d_change != null ? `${liveStats.vol_7d_change >= 0 ? '+' : ''}${(liveStats.vol_7d_change * 100).toFixed(1)}%` : null,
                  subColor: liveStats?.vol_7d_change != null ? (liveStats.vol_7d_change >= 0 ? '#34d399' : '#f87171') : undefined,
                },
                {
                  label: '30D VOLUME',
                  value: liveStats?.vol_30d_eth != null ? `${liveStats.vol_30d_eth.toFixed(2)} ETH` : '—',
                  sub: liveStats?.vol_30d_change != null ? `${liveStats.vol_30d_change >= 0 ? '+' : ''}${(liveStats.vol_30d_change * 100).toFixed(1)}%` : null,
                  subColor: liveStats?.vol_30d_change != null ? (liveStats.vol_30d_change >= 0 ? '#34d399' : '#f87171') : undefined,
                },
                {
                  label: 'AVG PRICE (24H)',
                  value: liveStats?.avg_price_1d_eth != null ? `${liveStats.avg_price_1d_eth.toFixed(4)} ETH` : '—',
                  sub: null,
                },
                {
                  label: 'MARKET CAP',
                  value: liveStats?.market_cap_eth != null ? `${liveStats.market_cap_eth.toFixed(0)} ETH` : col.marketCap,
                  sub: null,
                },
                {
                  label: 'UNIQUE OWNERS',
                  value: liveStats?.num_owners != null ? liveStats.num_owners.toLocaleString() : col.owners,
                  sub: liveStats?.total_supply != null ? `of ${liveStats.total_supply.toLocaleString()} supply` : `of ${col.totalSupply}`,
                },
                {
                  label: 'TOTAL SUPPLY',
                  value: liveStats?.total_supply != null ? liveStats.total_supply.toLocaleString() : col.totalSupply,
                  sub: null,
                },
              ].map(s => (
                <div key={s.label} style={{ border: '1px solid #1a1a1a', backgroundColor: '#0d0d0d', padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em', marginBottom: '8px' }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '18px', fontWeight: 700, color: '#ffffff', marginBottom: '4px' }}>{s.value}</div>
                  {s.sub && <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: (s as {subColor?: string}).subColor ?? '#6e6e6e' }}>{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* Volume bars */}
            <div style={{ border: '1px solid #1a1a1a', backgroundColor: '#0d0d0d', padding: '20px 24px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em', marginBottom: '20px' }}>VOLUME COMPARISON</div>
              {(() => {
                const v1 = liveStats?.vol_1d_eth ?? 0;
                const v7 = liveStats?.vol_7d_eth ?? 0;
                const v30 = liveStats?.vol_30d_eth ?? 0;
                const max = Math.max(v1, v7, v30, 1);
                return (
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '40px' }}>
                    {[
                      { label: '24H', value: v1, color: '#beff00' },
                      { label: '7D',  value: v7, color: '#22d3ee' },
                      { label: '30D', value: v30, color: '#818cf8' },
                    ].map(b => (
                      <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flex: 1 }}>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#e4e4e7' }}>{b.value > 0 ? `${b.value.toFixed(2)} ETH` : '—'}</div>
                        <div style={{ width: '100%', height: '80px', backgroundColor: '#1a1a1a', position: 'relative', display: 'flex', alignItems: 'flex-end' }}>
                          <div style={{ width: '100%', height: `${(b.value / max) * 100}%`, backgroundColor: b.color, minHeight: b.value > 0 ? '4px' : '0', transition: 'height 0.4s ease' }} />
                        </div>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#6e6e6e', fontWeight: 700 }}>{b.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Sales count */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
              {[
                { label: '24H SALES', value: liveStats?.sales_1d != null ? liveStats.sales_1d.toLocaleString() : '—' },
                { label: '7D SALES',  value: liveStats?.sales_7d != null ? liveStats.sales_7d.toLocaleString() : col.sales7d },
                { label: '30D SALES', value: liveStats?.sales_30d != null ? liveStats.sales_30d.toLocaleString() : '—' },
              ].map(s => (
                <div key={s.label} style={{ border: '1px solid #1a1a1a', backgroundColor: '#0d0d0d', padding: '14px 16px' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#6e6e6e', letterSpacing: '0.08em', marginBottom: '8px' }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 700, color: '#ffffff' }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ALERTS TAB ── */}
        {tab === 'Alerts' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <p className="text-[9px] font-bold text-[#6e6e6e] uppercase tracking-widest">Alert Rules — {col.name}</p>
              <button onClick={openAddAlert} className="text-[10px] font-semibold px-3 py-1.5 border transition-colors cursor-pointer"
                style={{ color: '#000000', backgroundColor: '#beff00', borderColor: '#beff00' }}>
                + Add Rule
              </button>
            </div>

            <div className="border border-[#1a1a1a] overflow-hidden">
              {alerts.map(a => (
                <div key={a.id} className="flex items-center gap-4 px-4 py-4 border-b border-[#1a1a1a] last:border-0 transition-colors" onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                  {/* Toggle */}
                  <div
                    role="switch"
                    aria-checked={a.enabled}
                    className="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
                    style={{ backgroundColor: a.enabled ? '#beff00' : 'var(--wr-overlay)' }}
                    onClick={() => toggleAlert(a.id)}
                  >
                    <div className="absolute top-0.5 w-3 h-3 rounded-full bg-black transition-all"
                      style={{ left: a.enabled ? '18px' : '2px' }} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[12px] text-white font-medium">{a.label}</div>
                    <div className="text-[10px] text-[#6e6e6e] mt-0.5">Channel: {a.channel}</div>
                  </div>
                  <button onClick={() => openEditAlert(a)} className="text-[9px] text-[#6e6e6e] hover:text-[#a1a1aa] border border-[#1a1a1a] px-2.5 py-1 transition-colors cursor-pointer">
                    Edit
                  </button>
                  <button onClick={() => deleteAlert(a.id)} className="text-[9px] text-[#f87171] hover:text-[#fca5a5] border border-[#1a1a1a] px-2.5 py-1 transition-colors cursor-pointer">
                    Delete
                  </button>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-[#6e6e6e]">
              Alerts fire when conditions are met for this collection. Notifications go to macOS system notifications and/or a Discord webhook configured in Settings.
            </p>

            {alertEditor && (
              <div
                onClick={closeAlertEditor}
                style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{ background: 'var(--wr-surface)', border: '1px solid var(--wr-border)', width: '420px', boxShadow: '0 8px 32px rgba(0,0,0,0.4)', zIndex: 9999 }}
                >
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--wr-border)' }}>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: 'var(--wr-text)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      {alertEditor.mode === 'add' ? 'New Alert Rule' : 'Edit Alert Rule'}
                    </div>
                  </div>
                  <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: 'var(--wr-text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Condition</label>
                      <input
                        autoFocus
                        type="text"
                        value={alertEditor.label}
                        onChange={e => setAlertEditor(prev => prev ? { ...prev, label: e.target.value } : prev)}
                        onKeyDown={e => { if (e.key === 'Enter') saveAlertEditor(); if (e.key === 'Escape') closeAlertEditor(); }}
                        placeholder="e.g. Floor drops below 10 ETH"
                        style={{ width: '100%', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '8px 10px', outline: 'none', boxSizing: 'border-box' }}
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: 'var(--wr-text-3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Channel</label>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {ALERT_CHANNELS.map(ch => (
                          <button
                            key={ch}
                            onClick={() => setAlertEditor(prev => prev ? { ...prev, channel: ch } : prev)}
                            style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: alertEditor.channel === ch ? '#000' : 'var(--wr-text)', backgroundColor: alertEditor.channel === ch ? '#beff00' : 'transparent', border: '1px solid', borderColor: alertEditor.channel === ch ? '#beff00' : 'var(--wr-border)', padding: '7px 10px', cursor: 'pointer' }}
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--wr-border)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <button onClick={closeAlertEditor} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer' }}>Cancel</button>
                    <button onClick={saveAlertEditor} disabled={!alertEditor.label.trim()} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: alertEditor.label.trim() ? '#beff00' : '#5a6b00', border: '1px solid', borderColor: alertEditor.label.trim() ? '#beff00' : '#5a6b00', padding: '7px 14px', cursor: alertEditor.label.trim() ? 'pointer' : 'not-allowed' }}>{alertEditor.mode === 'add' ? 'Add Rule' : 'Save'}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Tracked NFT notification rules modal (single + bulk) */}
      <TrackedNftNotificationModal
        open={notifModalOpen}
        onClose={() => { setNotifModalOpen(false); setNotifModalTarget(null); setNotifModalIds(undefined); }}
        target={notifModalTarget}
        targetIds={notifModalIds}
      />
    </div>
  );
}

export default function MonitorCollectionPage() {
  return <Suspense fallback={null}><MonitorCollectionInner /></Suspense>;
}
