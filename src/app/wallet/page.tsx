'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getPortfolioSnapshot, getPnlSummary, loadAlchemyKey, type PortfolioSnapshot } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_SNAPSHOT } from '@/lib/emptyData';

// ─── Wallet Detail — matches 0G1do / WK5Xm design ────────────────────────────

const NFT_HOLDINGS = [
  { name: 'Bored Ape YC',      color: '#ffb020', count: 6,  floor: '23.5 ETH', change: '-7.3%',   neg: true,  topPrice: '24.8 ETH',  vol24h: '142.5 ETH', sales24h: 0,   supply: 10000, avgPa: '14,998' },
  { name: 'Azuki',             color: '#ff8a96', count: 5,  floor: '34.2 ETH', change: '-1.7%',   neg: true,  topPrice: '41.5 ETH',  vol24h: '53.42 ETH', sales24h: 13,  supply: 5821,  avgPa: '10,200' },
  { name: 'Doodles',           color: '#90a6ff', count: 12, floor: '2.9 ETH',  change: '+8.3%',   neg: false, topPrice: '3.4 ETH',   vol24h: '14.22 ETH', sales24h: 9,   supply: 10000, avgPa: '12,000' },
  { name: 'Clonex',            color: '#a78bfa', count: 8,  floor: '4.1 ETH',  change: '-1.1%',   neg: true,  topPrice: '-4.8 ETH',  vol24h: '28.4 ETH',  sales24h: 9,   supply: 9534,  avgPa: '26,008' },
  { name: 'Pudge Penguins',    color: '#4fe9b4', count: 19, floor: '7.4 ETH',  change: '+0.40%',  neg: false, topPrice: '7.2 ETH',   vol24h: '42.64 ETH', sales24h: 14,  supply: 8888,  avgPa: '3,988' },
];

const TOKEN_HOLDINGS = [
  { name: 'Chain Nunku',   ticker: 'CNKU',  color: '#ffb020', holding: '$3,254,000', price: '$9,40.03',  change24h: '+137.2%', change30: '+1,225.3%',  change200: '-28.10%', day90: '0.65',  ppt: '$57.44' },
  { name: 'Chuck Norris Top…', ticker: 'NRTS', color: '#90a6ff', holding: '$3,480,000', price: '$9,00.837', change24h: '-3.00%',  change30: '+4,336.7%',  change200: '+29.3%',  day90: '$164.99', ppt: '$225.38' },
  { name: 'Deathskynet…',  ticker: 'STXXX', color: '#a78bfa', holding: '$940,000',   price: '$9,0065',   change24h: '-78.1%',  change30: '-17,135.4%', change200: '+953.40', day90: '$1.84',   ppt: '$755.84' },
  { name: 'Lum',          ticker: 'LUM',   color: '#4fe9b4', holding: '$40,000',    price: '$9,0062',   change24h: '-4.63%',  change30: '-557.1%',    change200: '-327.2%', day90: '$8.71',   ppt: '$220.59' },
  { name: 'Ethereum Mists…', ticker: 'MSTR', color: '#00bcd4', holding: '$7,168,000', price: '($4,145)',  change24h: '+112.2%', change30: '-197.2%',    change200: '-427.38', day90: '$15.18',  ppt: '$14.94' },
  { name: 'The Crypto…',  ticker: 'CRPT',  color: '#ff8a96', holding: '$3,660,000', price: '$6,017',    change24h: '-957.40', change30: '-',          change200: '-',       day90: '-',       ppt: '-' },
];

const TOP_COLLECTIONS = [
  { name: 'Bored Ape Yacht Club', eth: '11.4 ETH', pct: 21 },
  { name: 'Azuki',                eth: '8.7 ETH',  pct: 32 },
  { name: 'Phillip Penguins',     eth: '5.1 ETH',  pct: 17 },
  { name: 'Doodles',              eth: '3.8 ETH',  pct: 6  },
  { name: 'Moonbirds',            eth: '5.1 ETH',  pct: 4  },
];

// Simple SVG area chart data (normalised 0–1)
const CHART_POINTS = [
  0.55, 0.50, 0.45, 0.48, 0.52, 0.42, 0.38, 0.41, 0.36, 0.30, 0.35, 0.28,
  0.32, 0.25, 0.30, 0.38, 0.34, 0.40, 0.48, 0.55, 0.62, 0.58, 0.65, 0.72,
  0.68, 0.75, 0.70, 0.80, 0.85, 0.78, 0.88, 0.82, 0.90, 0.95, 0.88, 0.92,
  0.85, 0.90, 0.95, 1.00,
];

function AreaChart() {
  const W = 560;
  const H = 120;
  const pts = CHART_POINTS;
  const n = pts.length;

  const coords = pts.map((y, i) => ({
    x: (i / (n - 1)) * W,
    y: H - y * H * 0.92 - 4,
  }));

  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '120px' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#chartGrad)" />
      <path d={linePath} fill="none" stroke="#7c5cff" strokeWidth="1.5" />
    </svg>
  );
}

type Tab = 'Holdings' | 'Transactions' | 'Analytics';
const TIME_FILTERS = ['24h', '1W', '1M', 'ALL'] as const;

export default function WalletPage() {
  const [tab, setTab] = useState<Tab>('Holdings');
  const [timeFilter, setTimeFilter] = useState<string>('24h');
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [walletName, setWalletName] = useState('Main Wallet');
  const [unrealizedPnl, setUnrealizedPnl] = useState('—');

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const wallets = loadWallets();
    if (wallets[0]) setWalletName(wallets[0].name);
    if (!inTauri) { setSnap(EMPTY_SNAPSHOT as PortfolioSnapshot); return; }
    (async () => {
      const key  = await loadAlchemyKey().catch(() => '');
      const addr = wallets[0]?.address ?? '';
      if (!key || !addr) return;
      const [s, pnl] = await Promise.all([
        getPortfolioSnapshot(addr, key).catch(() => null),
        getPnlSummary(addr, key).catch(() => null),
      ]);
      if (s) setSnap(s);
      if (pnl) {
        const net = pnl.unrealized_pnl_eth;
        setUnrealizedPnl((net >= 0 ? '+' : '') + net.toFixed(3) + ' ETH');
      }
    })();
  }, []);

  const totalValue  = snap ? `$${snap.portfolio_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$284,521.48';
  const totalNfts   = snap?.nft_count   ?? 47;
  const totalTokens = snap?.token_count ?? 12;

  return (
    <main className="min-h-full bg-[#0b0c14] text-white px-12 py-8">

      {/* Breadcrumb */}
      <div className="mb-3">
        <Link href="/" className="text-[#6e7590] text-[11px] hover:text-[#9298b8] transition-colors">
          ← Portfolio
        </Link>
      </div>

      {/* Page title */}
      <div className="mb-1">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 700, color: 'var(--wr-text)', lineHeight: '1.2' }}>{walletName}</h1>
        <p className="text-[#6e7590] text-[11px] mt-0.5">Track and manage your wallet performance and assets over time.</p>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-0 mt-5 mb-6 border-b border-[#14161f]">
        {(['Holdings', 'Transactions', 'Analytics'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-[12px] font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'text-[#7c5cff] border-[#7c5cff]'
                : 'text-[#6e7590] border-transparent hover:text-[#9298b8]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── HOLDINGS TAB ── */}
      {tab === 'Holdings' && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-2">Total Value</p>
              <p className="text-[20px] font-bold">{totalValue}</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-2">Total NFTs</p>
              <p className="text-[20px] font-bold">{totalNfts}</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-2">Total Tokens</p>
              <p className="text-[20px] font-bold">{totalTokens}</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-2">Unrealized PnL</p>
              <p className="text-[20px] font-bold text-[#4fe9b4]">{unrealizedPnl}</p>
            </div>
          </div>

          {/* NFT Holdings */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-[#6e7590] uppercase tracking-widest">NFT Holdings</h2>
              <button className="flex items-center gap-1.5 bg-[#7c5cff] text-black text-[11px] font-bold px-3 py-1.5 hover:opacity-90 transition-opacity">
                Bulk Actions →
              </button>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] overflow-hidden">
              {/* Header */}
              <div className="grid px-4 py-2 border-b border-[#14161f]"
                style={{ gridTemplateColumns: '2fr 60px 80px 70px 80px 90px 80px 60px 70px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#6e7590' }}>
                <div>Collection</div>
                <div className="text-right">ETH#s</div>
                <div className="text-right">Floor Price</div>
                <div className="text-right">2h Change</div>
                <div className="text-right">Top Price#</div>
                <div className="text-right">24h Vol</div>
                <div className="text-right">24h Sales</div>
                <div className="text-right">Supply</div>
                <div className="text-right">Avg P/A</div>
              </div>
              {/* Rows */}
              {NFT_HOLDINGS.map((nft) => (
                <div
                  key={nft.name}
                  className="grid px-4 py-3 border-b border-[#14161f] last:border-b-0 items-center hover:bg-[#14161f]/50 transition-colors"
                  style={{ gridTemplateColumns: '2fr 60px 80px 70px 80px 90px 80px 60px 70px' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-7 h-7 shrink-0 flex items-center justify-center text-[10px] font-bold text-black"
                      style={{ backgroundColor: nft.color }}
                    >
                      {nft.name[0]}
                    </span>
                    <span className="text-[12px] text-white font-medium">{nft.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-bold text-black px-1.5 py-0.5" style={{ backgroundColor: nft.color }}>
                      {nft.count}
                    </span>
                  </div>
                  <div className="text-right text-[12px] text-[#9298b8]">{nft.floor}</div>
                  <div className={`text-right text-[12px] font-medium ${nft.neg ? 'text-[#ff8a96]' : 'text-[#4fe9b4]'}`}>
                    {nft.change}
                  </div>
                  <div className="text-right text-[12px] text-[#9298b8]">{nft.topPrice}</div>
                  <div className="text-right text-[12px] text-[#9298b8]">{nft.vol24h}</div>
                  <div className="text-right text-[12px] text-[#6e7590]">{nft.sales24h || '—'}</div>
                  <div className="text-right text-[12px] text-[#6e7590]">{nft.supply.toLocaleString()}</div>
                  <div className="text-right text-[12px] text-[#6e7590]">{nft.avgPa}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Token Holdings */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-semibold text-[#6e7590] uppercase tracking-widest">Token Holdings</h2>
              <button className="flex items-center gap-1.5 bg-[#7c5cff] text-black text-[11px] font-bold px-3 py-1.5 hover:opacity-90 transition-opacity">
                Bulk Actions →
              </button>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] overflow-hidden">
              {/* Header */}
              <div className="grid px-4 py-2 border-b border-[#14161f]"
                style={{ gridTemplateColumns: '2fr 100px 90px 80px 90px 80px 70px 70px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#6e7590' }}>
                <div>Token</div>
                <div className="text-right">Holdings</div>
                <div className="text-right">Price</div>
                <div className="text-right">24h Change</div>
                <div className="text-right">30d Change</div>
                <div className="text-right">200d Change</div>
                <div className="text-right">90 Day</div>
                <div className="text-right">PPT</div>
              </div>
              {TOKEN_HOLDINGS.map((tok) => (
                <div
                  key={tok.name}
                  className="grid px-4 py-3 border-b border-[#14161f] last:border-b-0 items-center hover:bg-[#14161f]/50 transition-colors"
                  style={{ gridTemplateColumns: '2fr 100px 90px 80px 90px 80px 70px 70px' }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-black"
                      style={{ backgroundColor: tok.color }}
                    >
                      {tok.ticker[0]}
                    </span>
                    <div>
                      <div className="text-[12px] text-white font-medium">{tok.name}</div>
                      <div className="text-[10px] text-[#6e7590]">{tok.ticker}</div>
                    </div>
                  </div>
                  <div className="text-right text-[12px] font-bold text-white">{tok.holding}</div>
                  <div className="text-right text-[12px] text-[#9298b8]">{tok.price}</div>
                  <div className={`text-right text-[12px] font-medium ${tok.change24h.startsWith('+') ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                    {tok.change24h}
                  </div>
                  <div className={`text-right text-[12px] ${tok.change30.startsWith('+') ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                    {tok.change30}
                  </div>
                  <div className={`text-right text-[12px] ${tok.change200 === '-' ? 'text-[#6e7590]' : tok.change200.startsWith('+') ? 'text-[#4fe9b4]' : 'text-[#ff8a96]'}`}>
                    {tok.change200}
                  </div>
                  <div className="text-right text-[12px] text-[#9298b8]">{tok.day90}</div>
                  <div className="text-right text-[12px] text-[#9298b8]">{tok.ppt}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {tab === 'Transactions' && (
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <p className="text-[#6e7590] text-[13px]">Transaction history coming soon.</p>
          </div>
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === 'Analytics' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1.5">Total Action</p>
              <p className="text-[20px] font-bold">$12,847.32</p>
              <p className="text-[#4fe9b4] text-[11px] mt-1">+28.4%</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1.5">Best Performer</p>
              <p className="text-[16px] font-bold leading-tight">Bored Ape YC</p>
              <p className="text-[#4fe9b4] text-[11px] mt-1">+42.1%</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1.5">Worst Performer</p>
              <p className="text-[16px] font-bold leading-tight">Moonbirds</p>
              <p className="text-[#ff8a96] text-[11px] mt-1">-33.5%</p>
            </div>
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1.5">Avg Hold Time</p>
              <p className="text-[20px] font-bold">47 days</p>
              <p className="text-[#6e7590] text-[11px] mt-1">avg last 32 trades</p>
            </div>
          </div>

          {/* Portfolio Value chart */}
          <div className="bg-[#14161f] border border-[#14161f] p-5 mb-6">
            <p className="text-[10px] font-semibold text-[#6e7590] uppercase tracking-widest mb-4">Portfolio Value</p>

            {/* Time filters */}
            <div className="flex items-center gap-1 mb-4">
              {TIME_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setTimeFilter(f)}
                  className={`px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                    timeFilter === f
                      ? 'bg-[#7c5cff] text-black'
                      : 'text-[#6e7590] hover:text-[#9298b8]'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>

            {/* Value label */}
            <div className="mb-2">
              <p className="text-[22px] font-bold">$284,521.40</p>
              <p className="text-[#4fe9b4] text-[11px]">+12.4% (USD)</p>
            </div>

            {/* Chart */}
            <div className="mt-4">
              <AreaChart />
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-2 gap-4">

            {/* Trading Performance */}
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[10px] font-semibold text-[#6e7590] uppercase tracking-widest mb-5">Trading Performance</p>
              <div className="flex items-end gap-8">
                <div>
                  <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1">Total Trades</p>
                  <p className="text-[20px] font-bold">1,434</p>
                </div>
                <div>
                  <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1">Win Rate</p>
                  <p className="text-[28px] font-bold text-[#7c5cff]">49.45%</p>
                </div>
                <div>
                  <p className="text-[#6e7590] text-[10px] uppercase tracking-wider mb-1">Avg Price</p>
                  <p className="text-[20px] font-bold">$9.1k</p>
                </div>
              </div>
            </div>

            {/* Top Collections by Value */}
            <div className="bg-[#14161f] border border-[#14161f] p-5">
              <p className="text-[10px] font-semibold text-[#6e7590] uppercase tracking-widest mb-4">Top Collections by Value</p>
              <div className="space-y-2.5">
                {TOP_COLLECTIONS.map((col, i) => (
                  <div key={col.name} className="flex items-center gap-3">
                    <span className="text-[#6e7590] text-[10px] w-4 shrink-0">{i + 1}</span>
                    <span className="text-[12px] text-white flex-1">{col.name}</span>
                    <span className="text-[12px] text-[#9298b8] tabular-nums">{col.eth}</span>
                    <span className="text-[11px] text-[#6e7590] w-8 text-right tabular-nums">{col.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        </>
      )}
    </main>
  );
}
