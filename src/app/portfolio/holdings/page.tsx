'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { getPortfolioSnapshot, loadAlchemyKey, type PortfolioSnapshot } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_SNAPSHOT } from '@/lib/emptyData';
import { Tag, type TagVariant } from '@/components/Tag';

// ─── Portfolio / Holdings — matches 0G1do design ─────────────────────────────

const NFT_HOLDINGS = [
  { collection: 'Bored Ape YC', items: 3,  floor: '23.5 ETH', change: '-1.2%', topOffer: '26.9 ETH', p14: '142.5 ETH', p30: '53.42 ETH', ld: 13, rentals: 'S.422', items2: '14,900', changeColor: '#ff8a96' },
  { collection: 'Azuki',        items: 5,  floor: '34.2 ETH', change: '-1.4%', topOffer: '31.5 ETH', p14: '53.62 ETH', p30: '170.47 ETH', ld: 11, rentals: 'S.431', items2: '18,300', changeColor: '#ff8a96' },
  { collection: 'Doodles',      items: 12, floor: '2.9 ETH',  change: '+0.3%', topOffer: '7.6 9021', p14: '58.42 ETH', p30: '49.40 ETH', ld: 34, rentals: 'S.321', items2: '18,300', changeColor: '#4fe9b4' },
  { collection: 'Moonbirds',    items: 2,  floor: '4.1 ETH',  change: '-1.3%', topOffer: '-4.9 81.4', p14: '25.6 638', p30: '36.5 638', ld: 3, rentals: 'S.554', items2: '25,300', changeColor: '#ff8a96' },
  { collection: 'Pudgy Penguins', items: 19, floor: '7.4 ETH', change: '+0.65', topOffer: '7.3 9073', p14: '62.8A ETH', p30: '36.2 3698', ld: 3, rentals: 'S.301', items2: '3.900', changeColor: '#4fe9b4' },
];

const TOKEN_HOLDINGS: { token: string; badge: string; variant: TagVariant; holdings: string; price: string; change24: string; change3d: string; change7d: string; change30d: string; pnl: string; pnlColor: string }[] = [
  { token: 'Chainlink',       badge: 'LINK', variant: 'info',    holdings: '$1,254,400', price: '$0.6302',  change24: '+177.2%', change3d: '+1.65%',  change7d: '+1.65%',  change30d: '+2.35%', pnl: '$457.44', pnlColor: '#4fe9b4' },
  { token: 'Shiba Inu Moon',  badge: 'SHIB', variant: 'warning', holdings: '$1,445,900', price: '$0.0002',  change24: '-7404',   change3d: '+1.219%', change7d: '+75.3%',  change30d: '+32.6%', pnl: '$225.30', pnlColor: '#4fe9b4' },
  { token: 'Starry Moon ETH', badge: 'SME',  variant: 'purple',  holdings: '$940,000',   price: '$0.0082',  change24: '-2.74%',  change3d: '-7.134%', change7d: '+0.75%',  change30d: '-0.93%', pnl: '$763.84', pnlColor: '#4fe9b4' },
  { token: 'Luna',            badge: 'LUNA', variant: 'danger',  holdings: '$40,000',    price: '$1.22',    change24: '-2.1%',   change3d: '-4.5%',   change7d: '-1.75%',  change30d: '+6.75%', pnl: '$102.40', pnlColor: '#4fe9b4' },
  { token: 'Ethereum Meta...', badge: 'EMT', variant: 'info',    holdings: '$7,146,000', price: '-$6.595', change24: '+112.2%', change3d: '-107.3%', change7d: '-15.75%', change30d: '-67.2%', pnl: '$43.30',  pnlColor: '#4fe9b4' },
  { token: 'The Dogeth...',   badge: 'DOGE', variant: 'accent',  holdings: '$1,665,100', price: '$0.6127',  change24: '-97.80%', change3d: '-4.75%',  change7d: '-4.12%',  change30d: '-6.3%',  pnl: '$224.80', pnlColor: '#4fe9b4' },
];

const STAT_LABEL = { fontFamily: 'var(--font-jetbrains)' as const, fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase' as const, color: 'var(--wr-text-3)', marginBottom: '6px' };
const STAT_VALUE = { fontFamily: 'var(--font-inter)' as const, fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' };

export default function PortfolioHoldingsPage() {
  const [snap, setSnap] = useState<PortfolioSnapshot | null>(null);
  const [walletName, setWalletName] = useState('Main Wallet');

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const wallets = loadWallets();
    if (wallets[0]) setWalletName(wallets[0].name);
    if (!inTauri) { setSnap(EMPTY_SNAPSHOT as PortfolioSnapshot); return; }
    (async () => {
      const key  = await loadAlchemyKey().catch(() => '');
      const addr = wallets[0]?.address ?? '';
      if (key && addr) {
        const s = await getPortfolioSnapshot(addr, key).catch(() => null);
        if (s) setSnap(s);
      }
    })();
  }, []);

  const totalValue  = snap ? `$${snap.portfolio_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$284,521.40';
  const totalNfts   = snap?.nft_count   ?? 47;
  const totalTokens = snap?.token_count ?? 12;

  return (
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '8px' }}>
        <Link href="/portfolio" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>← Portfolio</Link>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '28px', fontWeight: 600, color: 'var(--wr-text)' }}>{walletName}</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[var(--wr-surface)] border border-[var(--wr-border)] px-3 py-2" style={{ width: '220px' }}>
            <span style={{ color: 'var(--wr-text-3)', fontSize: '12px' }}>⌕</span>
            <input placeholder="Search assets..." className="bg-transparent text-white text-[12px] focus:outline-none flex-1 placeholder-[#6e7590]" style={{ fontFamily: 'var(--font-jetbrains)' }} />
          </div>
          <Link href="/portfolio/analytics">
            <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#0b0c14', backgroundColor: '#7c5cff', border: 'none', padding: '8px 16px', cursor: 'pointer' }}>
              Analytics →
            </button>
          </Link>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-0 border-b border-[var(--wr-border)] mb-6">
        {[
          { label: 'Holdings', href: '/portfolio/holdings', active: true },
          { label: 'Transactions', href: '/portfolio/transactions' },
          { label: 'Analytics', href: '/portfolio/analytics' },
        ].map(t => (
          <Link key={t.href} href={t.href}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500,
              padding: '8px 16px', display: 'inline-block', textDecoration: 'none',
              borderBottom: t.active ? '2px solid var(--wr-accent)' : '2px solid transparent',
              color: t.active ? 'var(--wr-accent)' : 'var(--wr-text-3)', marginBottom: '-1px',
            }}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 overflow-hidden mb-6"
        style={{ backgroundColor: 'var(--wr-border)', border: '1px solid var(--wr-border)', gap: '1px' }}>
        {[
          { label: 'Total Value',    value: totalValue,         color: undefined },
          { label: 'Total NFTs',     value: String(totalNfts),  color: undefined },
          { label: 'Total Tokens',   value: String(totalTokens),color: undefined },
          { label: 'Unrealized PnL', value: '+$18,240.65',      color: 'var(--wr-accent)' },
        ].map(s => (
          <div key={s.label} style={{ backgroundColor: 'var(--wr-surface)', padding: '20px 24px' }}>
            <div style={STAT_LABEL}>{s.label}</div>
            <div style={{ ...STAT_VALUE, color: s.color ?? 'var(--wr-text)', fontSize: '20px' }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* NFT Holdings */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px', marginBottom: '20px' }}>
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)' }}>NFT Holdings</span>
          <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#0b0c14', backgroundColor: '#7c5cff', border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
            Bulk Actions
          </button>
        </div>
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
            style={{ gridTemplateColumns: '0.4fr 1.8fr 0.5fr 0.8fr 0.7fr 0.9fr 0.9fr 0.9fr 0.5fr 0.8fr', columnGap: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span></span><span>Collection</span><span>ETH#</span><span>Floor Price</span><span>24h</span>
            <span>Top Offer</span><span>14d Vol</span><span>30d Vol</span><span>Items</span><span>Rentals</span>
          </div>
          {NFT_HOLDINGS.map((n, i) => (
            <div key={i} className="grid px-4 py-3 border-b border-[var(--wr-border)] last:border-b-0 hover:bg-[var(--wr-overlay)] items-center"
              style={{ gridTemplateColumns: '0.4fr 1.8fr 0.5fr 0.8fr 0.7fr 0.9fr 0.9fr 0.9fr 0.5fr 0.8fr', columnGap: '16px' }}>
              <input type="checkbox" className="accent-[#7c5cff] w-3.5 h-3.5" />
              <span style={{ color: 'var(--wr-text)', fontSize: '13px', fontWeight: 500 }}>{n.collection}</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, backgroundColor: 'var(--wr-border)', color: 'var(--wr-text)', padding: '2px 8px', display: 'inline-block', textAlign: 'center' }}>{n.items}</span>
              <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.floor}</span>
              <span style={{ color: n.changeColor, fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.change}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.topOffer}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.p14}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.p30}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.ld}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{n.rentals}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Token Holdings */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', padding: '24px' }}>
        <div className="flex items-center justify-between mb-4">
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '14px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-accent)' }}>Token Holdings</span>
          <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#0b0c14', backgroundColor: '#7c5cff', border: 'none', padding: '6px 14px', cursor: 'pointer' }}>
            Bulk Actions
          </button>
        </div>
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
            style={{ gridTemplateColumns: '0.4fr 1.8fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr', columnGap: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span></span><span>Token</span><span>Holdings</span><span>Price</span>
            <span>24h</span><span>3d</span><span>7d</span><span>30d</span><span>PnL</span>
          </div>
          {TOKEN_HOLDINGS.map((t, i) => (
            <div key={i} className="grid px-4 py-3 border-b border-[var(--wr-border)] last:border-b-0 hover:bg-[var(--wr-overlay)] items-center"
              style={{ gridTemplateColumns: '0.4fr 1.8fr 1fr 0.8fr 0.7fr 0.7fr 0.7fr 0.7fr 0.8fr', columnGap: '16px' }}>
              <input type="checkbox" className="accent-[#7c5cff] w-3.5 h-3.5" />
              <div className="flex items-center gap-2">
                <Tag variant={t.variant} size="xs">{t.badge}</Tag>
                <span style={{ color: 'var(--wr-text)', fontSize: '12px' }}>{t.token}</span>
              </div>
              <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.holdings}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.price}</span>
              <span style={{ color: t.change24.startsWith('+') ? '#4fe9b4' : '#ff8a96', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.change24}</span>
              <span style={{ color: t.change3d.startsWith('+') ? '#4fe9b4' : '#ff8a96', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.change3d}</span>
              <span style={{ color: t.change7d.startsWith('+') ? '#4fe9b4' : '#ff8a96', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.change7d}</span>
              <span style={{ color: t.change30d.startsWith('+') ? '#4fe9b4' : '#ff8a96', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.change30d}</span>
              <span style={{ color: t.pnlColor, fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{t.pnl}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
