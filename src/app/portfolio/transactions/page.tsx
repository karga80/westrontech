'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { getAssetTransfers, loadAlchemyKey, type AssetTransfer } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { EMPTY_TRANSFERS } from '@/lib/emptyData';

// ─── Portfolio / Transactions — matches 3qwIV design ────────────────────────

type TxFilter = 'ALL' | 'Buy' | 'Receive' | 'Tags' | 'NFTs';

const TX_STATUS = {
  Receive: { color: '#4fe9b4', bg: '#06251b', border: '#06251b' },
  Buy:     { color: '#90a6ff', bg: '#1c1c3a', border: '#3b3b6a' },
  Swap:    { color: '#ffb020', bg: '#2a1800', border: '#2a1e05' },
  Routine: { color: '#a855f7', bg: '#1a0a2e', border: '#3b1a5a' },
};

const TXS = [
  { hash: '0x8dF73cfu...', type: 'Receive', block: '1847293', age: '1 day', from: '0x7a25...Fee 5', to: '0xd40D...J05', tokens: '20 (BTC-VER...J08 )', status: '0.874', gasFee: '0x174...0x4d' },
  { hash: '0x9aB2cd88...', type: 'Receive', block: '1847217', age: '2 days', from: '0xbc4c...S13d', to: '0xd40D...J05', tokens: 'BTC to Eth (c)', status: '0.67K VE', gasFee: '0.014 0.041gxd' },
  { hash: '0x1f7bcd4e...', type: 'Swap',    block: '1846891', age: '3 days', from: '0xd40D...J05', to: '0xcf89W... J809', tokens: '7.6.90273', status: '0.6% VES', gasFee: '0.014 0.5474p' },
  { hash: '0x5c284312...', type: 'Buy',     block: '1845430', age: '5 days', from: '0xd40D...J05', to: '0x7a25...4 88d', tokens: '6.6.30', status: '% VES', gasFee: '5.0 0.50274e' },
  { hash: '0x1a8c7e55...', type: 'Routine', block: '1844210', age: '7 days', from: '0x3456...7890', to: '0xd40D...J05', tokens: 'x.4 VE', status: '0.8% VES', gasFee: '1.5 5.32e 0.4 substr(e)' },
];

function mapTx(t: AssetTransfer, addr: string) {
  const isIn = t.to?.toLowerCase() === addr.toLowerCase();
  const cat  = t.category;
  let type: keyof typeof TX_STATUS = isIn ? 'Receive' : 'Buy';
  if (cat === 'erc20') type = 'Swap';
  if (cat === 'erc721' || cat === 'erc1155') type = 'Routine';
  const age = (() => {
    if (!t.metadata?.block_timestamp) return t.block_num;
    const s = Math.floor((Date.now() - new Date(t.metadata.block_timestamp).getTime()) / 1000);
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  })();
  return {
    hash:    t.hash.slice(0, 12) + '…',
    type,
    block:   t.block_num,
    age,
    from:    t.from.slice(0, 6) + '…' + t.from.slice(-4),
    to:      t.to ? t.to.slice(0, 6) + '…' + t.to.slice(-4) : '—',
    tokens:  t.value != null ? `${t.value.toFixed(4)} ${t.asset ?? 'ETH'}` : '—',
    status:  t.value != null ? t.value.toFixed(4) : '—',
    gasFee:  '—',
  };
}

export default function PortfolioTransactionsPage() {
  const [filter, setFilter] = useState<TxFilter>('ALL');
  const [liveTxs, setLiveTxs] = useState<ReturnType<typeof mapTx>[] | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';
    if (!inTauri) { setLiveTxs((EMPTY_TRANSFERS as AssetTransfer[]).map(t => mapTx(t, addr))); return; }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (!key || !addr) { setLiveTxs(TXS as ReturnType<typeof mapTx>[]); return; }
      const transfers = await getAssetTransfers(addr, key).catch(() => [] as AssetTransfer[]);
      setLiveTxs(transfers.map(t => mapTx(t, addr)));
    })();
  }, []);

  return (
    <main className="min-h-full" style={{ backgroundColor: 'var(--wr-bg)', padding: '32px 48px' }}>

      {/* Tab strip (no breadcrumb on this one per design) */}
      <div className="flex items-center gap-0 border-b border-[var(--wr-border)] mb-5">
        {[
          { label: 'Holdings', href: '/portfolio/holdings' },
          { label: 'Transactions', href: '/portfolio/transactions', active: true },
          { label: 'Analytics', href: '/portfolio/analytics' },
        ].map(t => (
          <Link key={t.href} href={t.href}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500, padding: '8px 16px', display: 'inline-block', textDecoration: 'none', borderBottom: t.active ? '2px solid var(--wr-accent)' : '2px solid transparent', color: t.active ? 'var(--wr-accent)' : 'var(--wr-text-3)', marginBottom: '-1px' }}>
            {t.label}
          </Link>
        ))}
      </div>

      {/* Header + filters */}
      <div className="flex items-center justify-between mb-5">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Transactions</h1>
        <div className="flex items-center gap-2">
          <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-accent)', border: '1px solid #7c5cff44', backgroundColor: 'transparent', padding: '6px 12px', cursor: 'pointer' }}>
            ↓ Export CSV
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {/* Type filters */}
        {(['ALL', 'Buy', 'Receive', 'Tags', 'NFTs'] as TxFilter[]).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, padding: '5px 12px', backgroundColor: filter === f ? '#7c5cff' : 'var(--wr-surface)', color: filter === f ? '#0b0c14' : 'var(--wr-text-3)', border: filter === f ? 'none' : '1px solid var(--wr-border)', cursor: 'pointer' }}>
            {f}
          </button>
        ))}
        {/* Chain + Duration dropdowns */}
        <select className="bg-[var(--wr-surface)] border border-[var(--wr-border)] text-[#9298b8] text-[11px] px-3 py-1.5 focus:outline-none" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          <option>All Chains</option>
          <option>Ethereum</option>
        </select>
        <select className="bg-[var(--wr-surface)] border border-[var(--wr-border)] text-[#9298b8] text-[11px] px-3 py-1.5 focus:outline-none" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          <option>Last 90 Days</option>
          <option>Last 30 Days</option>
          <option>Last 7 Days</option>
        </select>
        <div className="flex items-center gap-2 bg-[var(--wr-surface)] border border-[var(--wr-border)] px-3 py-1.5 flex-1 max-w-[240px]">
          <span style={{ color: 'var(--wr-text-3)', fontSize: '12px' }}>⌕</span>
          <input placeholder="Search by address..." className="bg-transparent text-[#9298b8] text-[11px] focus:outline-none flex-1 placeholder-[#6e7590]" style={{ fontFamily: 'var(--font-jetbrains)' }} />
        </div>
      </div>

      {/* Table */}
      <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', borderRadius: '16px', overflow: 'hidden' }}>
        <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
          style={{ gridTemplateColumns: '1.6fr 0.8fr 1fr 0.6fr 1.2fr 1.2fr 1fr 0.6fr 1fr', columnGap: '16px', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
          <span>Tx Hash</span><span>Type</span><span>Block</span><span>Age</span>
          <span>From</span><span>To</span><span>Tokens</span><span>Status</span><span>Gas Fee</span>
        </div>
        {(liveTxs ?? TXS).filter(tx => filter === 'ALL' || tx.type === filter).map((tx, i) => {
          const style = TX_STATUS[tx.type as keyof typeof TX_STATUS] ?? TX_STATUS.Routine;
          return (
            <div key={i} className="grid px-4 py-3.5 border-b border-[var(--wr-border)] last:border-b-0 hover:bg-[var(--wr-surface)] transition-colors items-center"
              style={{ gridTemplateColumns: '1.6fr 0.8fr 1fr 0.6fr 1.2fr 1.2fr 1fr 0.6fr 1fr', columnGap: '16px' }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <span style={{ color: '#5b7cfa', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.hash}</span>
                <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, color: 'var(--wr-text-3)', display: 'flex' }} className="hover:text-[#9298b8] transition-colors">
                  <svg width="13" height="13" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              </div>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: style.color, backgroundColor: style.bg, border: `1px solid ${style.border}`, padding: '2px 8px', display: 'inline-block' }}>{tx.type}</span>
              <span style={{ color: '#5b7cfa', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.block}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.age}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.from}</span>
              <span style={{ color: 'var(--wr-text-2)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.to}</span>
              <span style={{ color: 'var(--wr-text)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.tokens}</span>
              <span style={{ color: '#4fe9b4', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.status}</span>
              <span style={{ color: 'var(--wr-text-3)', fontSize: '12px', fontFamily: 'var(--font-jetbrains)' }}>{tx.gasFee}</span>
            </div>
          );
        })}
      </div>

      <div className="flex justify-center mt-5">
        <button style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-accent)', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.5px' }}>
          View All Transactions →
        </button>
      </div>
    </main>
  );
}
