'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  getAssetTransfers,
  getPortfolioSnapshot,
  getPnlSummary,
  getTradeHistory,
  getNftPnl,
  findSisterWallets,
  loadAlchemyKey,
  type AssetTransfer,
  type PortfolioSnapshot,
  type PnlSummary,
  type TradeRecord,
  type NftPnlSummary,
  type SisterReport,
  type SisterCandidate,
  type SisterReason,
} from '@/lib/tauri';
import { Tag, TX_TYPE_VARIANT } from '@/components/Tag';
import { loadWallets } from '@/lib/walletStore';
import EthIcon from '@/components/EthIcon';

// ─── Monitor Wallet Detail — matches vr3No / MhiEO / XL7DN / U5KEl ───────────

// ── Shared types ──────────────────────────────────────────────────────────────
type Tab = 'Info' | 'Feed' | 'Portfolio' | 'P&L' | 'Stats' | 'Connections';
type TimeFilter = '24h' | '7d' | '30d' | '1M' | 'ALL' | '1d' | '1m' | '3M' | 'All';

// ── Feed tab types & data ─────────────────────────────────────────────────────
interface FeedItem {
  type: string;
  title: string;
  sub: string;
  timeAgo: string;
  date: string;
  // For Send/Receive: the counterparty wallet address
  counterpartyDisplay?: string;   // truncated, as shown in title
  counterpartyAddress?: string;   // full address for Etherscan link
  // For NFT Offer: the collection
  collectionName?: string;        // display name, as shown in title
  collectionSlug?: string;        // OpenSea slug
  // Etherscan tx link
  txHash?: string;
  // Dynamic styling for live transfers
  typeColor?: string;
  typeBg?: string;
  typeBorder?: string;
}


// ── Formatting / small helpers ────────────────────────────────────────────────
//
// Everything below renders REAL data only. Where a real source does not exist
// for a field we render '—' (unknown) rather than inventing a value, and where
// a source exists but needs setup we say what the user has to do.

const HEX_ADDR = /^0x[a-fA-F0-9]{40}$/;

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Tauri rejects with the Rust error String; keep the message, never swallow it. */
function errText(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

function fmtEth(n: number | null | undefined, signed = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = signed && n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toFixed(4)} ETH`;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

/**
 * Analytics timestamps are Alchemy `metadata.blockTimestamp` (ISO) when present
 * and fall back to a hex block number when it is not. Only the former is a date.
 */
function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  if (/^0x/i.test(s)) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function fmtUnixDate(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—';
  return new Date(sec * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDuration(fromMs: number | null, toMs: number | null): string {
  if (fromMs == null || toMs == null) return '—';
  const ms = toMs - fromMs;
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 48) return `${Math.round(h)} hrs`;
  return `${Math.round(h / 24)} days`;
}

function windowMs(f: TimeFilter): number | null {
  switch (f) {
    case '24h': case '1d': return 86_400_000;
    case '7d': return 7 * 86_400_000;
    case '30d': case '1M': case '1m': return 30 * 86_400_000;
    case '3M': return 90 * 86_400_000;
    default: return null; // 'ALL' | 'All'
  }
}

/** Deterministic swatch so a row keeps its colour between renders. Cosmetic only. */
const SWATCHES = ['#627eea', '#4fe9b4', '#ffb020', '#a78bfa', '#2fc4d6', '#ff8a96', '#8247e5', '#26a17b'];
function swatchFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

const NODE_SWATCHES = [
  { fill: '#3d0f0f', stroke: '#ff8a96', textColor: '#ff8a96' },
  { fill: '#0f1f3d', stroke: '#90a6ff', textColor: '#90a6ff' },
  { fill: '#1a0a2e', stroke: '#c084fc', textColor: '#c084fc' },
  { fill: '#032232', stroke: '#2fc4d6', textColor: '#2fc4d6' },
  { fill: '#231500', stroke: '#ffb020', textColor: '#ffb020' },
  { fill: '#012318', stroke: '#4fe9b4', textColor: '#4fe9b4' },
];

const SISTER_REASON_LABEL: Record<SisterReason, string> = {
  common_funder: 'Common Funder',
  funded_target: 'Funded This Wallet',
  target_funded: 'Funded By This Wallet',
  round_trip: 'Round Trip',
};

// ── Derived row shapes (all built from real command output) ───────────────────
interface TokenPnlRow {
  key: string;
  name: string;
  color: string;
  avgBuyEth: number | null;
  avgSellEth: number | null;
  realizedEth: number | null;
  unrealizedEth: number | null;
  totalEth: number | null;
}

interface TradeRow {
  key: string;
  token: string;
  color: string;
  name: string;
  costEth: number | null;
  pnlEth: number | null;
  pctPnl: number | null;
  duration: string;
  sortTs: number;
}

interface BubbleNode {
  id: string;
  address: string;
  label: string;
  sub: string;
  x: number;
  y: number;
  r: number;
  fill: string;
  stroke: string;
  textColor: string;
}

interface BubbleEdge {
  from: string;
  to: string;
  color: string;
  width: number;
  label: string;
  dashed: boolean;
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
/**
 * Cumulative realized P&L (ETH) over the closed trades returned by
 * `get_trade_history`. No synthetic series — if there is nothing to plot the
 * caller renders an empty state instead of calling this.
 */
function PnlAreaChart({ points }: { points: number[] }) {
  const W = 700, H = 100;
  const n = points.length;
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  // Zero line sits proportionally inside the box so gains draw up, losses down.
  const zeroY = H - ((0 - min) / span) * H;
  const coords = points.map((v, i) => ({
    x: n === 1 ? W : (i / (n - 1)) * W,
    y: H - ((v - min) / span) * H,
  }));
  const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${W},${zeroY} L0,${zeroY} Z`;
  const positive = (points[n - 1] ?? 0) >= 0;
  const stroke = positive ? '#4fe9b4' : '#ff8a96';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="pnlGradUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4fe9b4" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#4fe9b4" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="pnlGradDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8a96" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ff8a96" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#27272a" strokeWidth="0.5" />
      <path d={area} fill={positive ? 'url(#pnlGradUp)' : 'url(#pnlGradDown)'} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

function GaugeChart({ value = 0.5, color = '#4fe9b4' }: { value?: number; color?: string }) {
  const cx = 50, cy = 50, r = 36;
  const startAngle = Math.PI;
  const endAngle = 2 * Math.PI;
  const angle = startAngle + value * (endAngle - startAngle);
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const nx = cx + r * Math.cos(angle);
  const ny = cy + r * Math.sin(angle);

  return (
    <svg viewBox="0 0 100 60" className="w-20 h-12">
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
        fill="none" stroke="#27272a" strokeWidth="6" strokeLinecap="round" />
      <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${nx} ${ny}`}
        fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" />
      <line x1={cx} y1={cy} x2={cx + (r-4) * Math.cos(angle)} y2={cy + (r-4) * Math.sin(angle)}
        stroke="#f2f2f7" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex-1 h-2 bg-[#14161f] overflow-hidden">
      <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Connections Bubble Map ─────────────────────────────────────────────────────
// Nodes/edges are built from a real `find_sister_wallets` SisterReport by the
// page and passed in. Edge labels are transfer COUNTS (the only quantity the
// report carries) — never invented value flows.

function ConnectionsBubbleMap({ nodes, edges, onSelectNode }: {
  nodes: BubbleNode[];
  edges: BubbleEdge[];
  onSelectNode: (id: string) => void;
}) {
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));

  return (
    <svg viewBox="0 0 960 510" className="w-full" style={{ height: '100%' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Glow filters per node */}
        {nodes.map((n, ni) => (
          <filter key={n.id} id={`glow-${ni}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feFlood floodColor={n.stroke} floodOpacity="0.55" result="color" />
            <feComposite in="color" in2="blur" operator="in" result="glow" />
            <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        ))}
        {/* Arrow markers */}
        <marker id="arrow-out" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill="#ff8a96" opacity="0.7" />
        </marker>
        <marker id="arrow-in" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill="#4fe9b4" opacity="0.7" />
        </marker>
        <marker id="arrow-link" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill="#6e7590" opacity="0.7" />
        </marker>
      </defs>

      {/* ── Edges ── */}
      {edges.map((e, i) => {
        const src = nodeMap[e.from];
        const dst = nodeMap[e.to];
        if (!src || !dst) return null;
        // Offset parallel edges slightly with a quadratic bezier
        const mx = (src.x + dst.x) / 2;
        const my = (src.y + dst.y) / 2;
        const dx = dst.y - src.y;
        const dy = -(dst.x - src.x);
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = e.dashed ? 14 : 0;
        const cx = mx + (dx / len) * offset;
        const cy = my + (dy / len) * offset;
        const path = `M ${src.x} ${src.y} Q ${cx} ${cy} ${dst.x} ${dst.y}`;
        const markerId = e.color === '#4fe9b4' ? 'arrow-in' : e.color === '#ff8a96' ? 'arrow-out' : 'arrow-link';
        return (
          <g key={i}>
            <path
              d={path}
              fill="none"
              stroke={e.color}
              strokeWidth={e.width}
              strokeOpacity={0.5}
              strokeDasharray={e.dashed ? '5 4' : undefined}
              markerEnd={`url(#${markerId})`}
            />
            {e.label && (
              <text
                x={cx} y={cy - 6}
                textAnchor="middle"
                fill={e.color}
                fontSize="9"
                opacity="0.75"
                style={{ fontFamily: 'var(--font-jetbrains)' }}
              >
                {e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* ── Nodes ── */}
      {nodes.map((n, ni) => {
        const isCenter = n.id === 'center';
        return (
          <g
            key={n.id}
            style={{ cursor: isCenter ? 'default' : 'pointer' }}
            onClick={() => !isCenter && onSelectNode(n.id)}
          >
            {/* Outer glow ring */}
            <circle cx={n.x} cy={n.y} r={n.r + 6} fill="none" stroke={n.stroke} strokeWidth="1" opacity="0.18" />
            {/* Main bubble */}
            <circle cx={n.x} cy={n.y} r={n.r} fill={n.fill} stroke={n.stroke} strokeWidth={isCenter ? 1.8 : 1.2}
              filter={`url(#glow-${ni})`} />
            {/* Center pulse ring */}
            {isCenter && (
              <circle cx={n.x} cy={n.y} r={n.r + 12} fill="none" stroke="#a78bfa" strokeWidth="0.5" opacity="0.35" strokeDasharray="3 3" />
            )}
            {/* Label */}
            <text x={n.x} y={n.y + n.r + 14} textAnchor="middle" fill={n.textColor} fontSize={isCenter ? '10' : '9'}
              fontWeight={isCenter ? '700' : '500'} opacity="0.9"
              style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {n.label}
            </text>
            <text x={n.x} y={n.y + n.r + 25} textAnchor="middle" fill="#6e7590" fontSize="8"
              style={{ fontFamily: 'var(--font-jetbrains)' }}>
              {n.sub}
            </text>
            {/* Short address label inside big nodes */}
            {n.r >= 26 && (
              <text x={n.x} y={n.y + 4} textAnchor="middle" fill={n.textColor} fontSize={isCenter ? '11' : '9'}
                fontWeight="700" opacity="0.85"
                style={{ fontFamily: 'var(--font-jetbrains)' }}>
                {isCenter ? '0x' : n.label.slice(0, 5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── Wallet header sub-component ───────────────────────────────────────────────
const TABS: Tab[] = ['Info', 'Feed', 'Portfolio', 'P&L', 'Stats', 'Connections'];

function WalletHeader({ tab, setTab, display, address, raw, snapshot, snapshotLoading, snapshotError }: {
  tab: Tab;
  setTab: (t: Tab) => void;
  display: string;
  address: string;
  raw: string;
  snapshot: PortfolioSnapshot | null;
  snapshotLoading: boolean;
  snapshotError: string | null;
}) {
  return (
    <div className="border-b border-[#14161f] px-12 pt-6 pb-0">
      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '16px' }}>
        <Link href="/monitor" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Monitor</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>{display}</span>
      </div>

      {/* Top row: avatar + address */}
      <div className="flex items-start gap-4 mb-4">
        <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-white text-[13px] font-bold"
          style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)' }}>
          {address.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 leading-none flex-wrap">
            <span className="text-[22px] font-bold text-white leading-none">{display}</span>
            {raw && (
              <a href={`https://etherscan.io/address/${raw}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#6e7590] hover:text-[#9298b8] transition-colors flex">
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            )}
          </div>
          <span className="text-[#6e7590] text-[11px] mt-0.5 font-mono">{raw || '—'}</span>
        </div>
      </div>

      {/* Stats row — live from get_portfolio_snapshot */}
      <div className="flex items-center gap-4 mb-4">
        <div className="bg-[#14161f] border border-[#14161f] px-6 py-4 min-w-[180px]">
          <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Native Token Balance</div>
          {snapshotLoading ? (
            <div className="text-[13px] text-[#6e7590] leading-none py-[3px]">Loading…</div>
          ) : snapshot ? (
            <div className="text-[18px] font-bold text-white leading-none">
              {snapshot.eth_balance.toFixed(4)} <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} />
            </div>
          ) : (
            <div className="text-[18px] font-bold text-[#6e7590] leading-none">—</div>
          )}
          <div className="text-[11px] mt-1" style={{ color: !snapshotLoading && !snapshot && snapshotError ? '#ff8a96' : '#6e7590' }}>
            {snapshotLoading ? 'Fetching balance…' : snapshot ? fmtUsd(snapshot.eth_balance * snapshot.eth_price_usd) : (snapshotError ?? 'No data yet')}
          </div>
        </div>
        <div className="bg-[#14161f] border border-[#14161f] px-6 py-4 min-w-[180px]">
          <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Portfolio Value</div>
          {snapshotLoading ? (
            <div className="text-[13px] text-[#6e7590] leading-none py-[3px]">Loading…</div>
          ) : snapshot ? (
            <div className="text-[18px] font-bold text-white leading-none">{fmtUsd(snapshot.portfolio_value_usd)}</div>
          ) : (
            <div className="text-[18px] font-bold text-[#6e7590] leading-none">—</div>
          )}
          <div className="text-[11px] mt-1" style={{ color: !snapshotLoading && !snapshot && snapshotError ? '#ff8a96' : '#6e7590' }}>
            {snapshotLoading
              ? 'Fetching portfolio…'
              : snapshot
                ? `ETH only · ${snapshot.token_count} tokens · ${snapshot.nft_count} NFTs`
                : (snapshotError ?? 'No data yet')}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'text-[#7c5cff] border-[#7c5cff]'
                : 'text-[#6e7590] border-transparent hover:text-[#9298b8]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
function MonitorWalletInner() {
  const searchParams = useSearchParams();
  const hoverOn  = (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--wr-hover-bg)'; };
  const hoverOff = (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; };
  const [tab, setTab] = useState<Tab>('Feed');

  const paramAddress = searchParams.get('address') ?? '';
  const walletLabel  = searchParams.get('label') ?? '';
  const paramRaw     = searchParams.get('raw') ?? '';

  useEffect(() => {
    if (searchParams.get('tab') === 'connections') setTab('Connections');
  }, [searchParams]);
  const [feedFilters, setFeedFilters] = useState<Set<string>>(new Set());
  const [feedTimeRange, setFeedTimeRange] = useState<'1d' | '7d' | '30d' | 'all'>('all');
  const [pnlTime, setPnlTime] = useState<TimeFilter>('ALL');
  const [statsTime, setStatsTime] = useState<TimeFilter>('3M');
  const [relTime, setRelTime] = useState<TimeFilter>('All');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // ── Shared bootstrap: which wallet, which key, are we in the desktop app ────
  const [bootstrapped, setBootstrapped] = useState(false);
  const [inTauri, setInTauri] = useState(false);
  const [alchemyKey, setAlchemyKey] = useState('');
  const [address, setAddress] = useState('');

  // ── Per-block async state (each tab fetches only what it shows) ─────────────
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const [liveFeed, setLiveFeed] = useState<FeedItem[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedLoaded, setFeedLoaded] = useState(false);

  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [trades, setTrades] = useState<TradeRecord[] | null>(null);
  const [nftPnl, setNftPnl] = useState<NftPnlSummary | null>(null);
  const [nftPnlError, setNftPnlError] = useState<string | null>(null);
  const [pnlLoading, setPnlLoading] = useState(false);
  const [pnlError, setPnlError] = useState<string | null>(null);
  const [pnlLoaded, setPnlLoaded] = useState(false);

  const [sisters, setSisters] = useState<SisterReport | null>(null);
  const [sistersLoading, setSistersLoading] = useState(false);
  const [sistersError, setSistersError] = useState<string | null>(null);
  const [sistersLoaded, setSistersLoaded] = useState(false);

  const walletDisplay = walletLabel || paramAddress || (address ? shortAddr(address) : 'Wallet');

  useEffect(() => {
    const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setInTauri(tauri);

    // Only a real 40-hex address is usable; otherwise fall back to the first
    // wallet the user actually has. Never a placeholder.
    let addr = HEX_ADDR.test(paramRaw) ? paramRaw : HEX_ADDR.test(paramAddress) ? paramAddress : '';
    if (!addr) {
      try { addr = loadWallets()[0]?.address ?? ''; } catch { addr = ''; }
    }
    setAddress(HEX_ADDR.test(addr) ? addr : '');

    if (!tauri) { setBootstrapped(true); return; }
    loadAlchemyKey()
      .then(k => setAlchemyKey(k ?? ''))
      .catch(() => setAlchemyKey(''))
      .finally(() => setBootstrapped(true));
  }, [paramRaw, paramAddress]);

  /** Shared precondition check — returns the blocking message, or null if good. */
  const blockedReason = (needsAlchemy: boolean): string | null => {
    if (!inTauri) return 'Live data needs the Westron desktop app.';
    if (!address) return 'No wallet selected — open this page from Monitor or add a wallet first.';
    if (needsAlchemy && !alchemyKey) return 'Add an Alchemy API key in Settings to load this data.';
    return null;
  };

  // ── Header snapshot (always visible, so it loads on mount — one command) ────
  useEffect(() => {
    if (!bootstrapped) return;
    const blocked = blockedReason(true);
    if (blocked) { setSnapshot(null); setSnapshotError(blocked); setSnapshotLoading(false); return; }
    let cancelled = false;
    setSnapshotLoading(true);
    setSnapshotError(null);
    getPortfolioSnapshot(address, alchemyKey)
      .then(s => { if (!cancelled) setSnapshot(s); })
      .catch(e => { if (!cancelled) setSnapshotError(errText(e, 'Failed to load balances.')); })
      .finally(() => { if (!cancelled) setSnapshotLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, inTauri, address, alchemyKey]);

  // ── Feed tab: real transfers (get_asset_transfers), fetched once ───────────
  useEffect(() => {
    if (!bootstrapped || tab !== 'Feed' || feedLoaded) return;
    const blocked = blockedReason(true);
    if (blocked) { setFeedError(blocked); setLiveFeed([]); setFeedLoaded(true); return; }

    const addr = address;
    const toFeedItem = (t: AssetTransfer): FeedItem => {
      const isOut = t.from.toLowerCase() === addr.toLowerCase();
      const type  = isOut ? 'Sent' : 'Receive';
      const ts    = t.metadata?.block_timestamp;
      const ago   = ts ? (() => {
        const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        if (s < 3600) return `${Math.floor(s / 60)}m ago`;
        if (s < 86400) return `${Math.floor(s / 3600)} hrs ago`;
        return `${Math.floor(s / 86400)} days ago`;
      })() : t.block_num;
      const color  = isOut ? '#2fc4d6' : '#4fe9b4';
      const bg     = isOut ? '#0e2630' : '#06251b';
      const border = isOut ? '#0e2630' : '#06251b';
      const other  = isOut ? (t.to ?? '—') : t.from;
      const short  = other.slice(0, 6) + '…' + other.slice(-4);
      const val    = t.value != null ? `${t.value.toFixed(4)} ${t.asset ?? 'ETH'}` : '—';
      return {
        type, typeColor: color, typeBg: bg, typeBorder: border,
        title: `${type} ${val} ${isOut ? 'to' : 'from'} ${short}`,
        sub:   '',
        timeAgo: ago,
        date:  ts ? new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '',
        counterpartyDisplay: short,
        counterpartyAddress: other,
        txHash: t.hash,
      };
    };

    let cancelled = false;
    setFeedLoading(true);
    setFeedError(null);
    getAssetTransfers(addr, alchemyKey)
      .then(transfers => { if (!cancelled) setLiveFeed(transfers.map(toFeedItem)); })
      .catch(e => { if (!cancelled) { setFeedError(errText(e, 'Failed to load transfers.')); setLiveFeed([]); } })
      .finally(() => { if (!cancelled) { setFeedLoading(false); setFeedLoaded(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, tab, feedLoaded, inTauri, address, alchemyKey]);

  // ── P&L tab: get_pnl_summary → get_trade_history → get_nft_pnl ─────────────
  // Sequential on purpose: the free Alchemy tier has already produced 429s on
  // this app when a screen fires several transfer-heavy commands at once.
  useEffect(() => {
    if (!bootstrapped || tab !== 'P&L' || pnlLoaded) return;
    const blocked = blockedReason(true);
    if (blocked) { setPnlError(blocked); setPnlLoaded(true); return; }

    let cancelled = false;
    setPnlLoading(true);
    setPnlError(null);
    setNftPnlError(null);

    (async () => {
      try {
        const summary = await getPnlSummary(address, alchemyKey);
        if (cancelled) return;
        setPnl(summary);

        const history = await getTradeHistory(address, alchemyKey);
        if (cancelled) return;
        setTrades(history);

        // Cost-basis unrealized is an optional enrichment for the per-token
        // column. A failure here must not blank the rest of the tab.
        try {
          const np = await getNftPnl(address, alchemyKey);
          if (!cancelled) setNftPnl(np);
        } catch (e) {
          if (!cancelled) setNftPnlError(errText(e, 'Cost-basis data unavailable.'));
        }
      } catch (e) {
        if (!cancelled) setPnlError(errText(e, 'Failed to load P&L.'));
      } finally {
        if (!cancelled) { setPnlLoading(false); setPnlLoaded(true); }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, tab, pnlLoaded, inTauri, address, alchemyKey]);

  // ── Connections tab: find_sister_wallets (Etherscan, needs its own key) ────
  useEffect(() => {
    if (!bootstrapped || tab !== 'Connections' || sistersLoaded) return;
    const blocked = blockedReason(false);
    if (blocked) { setSistersError(blocked); setSistersLoaded(true); return; }

    let cancelled = false;
    setSistersLoading(true);
    setSistersError(null);
    findSisterWallets(address)
      .then(r => { if (!cancelled) setSisters(r); })
      .catch(e => { if (!cancelled) setSistersError(errText(e, 'Failed to find related wallets.')); })
      .finally(() => { if (!cancelled) { setSistersLoading(false); setSistersLoaded(true); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, tab, sistersLoaded, inTauri, address]);

  // ── Derived: per-token P&L rows from real trade history + NFT cost basis ───
  const tokenPnlRows = useMemo<TokenPnlRow[]>(() => {
    if (!trades) return [];
    const groups = new Map<string, TradeRecord[]>();
    for (const t of trades) {
      const key = (t.contract_address || 'unknown').toLowerCase();
      const list = groups.get(key);
      if (list) list.push(t); else groups.set(key, [t]);
    }

    // Unrealized per collection comes from get_nft_pnl items (locally stored
    // cost basis + current floor). Keyed on the collection label the trade
    // history uses, so unmatched groups honestly show '—'.
    const unrealizedByKey = new Map<string, number>();
    for (const item of nftPnl?.items ?? []) {
      if (item.unrealized_eth == null) continue;
      for (const k of [item.collection, item.contract]) {
        if (!k) continue;
        const lk = k.toLowerCase();
        unrealizedByKey.set(lk, (unrealizedByKey.get(lk) ?? 0) + item.unrealized_eth);
      }
    }

    const rows: TokenPnlRow[] = [];
    groups.forEach((list, key) => {
      const buys = list.filter(t => t.buy_price_eth > 0);
      const sells = list.filter(t => t.sell_price_eth != null && t.sell_price_eth > 0);
      const closed = list.filter(t => t.pnl_eth != null);
      const realized = closed.length ? closed.reduce((a, t) => a + (t.pnl_eth ?? 0), 0) : null;
      const unrealized = unrealizedByKey.has(key) ? (unrealizedByKey.get(key) as number) : null;
      const total = realized == null && unrealized == null ? null : (realized ?? 0) + (unrealized ?? 0);
      rows.push({
        key,
        name: list[0].contract_address || 'unknown',
        color: swatchFor(key),
        avgBuyEth: buys.length ? buys.reduce((a, t) => a + t.buy_price_eth, 0) / buys.length : null,
        avgSellEth: sells.length ? sells.reduce((a, t) => a + (t.sell_price_eth ?? 0), 0) / sells.length : null,
        realizedEth: realized,
        unrealizedEth: unrealized,
        totalEth: total,
      });
    });
    return rows.sort((a, b) => Math.abs(b.totalEth ?? 0) - Math.abs(a.totalEth ?? 0)).slice(0, 25);
  }, [trades, nftPnl]);

  // ── Derived: recent trades + cumulative realized curve, within the window ──
  const pnlWindow = windowMs(pnlTime);

  const recentTrades = useMemo<TradeRow[]>(() => {
    if (!trades) return [];
    const cutoff = pnlWindow == null ? null : Date.now() - pnlWindow;
    return trades
      .map<TradeRow | null>((t, i) => {
        const buyTs = parseTs(t.buy_timestamp);
        const sellTs = parseTs(t.sell_timestamp);
        const sortTs = sellTs ?? buyTs;
        if (cutoff != null && (sortTs == null || sortTs < cutoff)) return null;
        const shortId = t.token_id ? `#${t.token_id.length > 8 ? `${t.token_id.slice(0, 6)}…` : t.token_id}` : '';
        const cost = t.buy_price_eth > 0 ? t.buy_price_eth : null;
        const pnlEth = t.pnl_eth ?? null;
        return {
          key: `${t.buy_tx_hash}-${t.token_id}-${i}`,
          token: `${t.contract_address || 'unknown'}${shortId}`,
          color: swatchFor(t.contract_address || 'unknown'),
          name: t.contract_address || '—',
          costEth: cost,
          pnlEth,
          pctPnl: pnlEth != null && cost != null && cost > 0 ? (pnlEth / cost) * 100 : null,
          duration: t.sell_timestamp ? fmtDuration(buyTs, sellTs) : 'Open',
          sortTs: sortTs ?? 0,
        };
      })
      .filter((r): r is TradeRow => r !== null)
      .sort((a, b) => b.sortTs - a.sortTs)
      .slice(0, 25);
  }, [trades, pnlWindow]);

  const pnlCurve = useMemo<number[]>(() => {
    if (!trades) return [];
    const cutoff = pnlWindow == null ? null : Date.now() - pnlWindow;
    const closed = trades
      .map(t => ({ ts: parseTs(t.sell_timestamp), pnl: t.pnl_eth }))
      .filter((t): t is { ts: number; pnl: number } => t.ts != null && t.pnl != null)
      .filter(t => cutoff == null || t.ts >= cutoff)
      .sort((a, b) => a.ts - b.ts);
    let acc = 0;
    return closed.map(t => (acc += t.pnl));
  }, [trades, pnlWindow]);

  // ── Derived: related-wallet graph from the real SisterReport ──────────────
  const sisterCandidates = useMemo<SisterCandidate[]>(() => {
    const list = sisters?.candidates ?? [];
    const win = windowMs(relTime);
    const cutoffSec = win == null ? null : (Date.now() - win) / 1000;
    const filtered = cutoffSec == null
      ? list
      : list.filter(c => c.last_interaction != null && c.last_interaction >= cutoffSec);
    return [...filtered].sort((a, b) => b.score - a.score).slice(0, 8);
  }, [sisters, relTime]);

  const bubbleNodes = useMemo<BubbleNode[]>(() => {
    if (!address) return [];
    const center: BubbleNode = {
      id: 'center', address, label: shortAddr(address), sub: 'This Wallet',
      x: 480, y: 255, r: 44, fill: '#3b1f7a', stroke: '#a78bfa', textColor: '#f2f2f7',
    };
    const n = sisterCandidates.length;
    const others = sisterCandidates.map((c, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
      const ring = i % 2 === 0 ? 1 : 0.82;
      const sw = NODE_SWATCHES[i % NODE_SWATCHES.length];
      return {
        id: c.address,
        address: c.address,
        label: shortAddr(c.address),
        sub: `Score ${c.score}`,
        x: 480 + Math.cos(angle) * 330 * ring,
        y: 255 + Math.sin(angle) * 165 * ring,
        r: 14 + Math.round((Math.min(c.score, 100) / 100) * 20),
        fill: sw.fill, stroke: sw.stroke, textColor: sw.textColor,
      };
    });
    return [center, ...others];
  }, [address, sisterCandidates]);

  const bubbleEdges = useMemo<BubbleEdge[]>(() => {
    const edges: BubbleEdge[] = [];
    for (const c of sisterCandidates) {
      if (c.direct_out > 0) {
        edges.push({
          from: 'center', to: c.address, color: '#ff8a96',
          width: 1 + Math.min(c.direct_out, 6) * 0.25,
          label: `${c.direct_out} tx`, dashed: false,
        });
      }
      if (c.direct_in > 0) {
        edges.push({
          from: c.address, to: 'center', color: '#4fe9b4',
          width: 1 + Math.min(c.direct_in, 6) * 0.25,
          label: `${c.direct_in} tx`, dashed: true,
        });
      }
      if (c.direct_out === 0 && c.direct_in === 0) {
        // Linked by a shared funder rather than a direct transfer.
        edges.push({ from: 'center', to: c.address, color: '#6e7590', width: 0.8, label: '', dashed: true });
      }
    }
    return edges;
  }, [sisterCandidates]);

  const selectedCandidate = sisterCandidates.find(c => c.address === selectedNode) ?? null;

  return (
    <div className="min-h-full flex flex-col" style={{ backgroundColor: 'var(--wr-bg)', color: 'var(--wr-text)' }}>
      <WalletHeader
        tab={tab} setTab={setTab}
        display={walletDisplay}
        address={address || paramAddress}
        raw={address}
        snapshot={snapshot}
        snapshotLoading={snapshotLoading}
        snapshotError={snapshotError}
      />

      <div className="flex-1 px-12 py-6">

        {/* ── INFO TAB ── */}
        {tab === 'Info' && (
          <div className="flex flex-col gap-6">
            {/* Wallet identity */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--wr-text-3)' }}>Wallet Identity</p>
              <div className="border overflow-hidden" style={{ borderColor: 'var(--wr-border)' }}>

                {/* Full address — dedicated row */}
                <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--wr-border)', backgroundColor: 'var(--wr-surface-alt)' }}>
                  <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Full Address</div>
                  <div className="flex items-center gap-3">
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: address ? 'var(--wr-text)' : 'var(--wr-text-3)', flex: 1, wordBreak: 'break-all', lineHeight: 1.6 }}>
                      {address || 'No wallet selected'}
                    </span>
                    <div className="flex items-center gap-2 shrink-0" style={{ display: address ? undefined : 'none' }}>
                      <button
                        onClick={() => { if (address) navigator.clipboard.writeText(address); }}
                        className="transition-colors"
                        style={{ color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                        title="Copy address"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <rect x="5" y="5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                          <path d="M2 9V3C2 2.4 2.4 2 3 2H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer" className="transition-colors flex" style={{ color: 'var(--wr-text-3)' }} title="View on Etherscan">
                        <svg width="13" height="13" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </a>
                    </div>
                  </div>
                </div>

                {/* ENS + Labels — 2 columns */}
                <div className="grid border-b" style={{ gridTemplateColumns: '1fr 1fr', borderColor: 'var(--wr-border)' }}>
                  <div className="px-5 py-4 border-r" style={{ borderColor: 'var(--wr-border)' }}>
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>ENS Name</div>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, padding: '2px 8px', color: 'var(--tag-nft-buy-text)', backgroundColor: 'var(--tag-nft-buy-bg)', border: '1px solid var(--tag-nft-buy-border)' }}>
                      dexidda.eth
                    </span>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Labels</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['Smart Money', 'Whale', 'NFT Trader'].map(label => (
                        <span key={label} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, padding: '2px 7px', color: 'var(--wr-text-2)', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', letterSpacing: '0.04em' }}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* First Seen + Last Active — 2 columns */}
                <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="px-5 py-4 border-r" style={{ borderColor: 'var(--wr-border)' }}>
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>First Seen</div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--wr-text)' }}>Mar 12, 2021</div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Last Active</div>
                    <div className="text-[13px] font-semibold flex items-center gap-2" style={{ color: 'var(--wr-text)' }}>
                      2 hours ago
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4fe9b4', display: 'inline-block', flexShrink: 0 }} />
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Activity overview */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--wr-text-3)' }}>Activity Overview</p>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                {[
                  { label: 'Total Transactions', value: '1,842' },
                  { label: 'NFTs Held', value: '23' },
                  { label: 'Tokens Held', value: '8' },
                  { label: 'Connections', value: '47' },
                ].map(stat => (
                  <div key={stat.label} className="border px-4 py-3" style={{ borderColor: 'var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                    <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: 'var(--wr-text-3)' }}>{stat.label}</div>
                    <div className="text-[18px] font-bold" style={{ color: 'var(--wr-text)' }}>{stat.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Risk & tags */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--wr-text-3)' }}>Risk & Tags</p>
              <div className="border overflow-hidden" style={{ borderColor: 'var(--wr-border)' }}>

                {/* Risk score — accent row */}
                <div className="grid items-center px-5 py-4 border-b" style={{ gridTemplateColumns: '1fr 1fr', borderColor: 'var(--wr-border)', backgroundColor: 'var(--wr-surface-alt)' }}>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Risk Score</div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-32 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--wr-border)' }}>
                        <div className="h-full rounded-full" style={{ width: '28%', backgroundColor: '#4fe9b4' }} />
                      </div>
                      <span className="text-[11px] font-semibold" style={{ color: '#4fe9b4' }}>28 / 100</span>
                      <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#4fe9b4' }}>Low</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Flagged</div>
                    <div className="flex items-center gap-1.5">
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#4fe9b4', display: 'inline-block' }} />
                      <span className="text-[12px] font-semibold" style={{ color: '#4fe9b4' }}>No</span>
                    </div>
                  </div>
                </div>

                {/* Associated with + Contract interactions */}
                <div className="grid border-b" style={{ gridTemplateColumns: '1fr 1fr', borderColor: 'var(--wr-border)' }}>
                  <div className="px-5 py-4 border-r" style={{ borderColor: 'var(--wr-border)' }}>
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Associated With</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['Blur', 'OpenSea', 'Uniswap v3'].map(p => (
                        <span key={p} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, padding: '2px 7px', color: 'var(--wr-text-2)', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', letterSpacing: '0.04em' }}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-4">
                    <div className="text-[9px] uppercase tracking-widest mb-2" style={{ color: 'var(--wr-text-3)' }}>Contract Interactions</div>
                    <div className="text-[13px] font-semibold" style={{ color: 'var(--wr-text)' }}>342 <span className="text-[11px] font-normal" style={{ color: 'var(--wr-text-2)' }}>unique contracts</span></div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}

        {/* ── FEED TAB ── */}
        {tab === 'Feed' && (
          <>
            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              {/* ALL chip */}
              <button
                onClick={() => setFeedFilters(new Set())}
                className="transition-all"
                style={{
                  fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                  padding: '2px 8px', letterSpacing: '0.05em',
                  color:           feedFilters.size === 0 ? '#000' : 'var(--wr-text-3)',
                  backgroundColor: feedFilters.size === 0 ? '#7c5cff' : 'transparent',
                  border:          feedFilters.size === 0 ? '1px solid #7c5cff' : '1px solid var(--wr-border)',
                  cursor: 'pointer',
                }}>ALL</button>

              {/* Type chips */}
              {(['Receive', 'Sent', 'Swap Buy', 'Approve', 'NFT Buy', 'NFT Sell', 'NFT Sent', 'NFT Offer', 'NFT Mint', 'Sweep', 'Contract Interaction'] as const).map(f => {
                const active = feedFilters.has(f);
                const variant = TX_TYPE_VARIANT[f];
                return (
                  <button key={f}
                    onClick={() => {
                      setFeedFilters(prev => {
                        const next = new Set(prev);
                        if (next.has(f)) next.delete(f); else next.add(f);
                        return next;
                      });
                    }}
                    className="transition-all"
                    style={{
                      fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                      padding: '2px 8px', letterSpacing: '0.05em', cursor: 'pointer',
                      color:           active ? `var(--tag-${variant}-text)` : 'var(--wr-text-3)',
                      backgroundColor: active ? `var(--tag-${variant}-bg)` : 'transparent',
                      border:          active ? `1px solid var(--tag-${variant}-border)` : '1px solid var(--wr-border)',
                      opacity: active ? 1 : 0.7,
                    }}>{f}</button>
                );
              })}

              {/* Time range dropdown */}
              <select
                value={feedTimeRange}
                onChange={e => setFeedTimeRange(e.target.value as '1d' | '7d' | '30d' | 'all')}
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700,
                  padding: '2px 8px', paddingRight: '22px',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  cursor: 'pointer',
                  color: 'var(--wr-text-3)',
                  backgroundColor: 'var(--wr-surface)',
                  border: '1px solid var(--wr-border)',
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 14 14'%3E%3Cpath d='M3 5L7 9L11 5' stroke='%236e6e6e' stroke-width='1.3' stroke-linecap='round' stroke-linejoin='round' fill='none'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 6px center',
                  outline: 'none',
                }}>
                <option value="1d">1D</option>
                <option value="7d">7D</option>
                <option value="30d">30D</option>
                <option value="all">All Time</option>
              </select>
            </div>

            {/* Transactions */}
            <div className="border border-[#14161f] overflow-hidden">
              {feedLoading && (
                <div className="px-4 py-6 text-[11px] text-[#6e7590]">Loading transfers…</div>
              )}
              {!feedLoading && feedError && (
                <div className="px-4 py-6 text-[11px]" style={{ color: '#ff8a96' }}>{feedError}</div>
              )}
              {!feedLoading && !feedError && liveFeed !== null && liveFeed.length === 0 && (
                <div className="px-4 py-6 text-[11px] text-[#6e7590]">No transfers found for this wallet.</div>
              )}
              {!feedLoading && (liveFeed ?? []).filter(item => {
                // Type filter (multi-select; empty set = show all)
                if (feedFilters.size > 0 && !feedFilters.has(item.type)) return false;
                // Time range filter
                if (feedTimeRange !== 'all') {
                  const now = Date.now();
                  const cutoff = feedTimeRange === '1d' ? 86_400_000 : feedTimeRange === '7d' ? 7 * 86_400_000 : 30 * 86_400_000;
                  const itemDate = new Date(item.date).getTime();
                  if (isNaN(itemDate) || now - itemDate > cutoff) return false;
                }
                return true;
              }).map((item, i) => {
                // Build the title with inline address/collection link
                const titleNode = (() => {
                  if (item.counterpartyDisplay && item.counterpartyAddress) {
                    const idx = item.title.indexOf(item.counterpartyDisplay);
                    if (idx !== -1) {
                      const before = item.title.slice(0, idx);
                      const after  = item.title.slice(idx + item.counterpartyDisplay.length);
                      return (
                        <span className="text-[12px] text-white font-medium">
                          {before}
                          <span className="inline-flex items-center gap-0.5">
                            <span>{item.counterpartyDisplay}</span>
                            <a href={`https://etherscan.io/address/${item.counterpartyAddress}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#6e7590] hover:text-[#9298b8] transition-colors flex">
                              <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </a>
                          </span>
                          {after}
                        </span>
                      );
                    }
                  }
                  if (item.collectionName && item.collectionSlug) {
                    const idx = item.title.indexOf(item.collectionName);
                    if (idx !== -1) {
                      const before = item.title.slice(0, idx);
                      const after  = item.title.slice(idx + item.collectionName.length);
                      return (
                        <span className="text-[12px] text-white font-medium">
                          {before}
                          <span className="inline-flex items-center gap-0.5">
                            <span>{item.collectionName}</span>
                            <a href={`https://opensea.io/collection/${item.collectionSlug}`} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-[#6e7590] hover:text-[#9298b8] transition-colors flex">
                              <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </a>
                          </span>
                          {after}
                        </span>
                      );
                    }
                  }
                  return <span className="text-[12px] text-white font-medium truncate">{item.title}</span>;
                })();

                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors" onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="w-7 h-7 rounded-full bg-[#14161f] flex items-center justify-center text-[9px] text-[#6e7590] shrink-0">tx</div>
                    <Tag variant={TX_TYPE_VARIANT[item.type] ?? 'neutral'} size="xs">{item.type}</Tag>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 flex-wrap">
                        {titleNode}
                      </div>
                      {item.sub && <div className="text-[10px] text-[#6e7590]">{item.sub}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] text-[#9298b8]">{item.timeAgo}</div>
                      <div className="text-[9px] text-[#6e7590]">{item.date}</div>
                    </div>
                  </div>
                );
              })}
            </div>

          </>
        )}

        {/* ── PORTFOLIO TAB ── */}
        {tab === 'Portfolio' && (
          <div className="flex flex-col gap-6">
            {/* Token holdings */}
            <div>
              <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-3">Token Holdings</p>
              <div className="border border-[#14161f] overflow-hidden">
                <div className="grid border-b border-[#14161f] px-4 py-2"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '2fr 1fr 1fr 1fr 80px' }}>
                  {['Asset', 'Balance', 'Price', 'Value', '% Portfolio'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e7590] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {[
                  { name: 'ETH', label: 'Ethereum', color: '#627eea', balance: '0.77', price: '$3,241.50', value: '$2,496.00', pct: '58.2%' },
                  { name: 'USDT', label: 'Tether USD', color: '#26a17b', balance: '842.30', price: '$1.00', value: '$842.30', pct: '19.7%' },
                  { name: 'USDC', label: 'USD Coin', color: '#2775ca', balance: '420.00', price: '$1.00', value: '$420.00', pct: '9.8%' },
                  { name: 'MATIC', label: 'Polygon', color: '#8247e5', balance: '1,204', price: '$0.71', value: '$855.00', pct: '7.4%' },
                  { name: 'ARB', label: 'Arbitrum', color: '#28a0f0', balance: '315.6', price: '$0.60', value: '$189.36', pct: '4.4%' },
                  { name: 'LINK', label: 'Chainlink', color: '#2a5ada', balance: '2.4', price: '$14.20', value: '$34.08', pct: '0.5%' },
                ].map(tok => (
                  <div key={tok.name} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 80px' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: tok.color }}>{tok.name[0]}</span>
                      <div>
                        <div className="text-[12px] text-white font-medium">{tok.name}</div>
                        <div className="text-[9px] text-[#6e7590]">{tok.label}</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{tok.balance}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{tok.price}</div>
                    <div className="text-[11px] text-white font-medium tabular-nums">{tok.value}</div>
                    <div className="text-[11px] text-[#6e7590] tabular-nums">{tok.pct}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* NFT holdings summary */}
            <div>
              <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-3">NFT Holdings</p>
              <div className="border border-[#14161f] overflow-hidden">
                <div className="grid border-b border-[#14161f] px-4 py-2"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
                  {['Collection', 'Held', 'Floor', 'Est. Value'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e7590] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {[
                  { name: 'Bored Ape YC', color: '#ffb020', held: 1, floor: '14.2 ETH', value: '$46,030' },
                  { name: 'Azuki', color: '#a78bfa', held: 2, floor: '5.1 ETH', value: '$33,062' },
                  { name: 'Pudgy Penguins', color: '#90a6ff', held: 1, floor: '6.8 ETH', value: '$22,042' },
                  { name: 'Art Blocks', color: '#4fe9b4', held: 3, floor: '0.3 ETH', value: '$2,916' },
                ].map(col => (
                  <div key={col.name} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: col.color }}>{col.name[0]}</span>
                      <div className="text-[12px] text-white font-medium">{col.name}</div>
                    </div>
                    <div className="text-[11px] text-[#9298b8]">{col.held}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{col.floor}</div>
                    <div className="text-[11px] text-white font-medium tabular-nums">{col.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── P&L TAB ── */}
        {tab === 'P&L' && (
          <>
            {/* TOKEN P&L BREAKDOWN */}
            <div className="mb-6">
              <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-3">Token P&L Breakdown</p>
              <div className="border border-[#14161f] overflow-hidden">
                <div className="grid border-b border-[#14161f] px-4 py-2"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '1.5fr 1fr 1fr 1.2fr 1.2fr 1.2fr' }}>
                  {['Token', 'Avg Buy', 'Avg Sell', 'Realized', 'Unrealized', 'Total P&L'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e7590] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {pnlLoading && (
                  <div className="px-4 py-6 text-[11px] text-[#6e7590]">Loading trade history…</div>
                )}
                {!pnlLoading && pnlError && (
                  <div className="px-4 py-6 text-[11px]" style={{ color: '#ff8a96' }}>{pnlError}</div>
                )}
                {!pnlLoading && !pnlError && trades !== null && tokenPnlRows.length === 0 && (
                  <div className="px-4 py-6 text-[11px] text-[#6e7590]">
                    No matched trades found for this wallet. Westron pairs on-chain NFT transfers into trades — buys with no matching sale appear once they are sold.
                  </div>
                )}
                {!pnlLoading && !pnlError && tokenPnlRows.map(row => (
                  <div key={row.key} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1.2fr 1.2fr 1.2fr' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: row.color }}>{row.name.slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0">
                        <div className="text-[12px] text-white font-medium truncate">{row.name}</div>
                        <div className="text-[9px] text-[#6e7590]">On-chain trades</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{fmtEth(row.avgBuyEth)}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{fmtEth(row.avgSellEth)}</div>
                    <div className={`text-[11px] font-medium tabular-nums ${row.realizedEth == null ? 'text-[#6e7590]' : row.realizedEth >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtEth(row.realizedEth, true)}
                    </div>
                    <div className={`text-[11px] tabular-nums ${row.unrealizedEth == null ? 'text-[#6e7590]' : row.unrealizedEth >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtEth(row.unrealizedEth, true)}
                    </div>
                    <div className={`text-[11px] font-bold tabular-nums ${row.totalEth == null ? 'text-[#6e7590]' : row.totalEth >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtEth(row.totalEth, true)}
                    </div>
                  </div>
                ))}
              </div>
              {!pnlLoading && !pnlError && nftPnlError && (
                <p className="text-[9px] mt-2" style={{ color: '#ff8a96' }}>
                  Unrealized column unavailable: {nftPnlError}
                </p>
              )}
              {!pnlLoading && !pnlError && !nftPnlError && tokenPnlRows.length > 0 && (
                <p className="text-[9px] text-[#6e7590] mt-2">
                  Values in ETH. Unrealized comes from stored cost basis vs current floor; &apos;—&apos; means no cost basis recorded yet.
                </p>
              )}
            </div>

            {/* P&L OVERVIEW */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest">P&L Overview</p>
                <div className="flex items-center gap-1">
                  {(['24h','7d','30d','1M','ALL'] as TimeFilter[]).map(f => (
                    <button key={f} onClick={() => setPnlTime(f)}
                      className={`text-[9px] font-semibold px-2 py-1 transition-colors ${
                        pnlTime === f ? 'bg-[#7c5cff] text-black' : 'text-[#6e7590] hover:text-[#9298b8]'
                      }`}>{f}</button>
                  ))}
                </div>
              </div>

              {/* KPI row — get_pnl_summary (all-time; the range buttons drive the
                  chart and the trade list below, which are time-stamped). */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {(() => {
                  const closed = pnl ? pnl.win_count + pnl.loss_count : 0;
                  const totalEth = pnl ? pnl.realized_pnl_eth + pnl.unrealized_pnl_eth : null;
                  const hasAny = !!pnl && (pnl.trade_count > 0 || pnl.realized_pnl_eth !== 0 || pnl.unrealized_pnl_eth !== 0);
                  const cards: { label: string; value: string | null; sub: string; tone: number | null }[] = [
                    {
                      label: 'Total P&L',
                      value: pnl && hasAny ? fmtEth(totalEth, true) : null,
                      sub: !pnl ? 'No data yet' : hasAny ? 'realized + unrealized, all-time' : 'No matched trades yet',
                      tone: totalEth,
                    },
                    {
                      label: 'Realized P&L',
                      value: pnl && pnl.trade_count > 0 ? fmtEth(pnl.realized_pnl_eth, true) : null,
                      sub: pnl ? `from ${pnl.trade_count} closed trade${pnl.trade_count === 1 ? '' : 's'}` : 'No data yet',
                      tone: pnl?.realized_pnl_eth ?? null,
                    },
                    {
                      label: 'Unrealized P&L',
                      value: pnl && pnl.unrealized_pnl_eth !== 0 ? fmtEth(pnl.unrealized_pnl_eth, true) : null,
                      sub: !pnl ? 'No data yet' : pnl.unrealized_pnl_eth !== 0 ? 'held positions vs floor' : 'no floor price for held items',
                      tone: pnl?.unrealized_pnl_eth ?? null,
                    },
                    {
                      label: 'Win Rate',
                      value: pnl && closed > 0 ? `${((pnl.win_count / closed) * 100).toFixed(1)}%` : null,
                      sub: pnl ? `${pnl.win_count}/${closed} closed trades` : 'No data yet',
                      tone: pnl && closed > 0 ? 1 : null,
                    },
                  ];
                  return cards.map(k => (
                    <div key={k.label} className="bg-[#14161f] border border-[#14161f] px-4 py-3">
                      <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">{k.label}</div>
                      {pnlLoading ? (
                        <div className="text-[13px] font-bold text-[#6e7590] py-[3px]">Loading…</div>
                      ) : (
                        <div className={`text-[18px] font-bold ${k.value == null ? 'text-[#6e7590]' : (k.tone ?? 0) >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                          {k.value ?? '—'}
                        </div>
                      )}
                      <div className="text-[9px] mt-0.5" style={{ color: !pnlLoading && pnlError ? '#ff8a96' : '#6e7590' }}>
                        {pnlLoading ? 'Fetching…' : pnlError ? 'Unavailable' : k.sub}
                      </div>
                    </div>
                  ));
                })()}
              </div>

              {/* Chart — cumulative realized P&L from get_trade_history */}
              <div className="bg-[#14161f] border border-[#14161f] px-4 py-3">
                {pnlLoading ? (
                  <div className="text-[11px] text-[#6e7590] py-8 text-center">Loading P&amp;L history…</div>
                ) : pnlError ? (
                  <div className="text-[11px] py-8 text-center" style={{ color: '#ff8a96' }}>{pnlError}</div>
                ) : pnlCurve.length < 2 ? (
                  <div className="text-[11px] text-[#6e7590] py-8 text-center">
                    Not enough closed trades with timestamps to chart P&amp;L{pnlTime === 'ALL' ? '.' : ` in the last ${pnlTime}.`}
                  </div>
                ) : (
                  <>
                    <div className={`text-[11px] font-bold mb-1 ${(pnlCurve[pnlCurve.length - 1] ?? 0) >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtEth(pnlCurve[pnlCurve.length - 1], true)}
                    </div>
                    <div className="text-[9px] text-[#6e7590] mb-3">
                      Cumulative realized P&amp;L · {pnlCurve.length} closed trades · {pnlTime === 'ALL' ? 'all time' : `last ${pnlTime}`}
                    </div>
                    <PnlAreaChart points={pnlCurve} />
                  </>
                )}
              </div>
            </div>

            {/* RECENT TRADES */}
            <div>
              <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-3">Recent Trades</p>
              <div className="border border-[#14161f] overflow-hidden">
                <div className="grid border-b border-[#14161f] px-4 py-2"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '1.2fr 1fr 0.8fr 1fr 0.6fr 0.8fr' }}>
                  {['Token','Name','Cost','PnL','%','Duration'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e7590] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {pnlLoading && (
                  <div className="px-4 py-6 text-[11px] text-[#6e7590]">Loading trades…</div>
                )}
                {!pnlLoading && pnlError && (
                  <div className="px-4 py-6 text-[11px]" style={{ color: '#ff8a96' }}>{pnlError}</div>
                )}
                {!pnlLoading && !pnlError && trades !== null && recentTrades.length === 0 && (
                  <div className="px-4 py-6 text-[11px] text-[#6e7590]">
                    No trades{pnlTime === 'ALL' ? '' : ` in the last ${pnlTime}`} for this wallet.
                  </div>
                )}
                {!pnlLoading && !pnlError && recentTrades.map(t => (
                  <div key={t.key} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr 1fr 0.6fr 0.8fr' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold shrink-0"
                        style={{ backgroundColor: t.color }}>{t.token.slice(0, 1).toUpperCase()}</span>
                      <span className="text-[11px] text-white font-mono truncate">{t.token}</span>
                    </div>
                    <div className="text-[11px] text-[#9298b8] truncate">{t.name}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{fmtEth(t.costEth)}</div>
                    <div className={`text-[11px] font-medium tabular-nums ${t.pnlEth == null ? 'text-[#6e7590]' : t.pnlEth >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtEth(t.pnlEth, true)}
                    </div>
                    <div className={`text-[11px] tabular-nums ${t.pctPnl == null ? 'text-[#6e7590]' : t.pctPnl >= 0 ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                      {fmtPct(t.pctPnl)}
                    </div>
                    <div className="text-[11px] text-[#6e7590]">{t.duration}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── STATS TAB ── */}
        {tab === 'Stats' && (
          <>
            {/* Time filter */}
            <div className="flex justify-end mb-4">
              <div className="flex items-center gap-1">
                {(['1d','1m','3M','ALL'] as TimeFilter[]).map(f => (
                  <button key={f} onClick={() => setStatsTime(f)}
                    className={`text-[10px] font-semibold px-2.5 py-1 transition-colors ${
                      statsTime === f ? 'bg-[#7c5cff] text-black' : 'text-[#6e7590] hover:text-[#9298b8]'
                    }`}>{f}</button>
                ))}
              </div>
            </div>

            {/* 4 KPI cards */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { icon: '📊', iconBg: '#0e2630', label: 'Total Trading', value: '1 trade', sub: '1 Bot' },
                { icon: '🏆', iconBg: '#2a1e05', label: 'Win Rate',      value: '—',       sub: '' },
                { icon: '📈', iconBg: '#06251b', label: 'Max Profit',    value: '—',       sub: '' },
                { icon: '📉', iconBg: '#2b070c', label: 'Max Drawdown',  value: '—',       sub: '' },
              ].map(k => (
                <div key={k.label} className="bg-[#14161f] border border-[#14161f] p-4">
                  <div className="w-8 h-8 flex items-center justify-center text-[14px] mb-3 rounded-[4px]"
                    style={{ backgroundColor: k.iconBg }}>
                    {k.icon}
                  </div>
                  <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">{k.label}</div>
                  <div className="text-[18px] font-bold text-white">{k.value}</div>
                  {k.sub && <div className="text-[9px] text-[#6e7590]">{k.sub}</div>}
                </div>
              ))}
            </div>

            {/* 2 gauge panels */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              {[
                { title: 'Buy / Sell Volume', buyLabel: 'Total Buy Amount', sellLabel: 'Total Sell Amount', buyVal: '$0.00', sellVal: '$0.00' },
                { title: 'Realistic Amounts', buyLabel: 'Realistic Buy Amount', sellLabel: 'Avg Sell Amount', buyVal: '$0.00', sellVal: '$0.00' },
              ].map((panel, i) => (
                <div key={i} className="bg-[#14161f] border border-[#14161f] p-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">Buying</div>
                      <div className="text-[9px] text-[#6e7590] mb-2">{panel.buyLabel}</div>
                      <div className="flex justify-center mb-2">
                        <GaugeChart value={0} color="#4fe9b4" />
                      </div>
                      <div className="flex justify-between text-[8px] text-[#6e7590] mb-1"><span>Poor</span><span>Good</span></div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">Selling</div>
                      <div className="text-[9px] text-[#6e7590] mb-2">{panel.sellLabel}</div>
                      <div className="flex justify-center mb-2">
                        <GaugeChart value={0} color="#ff8a96" />
                      </div>
                      <div className="text-[13px] font-bold text-white">{panel.sellVal}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* 2 bar chart panels */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#14161f] border border-[#14161f] p-4">
                <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-4">Token Profit Distribution</p>
                {[
                  { label: '< 10%',        val: 90 },
                  { label: '10% – 100%',   val: 65 },
                  { label: '0k – 200%',    val: 20 },
                  { label: '-35',          val: 5  },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3 mb-2">
                    <span className="text-[9px] text-[#6e7590] w-20 shrink-0">{row.label}</span>
                    <HBar value={row.val} max={100} color="#7c5cff" />
                  </div>
                ))}
              </div>
              <div className="bg-[#14161f] border border-[#14161f] p-4">
                <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-4">Avg Token Held Time</p>
                {[
                  { label: '0h – 2k',   val: 80 },
                  { label: '2k – 10k',  val: 50 },
                  { label: '10k – 1D',  val: 25 },
                  { label: '1D+',       val: 10 },
                ].map(row => (
                  <div key={row.label} className="flex items-center gap-3 mb-2">
                    <span className="text-[9px] text-[#6e7590] w-20 shrink-0">{row.label}</span>
                    <HBar value={row.val} max={100} color="#7c5cff" />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── CONNECTIONS TAB ── */}
        {tab === 'Connections' && (
          <div className="flex gap-5" style={{ minHeight: '460px' }}>

            {/* Bubble map */}
            <div className="flex-1 relative" style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '12px', overflow: 'hidden' }}>
              {/* Legend — edges are transfer counts from find_sister_wallets */}
              <div className="absolute top-3 left-4 flex items-center gap-4 z-10">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-px bg-[#ff8a96]" />
                  <span className="text-[9px] text-[#6e7590]">Sent to (tx)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 border-t border-dashed border-[#4fe9b4]" />
                  <span className="text-[9px] text-[#6e7590]">Received from (tx)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[#a78bfa]" />
                  <span className="text-[9px] text-[#6e7590]">This Wallet</span>
                </div>
              </div>
              {/* Time filter */}
              <div className="absolute top-3 right-4 flex items-center gap-1 z-10">
                {(['7d','30d','All'] as TimeFilter[]).map(f => (
                  <button key={f} onClick={() => setRelTime(f)}
                    className={`text-[9px] font-semibold px-2 py-1 transition-colors ${
                      relTime === f ? 'bg-[#7c5cff] text-black' : 'text-[#6e7590] hover:text-[#9298b8]'
                    }`}>{f}</button>
                ))}
              </div>

              {sistersLoading && (
                <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#6e7590]">
                  Finding related wallets…
                </div>
              )}
              {!sistersLoading && sistersError && (
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <p className="text-[11px] text-center leading-relaxed" style={{ color: '#ff8a96' }}>
                    {sistersError}
                  </p>
                </div>
              )}
              {!sistersLoading && !sistersError && sisters !== null && sisterCandidates.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center px-8">
                  <p className="text-[11px] text-[#6e7590] text-center leading-relaxed">
                    No related wallets found{relTime === 'All' ? '' : ` active in the last ${relTime}`}.
                    {sisters.note ? <><br />{sisters.note}</> : null}
                  </p>
                </div>
              )}
              {!sistersLoading && !sistersError && sisterCandidates.length > 0 && (
                <>
                  <ConnectionsBubbleMap
                    nodes={bubbleNodes}
                    edges={bubbleEdges}
                    onSelectNode={id => setSelectedNode(prev => prev === id ? null : id)}
                  />
                  <div className="absolute bottom-3 left-4 right-4 text-[9px] text-[#6e7590]">
                    {sisters?.note ? `${sisters.note} · ` : ''}
                    Clustered from Etherscan funding history. Edge labels are transfer counts, not amounts.
                  </div>
                </>
              )}
            </div>

            {/* Side panel */}
            <div style={{ width: '240px', flexShrink: 0 }}>
              {selectedCandidate ? (() => {
                const c = selectedCandidate;
                const node = bubbleNodes.find(n => n.id === c.address);
                const totalTx = c.direct_in + c.direct_out;
                return (
                  <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '12px', padding: '20px', minHeight: '100%' }}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{
                            backgroundColor: node?.fill ?? 'var(--wr-surface)',
                            border: `1px solid ${node?.stroke ?? 'var(--wr-border)'}`,
                            color: node?.textColor ?? 'var(--wr-text)',
                          }}>
                          0x
                        </div>
                        <div>
                          <div className="text-[11px] font-mono text-white font-semibold">{shortAddr(c.address)}</div>
                          <div className="text-[9px] text-[#6e7590]">Link score {c.score}/100</div>
                        </div>
                      </div>
                      <button onClick={() => setSelectedNode(null)} className="text-[#6e7590] text-[12px] hover:text-white">✕</button>
                    </div>

                    {c.reasons.length > 0 ? (
                      <div className="mb-3">
                        {c.reasons.map(r => (
                          <span key={r} className="inline-block text-[8px] font-bold px-2 py-0.5 mb-1 mr-1"
                            style={{ color: '#ffb020', backgroundColor: '#2a1e05' }}>
                            {SISTER_REASON_LABEL[r] ?? r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[9px] text-[#6e7590] mb-3">No link reason recorded.</div>
                    )}

                    <div className="space-y-3">
                      {[
                        { label: 'Tx In',      value: String(c.direct_in),  color: '#4fe9b4' },
                        { label: 'Tx Out',     value: String(c.direct_out), color: '#ff8a96' },
                        { label: 'Score',      value: `${c.score}/100`,     color: 'var(--wr-text)' },
                        { label: 'First Seen', value: fmtUnixDate(c.first_interaction), color: 'var(--wr-text-2)' },
                        { label: 'Last Seen',  value: fmtUnixDate(c.last_interaction),  color: 'var(--wr-text-2)' },
                      ].map(s => (
                        <div key={s.label} className="flex items-center justify-between">
                          <span className="text-[10px] text-[#6e7590] uppercase tracking-wider">{s.label}</span>
                          <span className="text-[11px] font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</span>
                        </div>
                      ))}
                      <div className="pt-3">
                        <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Transfer Direction</div>
                        {totalTx > 0 ? (
                          <>
                            <div className="h-1.5 bg-[#14161f] overflow-hidden rounded-full">
                              <div className="h-full rounded-full"
                                style={{
                                  width: `${Math.min((c.direct_out / totalTx) * 100, 100)}%`,
                                  background: 'linear-gradient(90deg, #ffb020, #ff8a96)',
                                }} />
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className="text-[8px] text-[#4fe9b4]">In</span>
                              <span className="text-[8px] text-[#ff8a96]">Out</span>
                            </div>
                          </>
                        ) : (
                          <div className="text-[9px] text-[#6e7590]">No direct transfers — linked by a shared funder.</div>
                        )}
                      </div>
                      <div className="pt-1">
                        <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">Balance</div>
                        <div className="text-[10px] text-[#6e7590]">Not fetched — open the wallet to load it.</div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 mt-5">
                      <Link
                        href={`/monitor/wallet?raw=${c.address}`}
                        className="text-[10px] font-semibold px-3 py-2 text-center"
                        style={{ color: '#2fc4d6', backgroundColor: '#0e2630', border: '1px solid #0e2630', textDecoration: 'none' }}>
                        Open in Monitor
                      </Link>
                      <a
                        href={`https://etherscan.io/address/${c.address}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-[10px] font-semibold px-3 py-2 text-center"
                        style={{ color: 'var(--wr-accent)', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid #7c5cff33', textDecoration: 'none' }}>
                        View on Etherscan
                      </a>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '12px', padding: '20px', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="text-center">
                    <div className="text-[28px] mb-3 opacity-30">◎</div>
                    <p className="text-[11px] text-[#6e7590] leading-relaxed">
                      {sistersLoading
                        ? 'Loading related wallets…'
                        : sistersError
                          ? 'Related wallets unavailable'
                          : sisterCandidates.length === 0
                            ? 'No related wallets to inspect'
                            : <>Click a node to<br />inspect wallet details</>}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default function MonitorWalletPage() {
  return <Suspense fallback={null}><MonitorWalletInner /></Suspense>;
}
