'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getPortfolioSnapshot, getAssetTransfers, loadAlchemyKey, startStream, stopStream, openExternalUrl, getPnlSummary, fetchCollectionStats, type PortfolioSnapshot, type AssetTransfer, type StreamEvent, type StreamStatus, type PnlSummary, type CollectionStats } from '@/lib/tauri';
import { useTrackedNfts } from '@/hooks/useTrackedNfts';
import { removeTrackedNft, loadTrackedNfts, type TrackedNft } from '@/lib/trackedNftStore';
import { TrackedNftNotificationModal } from '@/components/TrackedNftNotificationModal';
import { loadWatchedWallets, addWallet as addWatchedWallet, removeWallet } from '@/lib/walletStore';
import { loadCollections, saveCollection, removeCollection, type WatchedCollection } from '@/lib/collectionStore';
import { fetchCollectionByContract } from '@/lib/tauri';

import { useTheme } from '@/lib/themeContext';
import ProGate from '@/components/ProGate';

// ─── Watch Address Modal ──────────────────────────────────────────────────────

const TAGS = ['Whale', 'Trader', 'Sniper', 'Dev', 'Team', 'MEV'];

function WatchAddressModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [address, setAddress] = useState('');
  const [label, setLabel] = useState('');
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  const toggleTag = (t: string) => setSelectedTags(s => {
    const n = new Set(s);
    n.has(t) ? n.delete(t) : n.add(t);
    return n;
  });

  const FIELD: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)',
    fontSize: '12px',
    color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface-alt)',
    border: '1px solid var(--wr-border)',
    padding: '10px 12px',
    width: '100%',
    outline: 'none',
  };

  const LABEL_STYLE: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)',
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    color: 'var(--wr-text-3)',
    display: 'block',
    marginBottom: '6px',
  };

  const canSubmit = /^0x[0-9a-fA-F]{40}$/.test(address.trim());

  const handleAdd = () => {
    if (!canSubmit) return;
    addWatchedWallet({
      id: Date.now().toString(),
      name: label.trim() || `${address.slice(0, 6)}…${address.slice(-4)}`,
      address: address.trim(),
      kind: 'watched',
      tags: selectedTags.size > 0 ? Array.from(selectedTags) : undefined,
    });
    onAdded();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{ width: '420px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border-hover)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Watch Address</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
          Add an Ethereum address to monitor its on-chain activity
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Address */}
          <div>
            <label style={LABEL_STYLE}>Wallet Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="0x..."
              className="placeholder-[#232533] focus:border-[#7c5cff] transition-colors"
              style={FIELD}
            />
          </div>

          {/* Label */}
          <div>
            <label style={LABEL_STYLE}>Label <span style={{ color: 'var(--wr-text-4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Whale Watcher, Dev Wallet…"
              className="placeholder-[#232533] focus:border-[#7c5cff] transition-colors"
              style={FIELD}
            />
          </div>

          {/* Tags */}
          <div>
            <label style={LABEL_STYLE}>Tags <span style={{ color: 'var(--wr-text-4)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <div className="flex flex-wrap" style={{ gap: '6px' }}>
              {TAGS.map(t => {
                const active = selectedTags.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    style={{
                      fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                      padding: '4px 10px',
                      color: active ? '#0b0c14' : 'var(--wr-text-3)',
                      backgroundColor: active ? '#7c5cff' : 'var(--wr-surface-alt)',
                      border: `1px solid ${active ? 'var(--wr-accent)' : 'var(--wr-border)'}`,
                      cursor: 'pointer', transition: 'all 0.12s',
                    }}
                  >{t}</button>
                );
              })}
            </div>
          </div>

          {/* Alert hint */}
          <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ color: 'var(--wr-info)', fontSize: '12px', flexShrink: 0 }}>ⓘ</span>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', lineHeight: 1.5 }}>
              Watch-only — no signing or transactions. You&apos;ll receive alerts for all on-chain activity from this address.
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500,
                color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)',
                padding: '11px 0', cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              onClick={handleAdd}
              disabled={!canSubmit}
              style={{
                flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700,
                color: canSubmit ? '#0b0c14' : 'var(--wr-text-3)',
                backgroundColor: canSubmit ? '#7c5cff' : 'var(--wr-surface-alt)',
                border: 'none', padding: '11px 0',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background-color 0.15s',
              }}
            >+ Watch Address</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Monitor — matches jgkJr / 3rtBl design ──────────────────────────────────

type ActivityTag = 'High Frequency' | 'Frequent Trader' | 'Active' | 'Low Activity' | 'Dormant';

const ACTIVITY_TAG_STYLE: Record<ActivityTag, { color: string; bg: string; border: string }> = {
  'High Frequency': { color: '#f472b6', bg: '#1a0010', border: '#831843' },
  'Frequent Trader': { color: '#4fe9b4', bg: '#06251b', border: '#06251b' },
  'Active':          { color: '#90a6ff', bg: '#0c1a2e', border: '#1d4ed8' },
  'Low Activity':    { color: '#ffb020', bg: '#1c1000', border: '#92400e' },
  'Dormant':         { color: '#6e7590', bg: '#14161f', border: '#232533' },
};

// Tag thresholds — edit here to change classification rules
const ACTIVITY_THRESHOLDS = {
  highFrequency:  50,  // txns/month — 50+
  frequentTrader: 30,  // txns/month — 30–49
  active:          5,  // txns/month — 5–29
  lowActivity:     1,  // txns/month — 1–4
  dormantMonths:   3,  // months of inactivity → Dormant
};

const AUTO_TAG_THRESHOLDS = {
  whaleUsd:        500_000,  // total holdings in USD
  nftCollectorMin: 200,      // NFT count
  traderVolumeUsd: 50_000,   // monthly trade volume in USD (requires volume data)
};

function classifyActivityTag(txsPerMonth: number, monthsInactive: number): ActivityTag {
  if (monthsInactive >= ACTIVITY_THRESHOLDS.dormantMonths) return 'Dormant';
  if (txsPerMonth >= ACTIVITY_THRESHOLDS.highFrequency)    return 'High Frequency';
  if (txsPerMonth >= ACTIVITY_THRESHOLDS.frequentTrader)   return 'Frequent Trader';
  if (txsPerMonth >= ACTIVITY_THRESHOLDS.active)           return 'Active';
  if (txsPerMonth >= ACTIVITY_THRESHOLDS.lowActivity)      return 'Low Activity';
  return 'Dormant';
}

function computeAutoTags(portfolioUsd: number, nftCount: number): string[] {
  const tags: string[] = [];
  // Whale and Trader are mutually exclusive — Whale takes priority
  if (portfolioUsd >= AUTO_TAG_THRESHOLDS.whaleUsd) {
    tags.push('Whale');
  } else if (portfolioUsd >= AUTO_TAG_THRESHOLDS.traderVolumeUsd) {
    tags.push('Trader');
  }
  // NFT Collector stacks with any other tag
  if (nftCount >= AUTO_TAG_THRESHOLDS.nftCollectorMin) tags.push('NFT Collector');
  return tags;
}

interface MonitorWallet {
  address: string;
  rawAddress: string;
  label: string;
  activityTag: ActivityTag;
  autoTags: string[];
  highlighted: boolean;
  txnsMonth: string;
  txLast: string;
  holdings: string;
  holdingsUsd: string;
  pnl30d: string;
  pnlUp: boolean;
  connections: string;
}

// ─── Watch Collection Modal ───────────────────────────────────────────────────
function WatchCollectionModal({ onClose, onAdd }: { onClose: () => void; onAdd: (col: WatchedCollection) => void }) {
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const FIELD: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    border: '1px solid var(--wr-border)', padding: '10px 12px', width: '100%', outline: 'none',
  };

  const canSubmit = /^0x[0-9a-fA-F]{40}$/.test(address.trim()) && status !== 'loading';

  const handle = async () => {
    if (!canSubmit) return;
    const addr = address.trim();
    setStatus('loading');
    setError('');
    try {
      const info = await fetchCollectionByContract(addr);
      const existing = loadCollections();
      if (existing.find(c => c.slug === info.slug)) {
        setError('Already in watchlist');
        setStatus('error');
        return;
      }
      const col = saveCollection(info);
      onAdd(col);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[300]"
      style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: '420px', backgroundColor: 'var(--wr-modal)', border: '1px solid var(--wr-border-hover)', padding: '28px' }}
        onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
          <h2 style={{ fontFamily: 'var(--font-inter)', fontSize: '18px', fontWeight: 600, color: 'var(--wr-text)' }}>Watch Collection</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--wr-text-3)', fontSize: '18px', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
          Contract adresini gir — koleksiyon bilgileri OpenSea API&apos;den otomatik çekilir
        </p>

        <div>
          <label style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', display: 'block', marginBottom: '6px' }}>
            Contract Address
          </label>
          <input
            value={address}
            onChange={e => { setAddress(e.target.value); setStatus('idle'); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handle(); }}
            placeholder="0x..."
            style={FIELD}
            autoFocus
          />
          {error && (
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-danger)', marginTop: '8px' }}>{error}</p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
          <button onClick={onClose} disabled={status === 'loading'}
            style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '11px 0', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handle} disabled={!canSubmit}
            style={{ flex: 2, fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: '#000', backgroundColor: canSubmit ? '#7c5cff' : '#7c5cff40', border: 'none', padding: '11px 0', cursor: canSubmit ? 'pointer' : 'not-allowed', letterSpacing: '0.5px' }}>
            {status === 'loading' ? 'Fetching…' : 'Add to Watchlist'}
          </button>
        </div>
      </div>
    </div>
  );
}

type SortCol = 'name' | 'floor' | 'change' | 'vol24h' | 'vol7d' | 'sales7d';
type SortDir = 'asc' | 'desc';

function parseEth(s: string): number {
  return parseFloat(s.replace(/,/g, '').replace(/[^0-9.]/g, '')) || 0;
}

const DEFAULT_REL_RULES = [
  { id: 'sends',        label: 'Wallet sends funds',              threshold: 5, unit: 'times', enabled: true },
  { id: 'receives',     label: 'Wallet receives funds',           threshold: 3, unit: 'times', enabled: true },
  { id: 'nft_transfer', label: 'NFT transferred to/from wallet',  threshold: 3, unit: 'times', enabled: true },
];


export default function MonitorPage() {
  const { theme } = useTheme();
  const isDay = theme === 'day';
  const router = useRouter();
  const [sortCol, setSortCol] = useState<SortCol>('floor');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [showRelSettings, setShowRelSettings] = useState(false);
  const [relRules, setRelRules] = useState(DEFAULT_REL_RULES);
  const [showWatchModal, setShowWatchModal] = useState(false);
  const [showWatchColModal, setShowWatchColModal] = useState(false);
  const [collections, setCollections] = useState<WatchedCollection[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [collectionStats, setCollectionStats] = useState<Record<string, CollectionStats>>({});
  const relSettingsRef = useRef<HTMLDivElement>(null);

  // ── Tracked NFTs state ───────────────────────────────────────────────────
  const trackedNfts = useTrackedNfts();
  const [trackedEditTarget, setTrackedEditTarget] = useState<TrackedNft | null>(null);
  const [trackedModalOpen, setTrackedModalOpen] = useState(false);

  // Load collections and start stream
  useEffect(() => {
    const cols = loadCollections();
    setCollections(cols);

    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri || cols.length === 0) return;

    startStream(cols.map(c => c.slug)).catch(() => {});

    if (cols.length > 0) {
      Promise.allSettled(cols.map(c =>
        fetchCollectionStats(c.slug).then(s => ({ slug: c.slug, stats: s }))
      )).then(results => {
        const map: Record<string, CollectionStats> = {};
        results.forEach(r => { if (r.status === 'fulfilled') map[r.value.slug] = r.value.stats; });
        setCollectionStats(map);
      }).catch(() => {});
    }

    return () => { stopStream().catch(() => {}); };
  }, []);

  // Listen to stream events from Rust
  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!inTauri) return;

    let unlistenStatus: (() => void) | undefined;
    let unlistenEvent: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenStatus = await listen<StreamStatus>('stream-status', ({ payload }) => {
        setStreamConnected(payload.connected);
      });
      unlistenEvent = await listen<StreamEvent>('stream-event', ({ payload }) => {
        setStreamEvents(prev => [payload, ...prev].slice(0, 30));
      });
    })();

    return () => {
      unlistenStatus?.();
      unlistenEvent?.();
    };
  }, []);
  const [displayWallets, setDisplayWallets] = useState<MonitorWallet[]>([]);
  const [walletIds, setWalletIds] = useState<string[]>([]);
  /** Bump to force wallet list to reload after adding a new watched wallet. */
  const [walletRefreshKey, setWalletRefreshKey] = useState(0);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (relSettingsRef.current && !relSettingsRef.current.contains(e.target as Node)) {
        setShowRelSettings(false);
      }
    }
    if (showRelSettings) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showRelSettings]);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const stored = loadWatchedWallets();
    if (stored.length === 0) return;

    if (!inTauri) {
      // Browser / dev mode — show wallet names, no live data available
      setWalletIds(stored.map(w => w.id));
      setDisplayWallets(stored.map(w => ({
        address: w.address.slice(0, 6) + '…' + w.address.slice(-4),
        rawAddress: w.address,
        label: w.name,
        activityTag: 'Dormant' as ActivityTag,
        autoTags: [] as string[],
        highlighted: false,
        txnsMonth: '—',
        txLast: 'last: —',
        holdings: '—',
        holdingsUsd: '',
        pnl30d: '—',
        pnlUp: false,
        connections: '—',
      })));
      return;
    }

    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (!key) return;
      const results = await Promise.allSettled(
        stored.map(async (w) => {
          const [snap, txsRaw, pnl] = await Promise.all([
            getPortfolioSnapshot(w.address, key).catch(() => ({ eth_balance: 0, eth_price_usd: 0, portfolio_value_usd: 0, token_count: 0, nft_count: 0 } as PortfolioSnapshot)),
            getAssetTransfers(w.address, key).catch(() => [] as AssetTransfer[]),
            getPnlSummary(w.address, key).catch(() => null),
          ]);
          const txsArr = txsRaw as AssetTransfer[];
          return { w, snap: snap as PortfolioSnapshot, txCount: txsArr.length, txs: txsArr, pnl: pnl as PnlSummary | null };
        })
      );
      setWalletIds(stored.map(w => w.id));
      setDisplayWallets(
        results.map((r, i) => {
          if (r.status === 'rejected') return {
            address: stored[i].address.slice(0, 6) + '…' + stored[i].address.slice(-4),
            rawAddress: stored[i].address,
            label: stored[i].name,
            activityTag: 'Dormant' as ActivityTag,
            autoTags: [] as string[],
            highlighted: false,
            txnsMonth: '—',
            txLast: 'last: —',
            holdings: '—',
            holdingsUsd: '',
            pnl30d: '—',
            pnlUp: false,
            connections: '—',
          };
          const { w, snap, txs: walletTxs, pnl: walletPnl } = r.value;
          const cutoff30d = Date.now() - 30 * 86_400_000;
          const txsMonth = walletTxs
            .filter(t => new Date(t.metadata?.block_timestamp ?? 0).getTime() > cutoff30d).length;
          const lastTx = walletTxs[0];
          const lastTxMs = lastTx ? new Date(lastTx.metadata?.block_timestamp ?? 0).getTime() : 0;
          const monthsInactive = lastTxMs > 0 ? (Date.now() - lastTxMs) / (30 * 86_400_000) : 999;
          const txLastStr = lastTx && lastTxMs > 0 ? (() => {
            const s = Math.floor((Date.now() - lastTxMs) / 1000);
            if (s < 60) return `last: ${s}s ago`;
            if (s < 3600) return `last: ${Math.floor(s / 60)}m ago`;
            if (s < 86400) return `last: ${Math.floor(s / 3600)}h ago`;
            return `last: ${Math.floor(s / 86400)}d ago`;
          })() : 'last: —';
          const activityTag = classifyActivityTag(txsMonth, monthsInactive);
          const autoTags = computeAutoTags(snap.portfolio_value_usd, snap.nft_count);
          const nftPart  = snap.nft_count > 0   ? `${snap.nft_count} NFT${snap.nft_count !== 1 ? 's' : ''}` : '';
          const tokPart  = snap.token_count > 0 ? `${snap.token_count} Token${snap.token_count !== 1 ? 's' : ''}` : '';
          const holdings = [nftPart, tokPart].filter(Boolean).join(' · ') || '—';
          const totalPnlEth = walletPnl ? walletPnl.realized_pnl_eth + walletPnl.unrealized_pnl_eth : null;
          return {
            address: w.address.slice(0, 6) + '…' + w.address.slice(-4),
            rawAddress: w.address,
            label: w.name,
            activityTag,
            autoTags,
            highlighted: false,
            txnsMonth: String(txsMonth),
            txLast: txLastStr,
            holdings,
            holdingsUsd: `$${snap.portfolio_value_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
            pnl30d: totalPnlEth != null ? `${totalPnlEth >= 0 ? '+' : ''}${totalPnlEth.toFixed(4)} ETH` : '—',
            pnlUp: totalPnlEth != null && totalPnlEth >= 0,
            connections: '—',
          };
        })
      );
    })();
  }, [walletRefreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }

  const sortedCollections = [...collections].sort((a, b) => {
    if (sortCol === 'name') return sortDir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    // stats not yet fetched — stable sort by addedAt for other cols
    return sortDir === 'asc' ? a.addedAt - b.addedAt : b.addedAt - a.addedAt;
  });

  const content = (
    <main className="min-h-full px-12 py-8" style={{ backgroundColor: 'var(--wr-bg)', color: 'var(--wr-text)' }}>
      {showWatchModal && <WatchAddressModal onClose={() => setShowWatchModal(false)} onAdded={() => { setWalletRefreshKey(k => k + 1); setShowWatchModal(false); }} />}
      {showWatchColModal && (
        <WatchCollectionModal
          onClose={() => setShowWatchColModal(false)}
          onAdd={col => setCollections(prev => [...prev, col])}
        />
      )}

      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '20px', fontWeight: 700, color: 'var(--wr-text)' }}>Monitor</h1>
      </div>

      {/* ── Wallet Monitor ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', color: 'var(--wr-accent)', textTransform: 'uppercase' }}>Wallet Monitor</span>
            <span className="text-[10px] font-semibold px-2 py-0.5"
              style={{ color: 'var(--wr-info)', backgroundColor: 'var(--wr-info-bg)', border: '1px solid var(--wr-info)' }}>
              {displayWallets.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowWatchModal(true)}
              className="text-[10px] px-2.5 py-1 transition-colors"
              style={{ fontFamily: 'var(--font-jetbrains)', fontWeight: 600, color: 'var(--wr-accent)', border: '1px solid var(--wr-border)', backgroundColor: 'transparent', cursor: 'pointer' }}
            >
              + Watch Address
            </button>
          </div>
        </div>

        <div className="overflow-hidden" style={{ border: '1px solid var(--wr-border)', fontFamily: 'var(--font-jetbrains), monospace' }}>
          {/* Header */}
          <div
            className="grid"
            style={{ gridTemplateColumns: '210px 160px 180px 160px 1fr 28px', padding: '9px 20px', backgroundColor: 'var(--wr-surface-alt)', borderBottom: '1px solid var(--wr-border)' }}
          >
            {['Wallet', 'Txns/mo', 'Holdings', '30D P&L'].map(h => (
              <span key={h} style={{ color: 'var(--wr-text-3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</span>
            ))}
            {/* Relationship header with settings */}
            <div className="relative" ref={relSettingsRef}>
              <button
                className="flex items-center gap-1.5 group"
                onClick={() => setShowRelSettings(v => !v)}
              >
                <span className="group-hover:text-[#9298b8] transition-colors"
                  style={{ color: 'var(--wr-text-3)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Relationship
                </span>
                <span className={`text-[9px] transition-colors ${showRelSettings ? 'text-[#7c5cff]' : 'text-[#2b2e3f] group-hover:text-[#6e7590]'}`}>⚙</span>
              </button>

              {showRelSettings && (
                <div className="absolute top-full left-0 mt-1 w-[280px] z-50" style={{ fontFamily: 'var(--font-jetbrains), monospace', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', boxShadow: isDay ? '0 8px 24px rgba(0,0,0,0.12)' : '0 8px 24px rgba(0,0,0,0.6)' }}>
                  <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid var(--wr-border)' }}>
                    <span style={{ color: 'var(--wr-text)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Relationship Rules</span>
                    <button onClick={() => setRelRules(DEFAULT_REL_RULES)} style={{ color: 'var(--wr-text-3)', fontSize: 9, background: 'none', border: 'none', cursor: 'pointer' }}>Reset</button>
                  </div>
                  <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--wr-border)' }}>
                    <p style={{ color: 'var(--wr-text-3)', fontSize: 9, lineHeight: 1.6 }}>
                      Wallets are auto-added as relations when they meet any enabled rule below.
                    </p>
                  </div>
                  <div style={{ borderTop: 'none' }}>
                    {relRules.map(rule => (
                      <div key={rule.id} className="px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: '1px solid var(--wr-border)' }}>
                        <button
                          onClick={() => setRelRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r))}
                          className="w-7 h-4 flex-shrink-0 relative transition-colors"
                          style={{ borderRadius: 2, backgroundColor: rule.enabled ? '#7c5cff' : 'var(--wr-border-hover)', border: 'none', cursor: 'pointer' }}
                        >
                          <span className="absolute top-0.5 w-3 h-3 transition-all" style={{ left: rule.enabled ? '14px' : '2px', borderRadius: 1, backgroundColor: rule.enabled ? '#000' : 'var(--wr-text-3)' }} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div style={{ color: 'var(--wr-text-2)', fontSize: 10 }}>{rule.label}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setRelRules(prev => prev.map(r => r.id === rule.id && r.threshold > 1 ? { ...r, threshold: r.threshold - 1 } : r))}
                            className="w-5 h-5 flex items-center justify-center"
                            style={{ color: 'var(--wr-text-3)', fontSize: 10, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', cursor: 'pointer' }}
                            disabled={!rule.enabled}
                          >−</button>
                          <span className="w-4 text-center tabular-nums" style={{ color: rule.enabled ? 'var(--wr-text)' : 'var(--wr-text-4)', fontSize: 11 }}>{rule.threshold}</span>
                          <button
                            onClick={() => setRelRules(prev => prev.map(r => r.id === rule.id ? { ...r, threshold: r.threshold + 1 } : r))}
                            className="w-5 h-5 flex items-center justify-center"
                            style={{ color: 'var(--wr-text-3)', fontSize: 10, backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', cursor: 'pointer' }}
                            disabled={!rule.enabled}
                          >+</button>
                          <span className="ml-0.5" style={{ color: rule.enabled ? 'var(--wr-text-3)' : 'var(--wr-text-4)', fontSize: 9 }}>{rule.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="px-3 py-2" style={{ borderTop: '1px solid var(--wr-border)' }}>
                    <button
                      onClick={() => setShowRelSettings(false)}
                      className="w-full py-1.5 hover:opacity-90 transition-opacity"
                      style={{ backgroundColor: '#7c5cff', color: '#000', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer' }}
                    >Save Rules</button>
                  </div>
                </div>
              )}
            </div>
            <span />
          </div>

          {/* Empty state */}
          {displayWallets.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: '12px' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', letterSpacing: '1px' }}>No wallets tracked yet</div>
              <button
                onClick={() => setShowWatchModal(true)}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: 'var(--wr-accent)', border: 'none', padding: '8px 20px', cursor: 'pointer', letterSpacing: '0.05em' }}
              >
                + WATCH A WALLET
              </button>
            </div>
          )}

          {/* Rows */}
          {displayWallets.map((w, i) => (
            <Link
              key={i}
              href={`/monitor/wallet?address=${encodeURIComponent(w.address)}&label=${encodeURIComponent(w.label)}&raw=${encodeURIComponent(w.rawAddress)}`}
              className="grid items-center last:border-0 transition-colors cursor-pointer"
              style={{
                gridTemplateColumns: '210px 160px 180px 160px 1fr 28px',
                padding: '14px 20px',
                borderBottom: '1px solid var(--wr-border)',
                backgroundColor: 'transparent',
                textDecoration: 'none',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              {/* Wallet identity */}
              <div className="flex flex-col" style={{ gap: 3 }}>
                <div className="flex items-center gap-1">
                  <span style={{ color: 'var(--wr-text)', fontSize: 12, fontWeight: 500 }}>{w.address}</span>
                  <span
                    role="link"
                    tabIndex={0}
                    onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(`https://etherscan.io/address/${w.rawAddress}`, '_blank', 'noopener,noreferrer'); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); window.open(`https://etherscan.io/address/${w.rawAddress}`, '_blank', 'noopener,noreferrer'); } }}
                    className="shrink-0 text-[#6e7590] hover:text-[#9298b8] transition-colors flex cursor-pointer"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                </div>
                <span style={{ color: 'var(--wr-text-3)', fontSize: 10, fontWeight: 400 }}>{w.label}</span>
                <div className="flex flex-wrap items-center" style={{ gap: 4 }}>
                  {(() => {
                    const s = ACTIVITY_TAG_STYLE[w.activityTag];
                    return (
                      <span className="inline-flex items-center px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border"
                        style={{ color: s.color, backgroundColor: s.bg, borderColor: s.border }}>
                        {w.activityTag}
                      </span>
                    );
                  })()}
                  {w.autoTags.map(tag => (
                    <span key={tag} className="inline-flex items-center px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide border"
                      style={{ color: '#a78bfa', backgroundColor: '#1a0a2e', borderColor: '#4c1d95' }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Txns/mo */}
              <div className="flex flex-col" style={{ gap: 2 }}>
                <span style={{ color: 'var(--wr-text)', fontSize: 12, fontWeight: 500 }}>{w.txnsMonth}</span>
                <span style={{ color: 'var(--wr-text-3)', fontSize: 10, fontWeight: 400 }}>{w.txLast}</span>
              </div>

              {/* Holdings */}
              <div className="flex flex-col" style={{ gap: 2 }}>
                <span style={{ color: 'var(--wr-text)', fontSize: 12, fontWeight: 500 }}>{w.holdings}</span>
                <span style={{ color: 'var(--wr-text-3)', fontSize: 10, fontWeight: 400 }}>{w.holdingsUsd}</span>
              </div>

              {/* 30D P&L */}
              <div className="flex items-center" style={{ gap: 4 }}>
                {w.pnl30d !== '—' && (
                  <span style={{ color: w.pnlUp ? '#4fe9b4' : '#ff8a96', fontSize: 10 }}>
                    {w.pnlUp ? '↑' : '↘'}
                  </span>
                )}
                <span className="tabular-nums" style={{ color: w.pnl30d === '—' ? 'var(--wr-text-3)' : w.pnlUp ? '#4fe9b4' : '#ff8a96', fontSize: 12, fontWeight: 500 }}>
                  {w.pnl30d}
                </span>
              </div>

              {/* Relationship */}
              <div className="flex items-center" style={{ gap: 8 }}>
                <button
                  onClick={e => { e.preventDefault(); e.stopPropagation(); router.push(`/monitor/wallet?address=${encodeURIComponent(w.address)}&label=${encodeURIComponent(w.label)}&raw=${encodeURIComponent(w.rawAddress)}&tab=connections`); }}
                  className="flex items-center"
                  style={{
                    color: w.highlighted ? 'var(--wr-info)' : 'var(--wr-text-2)',
                    backgroundColor: w.highlighted ? 'var(--wr-info-bg)' : 'var(--wr-surface-alt)',
                    border: `1px solid ${w.highlighted ? 'var(--wr-info)' : 'var(--wr-text-3)'}`,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: 3,
                    gap: 4,
                    cursor: 'pointer',
                    transition: 'background-color 0.12s, color 0.12s, border-color 0.12s',
                  }}
                >
                  <span>♡</span>{w.connections}
                </button>
              </div>

              {/* Action */}
              <div className="flex items-center justify-center">
                <button
                  className="w-7 h-7 flex items-center justify-center hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--wr-text-3)' }}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const storedId = walletIds[i];
                    if (!storedId) return;
                    removeWallet(storedId);
                    setWalletIds(prev => prev.filter((_, idx) => idx !== i));
                    setDisplayWallets(prev => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  <span style={{ fontSize: 14 }}>🗑</span>
                </button>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── NFT Collections ── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', color: 'var(--wr-accent)', textTransform: 'uppercase' }}>NFT Collections</span>
            {collections.length > 0 && (
              <span className="text-[10px] font-semibold px-2 py-0.5"
                style={{ color: 'var(--wr-info)', backgroundColor: 'var(--wr-info-bg)', border: '1px solid var(--wr-info)' }}>
                {collections.length}
              </span>
            )}
            {/* Stream status dot */}
            <span title={streamConnected ? 'Stream live' : 'Stream disconnected'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                backgroundColor: streamConnected ? '#4fe9b4' : 'var(--wr-border)',
                display: 'inline-block',
                boxShadow: streamConnected ? '0 0 6px #4fe9b4' : 'none',
              }} />
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: 9, color: streamConnected ? '#4fe9b4' : 'var(--wr-text-4)', letterSpacing: '0.05em' }}>
                {streamConnected ? 'LIVE' : 'OFFLINE'}
              </span>
            </span>
          </div>
          <button
            onClick={() => setShowWatchColModal(true)}
            className="text-[10px] px-2.5 py-1 transition-colors"
            style={{ fontFamily: 'var(--font-jetbrains)', fontWeight: 600, color: 'var(--wr-accent)', border: '1px solid var(--wr-border)', backgroundColor: 'transparent', cursor: 'pointer' }}>
            + Watch Collection
          </button>
        </div>

        <div className="overflow-hidden" style={{ border: '1px solid var(--wr-border)' }}>
          {/* Header */}
          <div className="grid px-4 py-2.5"
            style={{ backgroundColor: 'var(--wr-surface-alt)', borderBottom: '1px solid var(--wr-border)', gridTemplateColumns: '1.8fr 0.8fr 0.6fr 0.9fr 0.9fr 0.7fr 1.4fr 0.7fr', columnGap: '16px' }}>
            {([
              { label: 'Collection', col: 'name'    as SortCol },
              { label: 'Floor',      col: 'floor'   as SortCol },
              { label: '% Change',   col: 'change'  as SortCol },
              { label: '24h Volume', col: 'vol24h'  as SortCol },
              { label: '7d Volume',  col: 'vol7d'   as SortCol },
              { label: '7d Sales',   col: 'sales7d' as SortCol },
              { label: 'Wallets',    col: null },
              { label: '',           col: null },
            ] as { label: string; col: SortCol | null }[]).map(({ label, col }) => (
              <div key={label} className="flex items-center gap-1">
                {col ? (
                  <button
                    onClick={() => toggleSort(col)}
                    className="flex items-center gap-1 group"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <span style={{
                      color: sortCol === col ? 'var(--wr-text-2)' : 'var(--wr-text-3)',
                      fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em',
                      fontFamily: 'var(--font-jetbrains)', fontWeight: sortCol === col ? 700 : 500,
                      transition: 'color 0.12s',
                    }}>
                      {label}
                    </span>
                    <span style={{ fontSize: 8, color: sortCol === col ? 'var(--wr-accent)' : 'var(--wr-text-4)', transition: 'color 0.12s', lineHeight: 1 }}>
                      {sortCol === col ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                    </span>
                  </button>
                ) : (
                  <span style={{ color: 'var(--wr-text-3)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
                )}
              </div>
            ))}
          </div>

          {/* Empty state */}
          {sortedCollections.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)', marginBottom: '12px' }}>
                No collections in watchlist
              </div>
              <button onClick={() => setShowWatchColModal(true)}
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#7c5cff', border: 'none', padding: '8px 20px', cursor: 'pointer' }}>
                + Watch Collection
              </button>
            </div>
          )}

          {/* Rows */}
          {sortedCollections.map(col => (
            <div
              key={col.slug}
              className="grid items-center px-4 py-3 last:border-0 transition-colors cursor-pointer"
              style={{ gridTemplateColumns: '1.8fr 0.8fr 0.6fr 0.9fr 0.9fr 0.7fr 1.4fr 0.7fr', columnGap: '16px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'transparent' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              onClick={() => router.push(`/monitor/collection?name=${encodeURIComponent(col.name)}&slug=${encodeURIComponent(col.slug)}&contract=${encodeURIComponent(col.contract_address)}${col.image_url ? `&image=${encodeURIComponent(col.image_url)}` : ''}`)}
            >
              <div>
                <div style={{ color: 'var(--wr-text)', fontSize: 11, fontWeight: 500 }}>{col.name}</div>
                <div style={{ color: 'var(--wr-text-3)', fontSize: 9 }}>{col.slug}</div>
              </div>
              <div style={{ color: 'var(--wr-text-2)', fontSize: 11, fontFamily: 'monospace' }}>
                {col.floor_price_eth != null ? `${col.floor_price_eth} ETH` : '—'}
              </div>
              {(() => {
                const stats = collectionStats[col.slug];
                if (stats?.vol_1d_change == null) return <div style={{ color: 'var(--wr-text-3)', fontSize: 11 }}>—</div>;
                const pct = (stats.vol_1d_change * 100).toFixed(1);
                const up = stats.vol_1d_change >= 0;
                return <div style={{ color: up ? '#34d399' : '#f87171', fontSize: 11 }}>{up ? '+' : ''}{pct}%</div>;
              })()}
              <div style={{ color: 'var(--wr-text-2)', fontSize: 11 }}>
                {col.vol_24h_eth != null ? `${col.vol_24h_eth.toFixed(1)} ETH` : '—'}
              </div>
              <div style={{ color: 'var(--wr-text-2)', fontSize: 11 }}>
                {col.vol_7d_eth != null ? `${col.vol_7d_eth.toFixed(1)} ETH` : '—'}
              </div>
              <div style={{ color: 'var(--wr-text-2)', fontSize: 11 }}>
                {col.sales_7d != null ? `${col.sales_7d} sales` : '—'}
              </div>
              <div style={{ color: 'var(--wr-text-3)', fontSize: 10 }}>
                {col.num_owners != null ? `${col.num_owners.toLocaleString()} owners` : '—'}
              </div>
              <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                <button
                  className="text-[9px] font-semibold px-2 py-1 transition-opacity hover:opacity-80"
                  style={{ color: '#000', backgroundColor: '#7c5cff', border: '1px solid #7c5cff' }}
                  onClick={() => router.push(`/monitor/collection?name=${encodeURIComponent(col.name)}&slug=${encodeURIComponent(col.slug)}&contract=${encodeURIComponent(col.contract_address)}${col.image_url ? `&image=${encodeURIComponent(col.image_url)}` : ''}`)}>
                  Open
                </button>
                <button
                  className="text-[9px] font-semibold px-2 py-1 transition-opacity hover:opacity-80"
                  style={{ color: 'var(--wr-danger)', backgroundColor: 'transparent', border: '1px solid var(--wr-danger)' }}
                  onClick={() => {
                    removeCollection(col.slug);
                    setCollections(prev => prev.filter(c => c.slug !== col.slug));
                  }}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tracked NFTs ──────────────────────────────────────────────────── */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', color: 'var(--wr-accent)', textTransform: 'uppercase' }}>Tracked NFTs</span>
            <span className="text-[10px] font-semibold px-2 py-0.5"
              style={{ color: 'var(--wr-info)', backgroundColor: 'var(--wr-info-bg)', border: '1px solid var(--wr-info)' }}>
              {trackedNfts.length}
            </span>
          </div>
        </div>

        {trackedNfts.length === 0 ? (
          <div style={{ border: '1px solid var(--wr-border)', padding: '32px 24px', textAlign: 'center', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
            No tracked NFTs yet. Visit a collection detail page and tap the ★ on any item to start tracking.
          </div>
        ) : (() => {
          // Shared grid template — used by both header and every data row so
          // every column lines up pixel-perfect vertically. Defined once here
          // to eliminate the risk of drift between header and rows.
          // Columns: Image | NFT Name | NFT ID | Collection | Rarity | Floor | Trait Floor | Rules | Actions
          const GRID_COLS = '44px minmax(140px, 1.6fr) 90px minmax(120px, 1.2fr) 80px 100px 110px 140px 200px';
          const ROW_PADDING = '14px 20px';
          const CELL_LABEL: React.CSSProperties = {
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '9px', fontWeight: 700,
            color: 'var(--wr-text-3)',
            letterSpacing: '0.12em', textTransform: 'uppercase',
            lineHeight: 1,
          };
          // Buttons in the action cell all share this shape so they render at
          // exactly the same height regardless of text length.
          const ACTION_BTN_BASE: React.CSSProperties = {
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '10px', fontWeight: 600,
            lineHeight: 1,
            height: '26px',
            padding: '0 12px',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          };
          return (
            <div className="overflow-hidden" style={{ border: '1px solid var(--wr-border)', fontFamily: 'var(--font-jetbrains), monospace' }}>
              {/* Column header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: GRID_COLS,
                padding: '12px 20px',
                borderBottom: '1px solid var(--wr-border)',
                backgroundColor: 'var(--wr-surface-alt)',
                alignItems: 'center',
              }}>
                {['', 'NFT', 'NFT ID', 'Collection', 'Rarity', 'Floor', 'Trait Floor', 'Rules', ''].map((h, i) => (
                  <div key={i} style={CELL_LABEL}>{h}</div>
                ))}
              </div>

              {trackedNfts.map(nft => {
                const rulesSummary: string[] = [];
                if (nft.notifications.onListed) rulesSummary.push('List');
                if (nft.notifications.onListedBelow != null) rulesSummary.push(`<${nft.notifications.onListedBelow}Ξ`);
                if (nft.notifications.onSold) rulesSummary.push('Sold');
                if (nft.notifications.onTransferred) rulesSummary.push('Xfer');
                const openseaUrl = `https://opensea.io/assets/ethereum/${nft.contract}/${nft.tokenId}`;
                return (
                  <div key={nft.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: GRID_COLS,
                      padding: ROW_PADDING,
                      borderBottom: '1px solid var(--wr-border)',
                      alignItems: 'center',
                      transition: 'background-color 0.12s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-hover-bg)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                  >
                    {/* Image — matches header column 1 (44px) */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      {nft.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={nft.imageUrl} alt={nft.name} style={{ width: '32px', height: '32px', objectFit: 'cover', display: 'block', borderRadius: '2px' }} />
                      ) : (
                        <div style={{ width: '32px', height: '32px', backgroundColor: 'var(--wr-overlay)', border: '1px solid var(--wr-border)', borderRadius: '2px' }} />
                      )}
                    </div>
                    {/* Name — matches header col 2 */}
                    <div style={{ minWidth: 0, paddingRight: '12px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>{nft.name}</div>
                    </div>
                    {/* NFT ID — dedicated column, matches header col 3 */}
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--wr-text-1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      #{nft.tokenId}
                    </div>
                    {/* Collection — matches header col 4 */}
                    <div style={{ minWidth: 0, paddingRight: '12px' }}>
                      <div style={{ fontSize: '12px', color: 'var(--wr-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.2 }}>
                        {nft.collectionName}
                      </div>
                    </div>
                    {/* Rarity — matches header col 5 */}
                    <div style={{ fontSize: '12px', fontWeight: 600, color: nft.rarity != null ? '#a78bfa' : 'var(--wr-text-3)', lineHeight: 1 }}>
                      {nft.rarity != null ? `#${nft.rarity}` : '—'}
                    </div>
                    {/* Floor — matches header col 6 */}
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', lineHeight: 1 }}>
                      {nft.floorEth != null ? `${nft.floorEth.toFixed(3)} ETH` : '—'}
                    </div>
                    {/* Trait Floor — matches header col 7 */}
                    <div style={{ fontSize: '12px', fontWeight: 600, color: nft.traitFloorEth != null ? 'var(--wr-text)' : 'var(--wr-text-3)', lineHeight: 1 }}>
                      {nft.traitFloorEth != null ? `${nft.traitFloorEth.toFixed(3)} ETH` : '—'}
                    </div>
                    {/* Rules summary chips — matches header col 8 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', paddingRight: '12px' }}>
                      {rulesSummary.length === 0 ? (
                        <span style={{ fontSize: '10px', color: 'var(--wr-text-3)' }}>No rules</span>
                      ) : rulesSummary.map((tag, i) => (
                        <span key={i}
                          style={{
                            fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                            color: 'var(--wr-accent)', backgroundColor: 'var(--wr-accent-dim, rgba(190,255,0,0.08))',
                            border: '1px solid var(--wr-accent)', padding: '3px 6px', lineHeight: 1,
                          }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    {/* Actions — matches header col 9 (right-aligned, fixed-height buttons) */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const rec = loadTrackedNfts().find(n => n.id === nft.id);
                          if (!rec) return;
                          setTrackedEditTarget(rec);
                          setTrackedModalOpen(true);
                        }}
                        title="Edit rules"
                        style={{
                          ...ACTION_BTN_BASE,
                          color: 'var(--wr-text-3)', backgroundColor: 'transparent',
                          border: '1px solid var(--wr-border)',
                        }}
                      >Edit</button>
                      <button
                        className="btn-cta"
                        onClick={e => {
                          e.stopPropagation();
                          openExternalUrl(openseaUrl).catch(() => window.open(openseaUrl, '_blank'));
                        }}
                        style={{
                          ...ACTION_BTN_BASE,
                          fontWeight: 700,
                          color: '#000', backgroundColor: '#7c5cff', border: '1px solid #7c5cff',
                        }}
                      >Buy</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          const offerUrl = `${openseaUrl}?make_offer=true`;
                          openExternalUrl(offerUrl).catch(() => window.open(offerUrl, '_blank'));
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.4)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.filter = 'none'; }}
                        style={{
                          ...ACTION_BTN_BASE,
                          color: 'var(--wr-info)', backgroundColor: 'var(--wr-info-bg)',
                          border: '1px solid var(--wr-info)', transition: 'filter 0.12s',
                        }}
                      >Offer</button>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          removeTrackedNft(nft.contract, nft.tokenId);
                        }}
                        title="Untrack"
                        style={{
                          ...ACTION_BTN_BASE,
                          width: '26px', padding: 0, fontSize: '12px',
                          color: 'var(--wr-text-3)', backgroundColor: 'transparent',
                          border: '1px solid var(--wr-border)',
                        }}
                      >×</button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      <TrackedNftNotificationModal
        open={trackedModalOpen}
        onClose={() => { setTrackedModalOpen(false); setTrackedEditTarget(null); }}
        target={trackedEditTarget}
      />

    </main>
  );

  return <ProGate feature="Monitoring">{content}</ProGate>;
}
