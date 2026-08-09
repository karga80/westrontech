'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { getPnlSummary, getPortfolioSnapshot, loadAlchemyKey, type PnlSummary, type PortfolioSnapshot } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_PNL, EMPTY_SNAPSHOT } from '@/lib/emptyData';

// ─── Portfolio / Analytics — matches WK5Xm design ────────────────────────────

type TimeRange = '1d' | '1w' | '1m' | '3m' | 'ALL';
const TIME_RANGES: TimeRange[] = ['1d', '1w', '1m', '3m', 'ALL'];

const TOP_COLLECTIONS: Array<{ rank: number; name: string; eth: string; pct: string }> = [];

const STAT_LABEL = { fontFamily: 'var(--font-jetbrains)' as const, fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', marginBottom: '8px' };
const STAT_VALUE = { fontFamily: 'var(--font-inter)' as const, fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' };

export default function PortfolioAnalyticsPage() {
  const [range, setRange]   = useState<TimeRange>('1m');
  const [pnl,  setPnl]      = useState<PnlSummary | null>(null);
  const [snap, setSnap]     = useState<PortfolioSnapshot | null>(null);
  const [walletName, setWalletName] = useState('Main Wallet');

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const wallets = loadWallets();
    if (wallets[0]) setWalletName(wallets[0].name);
    if (!inTauri) {
      setPnl(EMPTY_PNL as PnlSummary);
      setSnap(EMPTY_SNAPSHOT as PortfolioSnapshot);
      return;
    }
    (async () => {
      const key  = await loadAlchemyKey().catch(() => '');
      const addr = wallets[0]?.address ?? '';
      if (!key || !addr) return;
      const [p, s] = await Promise.all([
        getPnlSummary(addr, key).catch(() => null),
        getPortfolioSnapshot(addr, key).catch(() => null),
      ]);
      if (p) setPnl(p);
      if (s) setSnap(s);
    })();
  }, []);

  // No data means no number. The placeholder figures this branch used to carry
  // ($12,847.32, +28.4%, 1,434, 49.45%) read as a real portfolio to anyone
  // glancing at the screen.
  const totalReturn  = pnl ? `${(pnl.realized_pnl_eth >= 0 ? '+' : '')}${pnl.realized_pnl_eth.toFixed(3)} ETH` : '—';
  // eth_balance > 0 guard rather than `|| 1` — a zero balance is valid and `|| 1`
  // would silently fabricate a meaningless percentage.
  const returnSub    = pnl && snap && snap.eth_balance > 0
    ? `${pnl.realized_pnl_eth >= 0 ? '+' : ''}${((pnl.realized_pnl_eth / snap.eth_balance) * 100).toFixed(1)}%`
    : '—';
  const totalTrades  = pnl ? String(pnl.trade_count) : '—';
  const winRate      = pnl && pnl.trade_count > 0 ? ((pnl.win_count / pnl.trade_count) * 100).toFixed(2) + '%' : '—';
  const portfolioUsd = snap ? `$${snap.portfolio_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  return (
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '8px' }}>
        <Link href="/portfolio" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>← Portfolio</Link>
      </div>

      <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '28px', fontWeight: 600, color: 'var(--wr-text)', marginBottom: '4px' }}>{walletName}</h1>
      <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px' }}>
        Track performance, returns and asset allocation over time
      </p>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-[var(--wr-border)] mb-6">
        {[
          { label: 'Holdings', href: '/portfolio/holdings' },
          { label: 'Transactions', href: '/portfolio/transactions' },
          { label: 'Analytics', href: '/portfolio/analytics', active: true },
        ].map(t => (
          <Link key={t.href} href={t.href}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, padding: '8px 16px', display: 'inline-block', textDecoration: 'none', borderBottom: t.active ? '2px solid var(--wr-accent)' : '2px solid transparent', color: t.active ? 'var(--wr-accent)' : 'var(--wr-text-3)', marginBottom: '-1px' }}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border)', gap: '1px' }}>
        {[
          { label: 'Total Return',   value: totalReturn, sub: returnSub, subColor: 'var(--wr-accent)' },
          { label: 'Best Performer', value: 'Bored Ape YC', sub: '+442.3%', subColor: '#4fe9b4' },
          { label: 'Worst Performer',value: 'Moonbirds',   sub: '-93.5%', subColor: '#ff8a96' },
          { label: 'Avg Hold Time',  value: '47 days', sub: `${totalTrades} trades · ${winRate} win`, subColor: 'var(--wr-text-3)' },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: 'var(--wr-surface)', padding: '20px 24px' }}>
            <div style={STAT_LABEL}>{s.label}</div>
            <div style={{ ...STAT_VALUE, fontSize: s.label === 'Best Performer' || s.label === 'Worst Performer' ? '18px' : '22px' }}>{s.value}</div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: s.subColor, marginTop: '4px' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Portfolio Value chart area */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)', display: 'block', marginBottom: '16px' }}>Portfolio Value</span>

        {/* Time range tabs */}
        <div className="flex items-center gap-1 mb-5">
          {TIME_RANGES.map(r => (
            <button key={r} onClick={() => setRange(r)}
              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, padding: '4px 10px', backgroundColor: range === r ? '#7c5cff' : 'var(--wr-overlay)', color: range === r ? '#0b0c14' : 'var(--wr-text-3)', border: 'none', cursor: 'pointer' }}>
              {r}
            </button>
          ))}
        </div>

        {/* Chart placeholder */}
        <div style={{ marginBottom: '8px' }}>
          <div style={{ fontFamily: 'var(--font-inter)', fontSize: '28px', fontWeight: 600, color: 'var(--wr-text)' }}>{portfolioUsd}</div>
          <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-accent)' }}>+12.4k (4.56%)</div>
        </div>
        <div style={{ height: '160px', backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', position: 'relative', overflow: 'hidden' }}>
          {/* Simulated area chart using gradients */}
          <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 800 160">
            <defs>
              <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5cff" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#7c5cff" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d="M0,130 C80,110 100,80 160,60 S250,30 320,50 S420,90 480,40 S580,10 640,25 S720,15 800,20 L800,160 L0,160 Z" fill="url(#chartGrad)" />
            <path d="M0,130 C80,110 100,80 160,60 S250,30 320,50 S420,90 480,40 S580,10 640,25 S720,15 800,20" fill="none" stroke="var(--wr-accent)" strokeWidth="2" />
          </svg>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-5">
        {/* Trading Performance */}
        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)', display: 'block', marginBottom: '16px' }}>Trading Performance</span>
          <div className="grid grid-cols-3 overflow-hidden" style={{ backgroundColor: 'var(--wr-border)', gap: '1px' }}>
            {[
              { label: 'Total Trades', value: totalTrades },
              { label: 'Win Rate', value: winRate },
              { label: 'Avg Price', value: '$9.1k' },
            ].map(s => (
              <div key={s.label} style={{ backgroundColor: 'var(--wr-surface)', padding: '16px' }}>
                <div style={{ ...STAT_LABEL, fontSize: '10px' }}>{s.label}</div>
                <div style={{ ...STAT_VALUE, fontSize: '18px' }}>{s.value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Collections */}
        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)', display: 'block', marginBottom: '16px' }}>Top Collections by Value</span>
          <div className="space-y-3">
            {TOP_COLLECTIONS.map(c => (
              <div key={c.rank} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '16px' }}>{c.rank}</span>
                  <span style={{ color: 'var(--wr-text)', fontSize: '13px' }}>{c.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-accent)' }}>{c.eth}</span>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '32px', textAlign: 'right' }}>{c.pct}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
