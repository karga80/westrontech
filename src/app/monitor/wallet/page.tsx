'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getAssetTransfers, loadAlchemyKey, type AssetTransfer } from '@/lib/tauri';
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


// ── P&L tab data ──────────────────────────────────────────────────────────────
const TOKEN_PNL = [
  {
    name: 'ETH',
    label: 'Ethereum',
    color: '#627eea',
    avgBuy: '$2,142.38',
    avgSell: '$7,021.63',
    realized: { val: '-$81,891.30', pos: false },
    unrealized: { val: '-$2,381.34', pos: false },
    total: { val: '+$4,179.89', pos: true },
  },
  {
    name: 'USDT',
    label: 'Tether',
    color: '#26a17b',
    avgBuy: '$3.98',
    avgSell: '$1.80',
    realized: { val: '+$14.98', pos: true },
    unrealized: { val: '$0.30', pos: true },
    total: { val: '+$85.68', pos: true },
  },
  {
    name: 'MATIC',
    label: 'Polygon',
    color: '#8247e5',
    avgBuy: '$4.19',
    avgSell: '$0.76',
    realized: { val: '-$808.48', pos: false },
    unrealized: { val: '$0.30', pos: true },
    total: { val: '-$418.86', pos: false },
  },
];

const RECENT_TRADES = [
  { token: 'ETH',        tokenColor: '#627eea', name: 'Ethereum',    eth: '$1,396',  pnl: '+$508.44', pnlPos: true,  pct: '+41.8%', pctPos: true,  duration: '2 days' },
  { token: 'BAYC#451',   tokenColor: '#ffb020', name: 'Bored Ape',   eth: '$13,491', pnl: '+$5,765',  pnlPos: true,  pct: '+125.4%',pctPos: true,  duration: '10 days' },
  { token: 'USDC>ETH',   tokenColor: '#26a17b', name: 'Swap',        eth: '$1,886',  pnl: '-$88.82',  pnlPos: false, pct: '-4.61%', pctPos: false, duration: '1 day' },
  { token: 'Azuki#331',  tokenColor: '#a78bfa', name: 'Azuki',       eth: '$9,108',  pnl: '+$973.30', pnlPos: true,  pct: '+9.75%', pctPos: true,  duration: '5 days' },
];

// ── Related Wallets tab data ───────────────────────────────────────────────────
const RELATED_WALLETS = [
  {
    address: '0x1a3…and',
    label: '0x1a3...and',
    tags: [{ text: 'NFT Trace', color: '#ffb020', bg: '#2a1e05' }],
    inflow: 5000,
    outflow: 16954,
    txIn: 5,
    txOut: 1,
    balance: '46,732 ETH',
    action: 'Trade',
  },
  {
    address: '0x4f3…12a68',
    label: '0x4f3...12a68',
    tags: [],
    inflow: 0,
    outflow: 8000,
    txIn: 0,
    txOut: 1,
    balance: '1 ETH',
    action: 'Farm',
  },
  {
    address: '0x1b3…a9879',
    label: '0x1b3...a9879',
    tags: [{ text: 'Discounted', color: '#ffb020', bg: '#2a1e05' }],
    inflow: 270,
    outflow: 1710,
    txIn: 5,
    txOut: 2,
    balance: '0.87 ETH',
    action: 'Trade',
  },
  {
    address: 'Natural/ir…',
    label: 'Natural/ir...',
    tags: [],
    inflow: 0,
    outflow: 1944,
    txIn: 4,
    txOut: 1,
    balance: '2,934 ETH',
    action: 'Trade',
  },
];

// ── SVG helpers ───────────────────────────────────────────────────────────────
function DualPnLChart() {
  const W = 700, H = 100;
  const greenPts = [0.3,0.32,0.28,0.35,0.38,0.42,0.48,0.55,0.52,0.60,0.65,0.70,0.68,0.75,0.72,0.80,0.85,0.82,0.88,0.92,0.90,0.95,1.00];
  const redPts   = [0.10,0.12,0.15,0.12,0.08,0.10,0.12,0.08,0.10,0.12,0.08,0.05,0.08,0.06,0.10,0.08,0.05,0.06,0.04,0.05,0.03,0.04,0.02];
  const n = greenPts.length;
  const midY = H * 0.42;

  const gCoords = greenPts.map((y, i) => ({ x: (i/(n-1))*W, y: midY - y * midY * 0.9 }));
  const rCoords = redPts.map((y, i) => ({ x: (i/(n-1))*W, y: midY + y * (H - midY) * 0.85 }));

  const gLine = gCoords.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
  const gArea = `${gLine} L${W},${midY} L0,${midY} Z`;
  const rLine = rCoords.map((p,i) => `${i===0?'M':'L'}${p.x},${p.y}`).join(' ');
  const rArea = `${rLine} L${W},${midY} L0,${midY} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 100 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="gGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4fe9b4" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#4fe9b4" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="rGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff8a96" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ff8a96" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <line x1="0" y1={midY} x2={W} y2={midY} stroke="#27272a" strokeWidth="0.5" />
      <path d={gArea} fill="url(#gGrad)" />
      <path d={gLine} fill="none" stroke="#4fe9b4" strokeWidth="1.5" />
      <path d={rArea} fill="url(#rGrad)" />
      <path d={rLine} fill="none" stroke="#ff8a96" strokeWidth="1.5" />
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
const BUBBLE_NODES = [
  { id: 'center', label: '0x7034…a122e', sub: 'This Wallet',   x: 450, y: 258, r: 44, fill: '#3b1f7a', stroke: '#a78bfa', textColor: '#f2f2f7' },
  { id: 'n1',     label: '0x1a3…and',    sub: '$21.9K Flow',   x: 672, y: 148, r: 30, fill: '#3d0f0f', stroke: '#ff8a96', textColor: '#ff8a96' },
  { id: 'n2',     label: '0x4f3…12a68',  sub: '$8K Out',       x: 648, y: 378, r: 26, fill: '#0f1f3d', stroke: '#90a6ff', textColor: '#90a6ff' },
  { id: 'n3',     label: '0x1b3…a9879',  sub: '$1.98K Flow',   x: 228, y: 358, r: 22, fill: '#1a0a2e', stroke: '#c084fc', textColor: '#c084fc' },
  { id: 'n4',     label: 'Natural/ir…',  sub: '$1.9K Out',     x: 262, y: 128, r: 20, fill: '#032232', stroke: '#2fc4d6', textColor: '#2fc4d6' },
  { id: 'n5',     label: 'Exchange',      sub: 'CEX Hub',       x: 840, y: 235, r: 15, fill: '#231500', stroke: '#ffb020', textColor: '#ffb020' },
  { id: 'n6',     label: 'DeFi Pool',     sub: 'Contract',      x: 118, y: 265, r: 13, fill: '#012318', stroke: '#4fe9b4', textColor: '#4fe9b4' },
];

const BUBBLE_EDGES = [
  { from: 'center', to: 'n1', color: '#ff8a96', width: 2.2, label: '16.9K', dashed: false },
  { from: 'n1',     to: 'center', color: '#4fe9b4', width: 1.2, label: '5K',    dashed: true  },
  { from: 'center', to: 'n2', color: '#ff8a96', width: 1.8, label: '8K',    dashed: false },
  { from: 'center', to: 'n3', color: '#ff8a96', width: 1.2, label: '1.7K',  dashed: false },
  { from: 'n3',     to: 'center', color: '#4fe9b4', width: 0.8, label: '270',   dashed: true  },
  { from: 'center', to: 'n4', color: '#ff8a96', width: 1.2, label: '1.9K',  dashed: false },
  { from: 'n1',     to: 'n5', color: '#ffb020', width: 1.0, label: '',      dashed: true  },
  { from: 'n3',     to: 'n6', color: '#4fe9b4', width: 0.8, label: '',      dashed: true  },
];

const NODE_TAGS: Record<string, { text: string; color: string; bg: string }[]> = {
  n1: [{ text: 'NFT Trace', color: '#ffb020', bg: '#2a1e05' }],
  n3: [{ text: 'Discounted', color: '#ffb020', bg: '#2a1e05' }],
};

function ConnectionsBubbleMap({ onSelectNode }: { onSelectNode: (id: string) => void }) {
  const nodeMap = Object.fromEntries(BUBBLE_NODES.map(n => [n.id, n]));

  return (
    <svg viewBox="0 0 960 510" className="w-full" style={{ height: '100%' }} xmlns="http://www.w3.org/2000/svg">
      <defs>
        {/* Glow filters per node */}
        {BUBBLE_NODES.map(n => (
          <filter key={n.id} id={`glow-${n.id}`} x="-60%" y="-60%" width="220%" height="220%">
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
      </defs>

      {/* ── Edges ── */}
      {BUBBLE_EDGES.map((e, i) => {
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
        const markerId = e.color === '#4fe9b4' ? 'arrow-in' : 'arrow-out';
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
                ${e.label}
              </text>
            )}
          </g>
        );
      })}

      {/* ── Nodes ── */}
      {BUBBLE_NODES.map(n => {
        const tags = NODE_TAGS[n.id] ?? [];
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
              filter={`url(#glow-${n.id})`} />
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
            {/* Tags */}
            {tags.map((tag, ti) => (
              <g key={ti}>
                <rect x={n.x - 28} y={n.y + n.r + 28 + ti * 14} width="56" height="12" rx="2" fill={tag.bg} opacity="0.9" />
                <text x={n.x} y={n.y + n.r + 37 + ti * 14} textAnchor="middle" fill={tag.color} fontSize="7.5" fontWeight="700"
                  style={{ fontFamily: 'var(--font-jetbrains)' }}>
                  {tag.text}
                </text>
              </g>
            ))}
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

function WalletHeader({ tab, setTab, display, address, raw }: {
  tab: Tab;
  setTab: (t: Tab) => void;
  display: string;
  address: string;
  raw: string;
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
            <a href={`https://etherscan.io/address/${raw}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#6e7590] hover:text-[#9298b8] transition-colors flex">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
          </div>
          <span className="text-[#6e7590] text-[11px] mt-0.5 font-mono">{raw}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-4">
        <div className="bg-[#14161f] border border-[#14161f] px-6 py-4 min-w-[180px]">
          <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Native Token Balance</div>
          <div className="text-[18px] font-bold text-white leading-none">4.32 <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></div>
          <div className="text-[11px] text-[#6e7590] mt-1">$11,232</div>
        </div>
        <div className="bg-[#14161f] border border-[#14161f] px-6 py-4 min-w-[180px]">
          <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Portfolio Value</div>
          <div className="text-[18px] font-bold text-white leading-none">18.7 <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></div>
          <div className="text-[11px] text-[#6e7590] mt-1">$48,620</div>
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

  const walletAddress = searchParams.get('address') ?? '0x7034…a122e';
  const walletLabel   = searchParams.get('label') ?? '';
  const walletRaw     = searchParams.get('raw') ?? '0x7034a122e5a4b0f7f6b4a3e9d8c21045b7f3a122e';
  const walletDisplay = walletLabel || walletAddress;

  useEffect(() => {
    if (searchParams.get('tab') === 'connections') setTab('Connections');
  }, [searchParams]);
  const [feedFilters, setFeedFilters] = useState<Set<string>>(new Set());
  const [feedTimeRange, setFeedTimeRange] = useState<'1d' | '7d' | '30d' | 'all'>('all');
  const [pnlTime, setPnlTime] = useState<TimeFilter>('7d');
  const [statsTime, setStatsTime] = useState<TimeFilter>('3M');
  const [relTime, setRelTime] = useState<TimeFilter>('30d');
  const [liveFeed, setLiveFeed] = useState<FeedItem[] | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';

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

    if (!inTauri) return;
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (!key || !addr) return;
      const transfers = await getAssetTransfers(addr, key).catch(() => [] as AssetTransfer[]);
      setLiveFeed(transfers.map(toFeedItem));
    })();
  }, []);

  return (
    <div className="min-h-full flex flex-col" style={{ backgroundColor: 'var(--wr-bg)', color: 'var(--wr-text)' }}>
      <WalletHeader tab={tab} setTab={setTab} display={walletDisplay} address={walletAddress} raw={walletRaw} />

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
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', flex: 1, wordBreak: 'break-all', lineHeight: 1.6 }}>
                      0x7034a122e5a4b0f7f6b4a3e9d8c21045b7f3a122e
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => navigator.clipboard.writeText('0x7034a122e5a4b0f7f6b4a3e9d8c21045b7f3a122e')}
                        className="transition-colors"
                        style={{ color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                        title="Copy address"
                      >
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                          <rect x="5" y="5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.1"/>
                          <path d="M2 9V3C2 2.4 2.4 2 3 2H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
                        </svg>
                      </button>
                      <a href="https://etherscan.io/address/0x7034a122e5a4b0f7f6b4a3e9d8c21045b7f3a122e" target="_blank" rel="noopener noreferrer" className="transition-colors flex" style={{ color: 'var(--wr-text-3)' }} title="View on Etherscan">
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
              {(liveFeed ?? []).filter(item => {
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
                {TOKEN_PNL.map(tok => (
                  <div key={tok.name} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1.2fr 1.2fr 1.2fr' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                        style={{ backgroundColor: tok.color }}>{tok.name[0]}</span>
                      <div>
                        <div className="text-[12px] text-white font-medium">{tok.name}</div>
                        <div className="text-[9px] text-[#6e7590]">{tok.label}</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{tok.avgBuy}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{tok.avgSell}</div>
                    <div className={`text-[11px] font-medium tabular-nums ${tok.realized.pos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{tok.realized.val}</div>
                    <div className={`text-[11px] tabular-nums ${tok.unrealized.pos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{tok.unrealized.val}</div>
                    <div className={`text-[11px] font-bold tabular-nums ${tok.total.pos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{tok.total.val}</div>
                  </div>
                ))}
              </div>
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

              {/* KPI row */}
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Total P&L',       value: '+$4,821.30', sub: '+11.4%',              pos: true },
                  { label: 'Realized P&L',    value: '+$2,340.00', sub: 'from 20 trades',      pos: true },
                  { label: 'Unrealized P&L',  value: '+$2,481.30', sub: 'across 11 positions', pos: true },
                  { label: 'Win Rate',        value: '72.2%',      sub: '15/21 trades',        pos: true },
                ].map(k => (
                  <div key={k.label} className="bg-[#14161f] border border-[#14161f] px-4 py-3">
                    <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-1">{k.label}</div>
                    <div className={`text-[18px] font-bold ${k.pos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{k.value}</div>
                    <div className="text-[9px] text-[#6e7590] mt-0.5">{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="bg-[#14161f] border border-[#14161f] px-4 py-3">
                <div className="text-[11px] text-[#4fe9b4] font-bold mb-1">+$4,821.30</div>
                <div className="text-[9px] text-[#6e7590] mb-3">+ Last PnL</div>
                <DualPnLChart />
              </div>
            </div>

            {/* RECENT TRADES */}
            <div>
              <p className="text-[9px] font-bold text-[#6e7590] uppercase tracking-widest mb-3">Recent Trades</p>
              <div className="border border-[#14161f] overflow-hidden">
                <div className="grid border-b border-[#14161f] px-4 py-2"
                  style={{ backgroundColor: 'var(--wr-surface)', gridTemplateColumns: '1.2fr 1fr 0.8fr 1fr 0.6fr 0.8fr' }}>
                  {['Token','Name','ETH','PnL','%','Duration'].map(h => (
                    <span key={h} className="text-[9px] text-[#6e7590] uppercase tracking-wider">{h}</span>
                  ))}
                </div>
                {RECENT_TRADES.map((t, i) => (
                  <div key={i} className="grid items-center px-4 py-3 border-b border-[#14161f] last:border-0 transition-colors"
                    style={{ gridTemplateColumns: '1.2fr 1fr 0.8fr 1fr 0.6fr 0.8fr' }} onMouseEnter={hoverOn} onMouseLeave={hoverOff}>
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] text-white font-bold shrink-0"
                        style={{ backgroundColor: t.tokenColor }}>{t.token[0]}</span>
                      <span className="text-[11px] text-white font-mono">{t.token}</span>
                    </div>
                    <div className="text-[11px] text-[#9298b8]">{t.name}</div>
                    <div className="text-[11px] text-[#9298b8] tabular-nums">{t.eth}</div>
                    <div className={`text-[11px] font-medium tabular-nums ${t.pnlPos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{t.pnl}</div>
                    <div className={`text-[11px] tabular-nums ${t.pctPos ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>{t.pct}</div>
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
              {/* Legend */}
              <div className="absolute top-3 left-4 flex items-center gap-4 z-10">
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-px bg-[#ff8a96]" />
                  <span className="text-[9px] text-[#6e7590]">Outflow</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 border-t border-dashed border-[#4fe9b4]" />
                  <span className="text-[9px] text-[#6e7590]">Inflow</span>
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
              <ConnectionsBubbleMap onSelectNode={id => setSelectedNode(prev => prev === id ? null : id)} />
            </div>

            {/* Side panel */}
            <div style={{ width: '240px', flexShrink: 0 }}>
              {selectedNode ? (() => {
                const node = BUBBLE_NODES.find(n => n.id === selectedNode);
                const relIdx = ['n1','n2','n3','n4'].indexOf(selectedNode);
                const relW = relIdx >= 0 ? RELATED_WALLETS[relIdx] : undefined;
                if (!node) return null;
                return (
                  <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '12px', padding: '20px', minHeight: '100%' }}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-[9px] font-bold"
                          style={{ backgroundColor: node.fill, border: `1px solid ${node.stroke}`, color: node.textColor }}>
                          0x
                        </div>
                        <div>
                          <div className="text-[11px] font-mono text-white font-semibold">{node.label}</div>
                          <div className="text-[9px] text-[#6e7590]">{node.sub}</div>
                        </div>
                      </div>
                      <button onClick={() => setSelectedNode(null)} className="text-[#6e7590] text-[12px] hover:text-white">✕</button>
                    </div>
                    {(NODE_TAGS[selectedNode] ?? []).map(t => (
                      <span key={t.text} className="inline-block text-[8px] font-bold px-2 py-0.5 mb-3 mr-1"
                        style={{ color: t.color, backgroundColor: t.bg }}>{t.text}</span>
                    ))}
                    {relW && (
                      <div className="space-y-3">
                        {[
                          { label: 'Inflow',  value: relW.inflow > 0 ? `$${relW.inflow.toLocaleString()}` : '$0', color: '#4fe9b4' },
                          { label: 'Outflow', value: `$${relW.outflow.toLocaleString()}`, color: '#ff8a96' },
                          { label: 'Tx In',   value: String(relW.txIn),   color: 'var(--wr-text-2)' },
                          { label: 'Tx Out',  value: String(relW.txOut),  color: 'var(--wr-text-2)' },
                          { label: 'Balance', value: relW.balance,        color: 'var(--wr-text)' },
                        ].map(s => (
                          <div key={s.label} className="flex items-center justify-between">
                            <span className="text-[10px] text-[#6e7590] uppercase tracking-wider">{s.label}</span>
                            <span className="text-[11px] font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</span>
                          </div>
                        ))}
                        <div className="pt-3">
                          <div className="text-[9px] text-[#6e7590] uppercase tracking-wider mb-2">Flow Ratio</div>
                          <div className="h-1.5 bg-[#14161f] overflow-hidden rounded-full">
                            <div className="h-full rounded-full"
                              style={{
                                width: `${Math.min((relW.outflow / (relW.inflow + relW.outflow || 1)) * 100, 100)}%`,
                                background: 'linear-gradient(90deg, #ffb020, #ff8a96)',
                              }} />
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-[8px] text-[#4fe9b4]">In</span>
                            <span className="text-[8px] text-[#ff8a96]">Out</span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-col gap-2 mt-5">
                      <button className="text-[10px] font-semibold px-3 py-2"
                        style={{ color: '#2fc4d6', backgroundColor: '#0e2630', border: '1px solid #0e2630' }}>
                        Track Wallet
                      </button>
                      <button className="text-[10px] font-semibold px-3 py-2"
                        style={{ color: 'var(--wr-accent)', backgroundColor: 'var(--wr-accent-dim)', border: '1px solid #7c5cff33' }}>
                        Create Alert
                      </button>
                    </div>
                  </div>
                );
              })() : (
                <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '12px', padding: '20px', minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="text-center">
                    <div className="text-[28px] mb-3 opacity-30">◎</div>
                    <p className="text-[11px] text-[#6e7590] leading-relaxed">
                      Click a node to<br />inspect wallet details
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
