'use client';

import { useState, useEffect } from 'react';
import { getPortfolioSnapshot, getPnlSummary, getAssetTransfers, loadAlchemyKey, type PortfolioSnapshot, type PnlSummary, type AssetTransfer } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { MOCK_PORTFOLIO_SNAPSHOT, MOCK_PNL_SUMMARY, MOCK_TRANSFERS } from '@/lib/mockData';
import { Tag, TX_TYPE_VARIANT } from '@/components/Tag';
import EthIcon from '@/components/EthIcon';

// ─── Portfolio / Transactions — matches 3qwIV design ─────────────────────────

type SubTab = 'Wallets' | 'Transactions' | 'Analytics';
type TxType = 'Receive' | 'Send' | 'Swap' | 'NFT' | 'Routine';

interface Tx {
  hash: string;
  type: TxType;
  block: string;
  age: string;
  from: string;
  to: string;
  token: string;
  amount: string;
  gasFee: string;
}

const TRANSACTIONS: Tx[] = [
  { hash: '0x8aDf73c1a4b2…', type: 'Receive', block: '1,847,343', age: '1 day',   from: '0x7a25…488d', to: '0xd8dA…6045', token: 'ETH', amount: '0.5 ETH',           gasFee: '0.0024 ETH' },
  { hash: '0x9aB2cd4f88e1…', type: 'Receive', block: '1,847,217', age: '2 days',  from: '0xbc4c…f13d', to: '0xd8dA…6045', token: 'ETH', amount: '0.12 ETH',          gasFee: '0.0011 ETH' },
  { hash: '0x3fc81dAe22b4…', type: 'Send',    block: '1,846,891', age: '3 days',  from: '0xd8dA…6045', to: '0xef56…7890', token: 'ETH', amount: '1.8 ETH',            gasFee: '0.0031 ETH' },
  { hash: '0x5c29a31234d8…', type: 'Swap',    block: '1,845,430', age: '5 days',  from: '0xd8dA…6045', to: '0x7a25…488d', token: 'ETH', amount: '0.5 ETH → 200 USDC', gasFee: '0.0042 ETH' },
  { hash: '0x1a8c9b7e55f3…', type: 'Routine', block: '1,844,210', age: '7 days',  from: '0x3456…7890', to: '0xd8dA…6045', token: 'ETH', amount: '—',                  gasFee: '0.0008 ETH' },
];

const TYPE_FILTERS: (TxType | 'ALL')[] = ['ALL', 'Receive', 'Send', 'Swap', 'NFT'];

const WALLET_COLORS = ['#60a5fa', '#A855F7', '#818CF8', '#34d399', '#f59e0b', '#f87171'];

function WalletsTab() {
  const [walletCards, setWalletCards] = useState<{ name: string; address: string; rawAddress: string; eth: number; usd: number; color: string; nfts: number; tokens: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const stored = loadWallets();
    if (!inTauri) {
      setWalletCards(stored.map((w, i) => ({
        name: w.name,
        address: w.address.slice(0, 6) + '…' + w.address.slice(-4),
        rawAddress: w.address,
        eth: MOCK_PORTFOLIO_SNAPSHOT.eth_balance,
        usd: MOCK_PORTFOLIO_SNAPSHOT.portfolio_value_usd,
        color: WALLET_COLORS[i % WALLET_COLORS.length],
        nfts: MOCK_PORTFOLIO_SNAPSHOT.nft_count,
        tokens: MOCK_PORTFOLIO_SNAPSHOT.token_count,
      })));
      setLoading(false);
      return;
    }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      const results = await Promise.allSettled(
        stored.map(w => getPortfolioSnapshot(w.address, key).catch(() => MOCK_PORTFOLIO_SNAPSHOT as PortfolioSnapshot))
      );
      setWalletCards(results.map((r, i) => {
        const snap = r.status === 'fulfilled' ? r.value : MOCK_PORTFOLIO_SNAPSHOT as PortfolioSnapshot;
        return {
          name: stored[i].name,
          address: stored[i].address.slice(0, 6) + '…' + stored[i].address.slice(-4),
          rawAddress: stored[i].address,
          eth: snap.eth_balance,
          usd: snap.portfolio_value_usd,
          color: WALLET_COLORS[i % WALLET_COLORS.length],
          nfts: snap.nft_count,
          tokens: snap.token_count,
        };
      }));
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-8 text-center" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>Loading wallets…</div>;

  return (
    <div className="grid grid-cols-3 gap-4 mt-4">
      {walletCards.map(w => (
        <div key={w.address} className="bg-[#111111] rounded-[8px] border border-[#1A1A1A] p-4"
          style={{ borderLeft: `3px solid ${w.color}` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-white text-xs font-semibold">{w.name}</span>
            <div className="flex items-center gap-1">
              <span className="text-[#6e6e6e] text-[10px] font-mono">{w.address}</span>
              <a href={`https://etherscan.io/address/${w.rawAddress}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#6e6e6e] hover:text-[#a1a1aa] transition-colors flex">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </a>
            </div>
          </div>
          <div className="text-xl font-bold text-white tabular-nums mb-0.5">
            ${w.usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}
          </div>
          <div className="text-[#6e6e6e] text-[11px] font-mono">{w.eth.toFixed(4)} <EthIcon size={10} color="var(--wr-text-3)" style={{ verticalAlign: 'middle', marginLeft: 2 }} /></div>
          <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-[#1A1A1A]">
            <div>
              <div className="text-[#6e6e6e] text-[9px] uppercase tracking-wider">NFTs</div>
              <div className="text-white text-sm font-semibold">{w.nfts}</div>
            </div>
            <div>
              <div className="text-[#6e6e6e] text-[9px] uppercase tracking-wider">Tokens</div>
              <div className="text-white text-sm font-semibold">{w.tokens}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AnalyticsTab() {
  const [pnl, setPnl] = useState<PnlSummary | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';
    if (!inTauri) { setPnl(MOCK_PNL_SUMMARY as PnlSummary); return; }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (addr && key) {
        const data = await getPnlSummary(addr, key).catch(() => MOCK_PNL_SUMMARY as PnlSummary);
        setPnl(data);
      } else {
        setPnl(MOCK_PNL_SUMMARY as PnlSummary);
      }
    })();
  }, []);

  const totalVol = pnl ? (pnl.total_buy_volume_eth + pnl.total_sell_volume_eth).toFixed(2) : '—';
  const winRate  = pnl && pnl.trade_count > 0 ? ((pnl.win_count / pnl.trade_count) * 100).toFixed(1) + '%' : '—';

  const stats = pnl ? [
    { label: 'Realized PnL',   value: (pnl.realized_pnl_eth >= 0 ? '+' : '') + pnl.realized_pnl_eth.toFixed(3) + ' ETH', color: pnl.realized_pnl_eth >= 0 ? '#34d399' : '#F87171' },
    { label: 'Unrealized PnL', value: (pnl.unrealized_pnl_eth >= 0 ? '+' : '') + pnl.unrealized_pnl_eth.toFixed(3) + ' ETH', color: pnl.unrealized_pnl_eth >= 0 ? '#34d399' : '#F87171' },
    { label: 'Total Volume',   value: totalVol + ' ETH',  color: 'var(--wr-text)' },
    { label: 'Win Rate',       value: winRate,             color: 'var(--wr-accent)' },
    { label: 'Total Trades',   value: String(pnl.trade_count), color: 'var(--wr-text)' },
    { label: 'Win / Loss',     value: `${pnl.win_count} / ${pnl.loss_count}`, color: 'var(--wr-text)' },
    { label: 'Buy Volume',     value: pnl.total_buy_volume_eth.toFixed(2) + ' ETH',  color: 'var(--wr-text)' },
    { label: 'Sell Volume',    value: pnl.total_sell_volume_eth.toFixed(2) + ' ETH', color: 'var(--wr-text)' },
  ] : Array(8).fill({ label: '—', value: '—', color: '#6E6E6E' });

  return (
    <div className="mt-4 grid grid-cols-4 gap-4">
      {stats.map((s, i) => (
        <div key={i} className="bg-[#111111] border border-[#1A1A1A] rounded-[8px] p-4">
          <div className="text-[#6e6e6e] text-[10px] uppercase tracking-wider mb-2">{s.label}</div>
          <div className="text-xl font-bold tabular-nums" style={{ color: s.color }}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

function mapTransfer(t: AssetTransfer, addr: string): Tx {
  const isIn  = t.to?.toLowerCase() === addr.toLowerCase();
  const isMint = t.from === '0x0000000000000000000000000000000000000000';
  let type: TxType = isIn ? 'Receive' : 'Send';
  if (t.category === 'erc721' || t.category === 'erc1155') type = 'NFT';
  if (isMint) type = 'Receive';
  const ts = t.metadata?.block_timestamp;
  const age = ts ? relAge(ts) : t.block_num;
  return {
    hash:   t.hash.slice(0, 14) + '…',
    type,
    block:  t.block_num,
    age,
    from:   t.from.slice(0, 6) + '…' + t.from.slice(-4),
    to:     t.to ? t.to.slice(0, 6) + '…' + t.to.slice(-4) : '—',
    token:  t.asset ?? (type === 'NFT' ? 'NFT' : 'ETH'),
    amount: t.value != null ? `${t.value.toFixed(4)} ${t.asset ?? 'ETH'}` : '—',
    gasFee: '—',
  };
}
function relAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function PortfolioPage() {
  const [activeTab, setActiveTab] = useState<SubTab>('Transactions');
  const [typeFilter, setTypeFilter] = useState<TxType | 'ALL'>('ALL');
  const [liveTxs, setLiveTxs] = useState<Tx[] | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    const addr = loadWallets()[0]?.address ?? '';
    if (!inTauri) {
      setLiveTxs((MOCK_TRANSFERS as AssetTransfer[]).map(t => mapTransfer(t, addr)));
      return;
    }
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (!addr || !key) { setLiveTxs(TRANSACTIONS); return; }
      const transfers = await getAssetTransfers(addr, key).catch(() => [] as AssetTransfer[]);
      setLiveTxs(transfers.map(t => mapTransfer(t, addr)));
    })();
  }, []);

  const allTxs = liveTxs ?? TRANSACTIONS;
  const filtered = allTxs.filter(tx => typeFilter === 'ALL' || tx.type === typeFilter);

  return (
    <main className="min-h-full bg-[#0A0A0A] text-white px-12 py-8">

      {/* Sub-tab nav */}
      <div className="flex items-center gap-0 border-b border-[#1A1A1A] mb-5">
        {(['Wallets', 'Transactions', 'Analytics'] as SubTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2.5 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-[#BEFF00] text-[#BEFF00]'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Wallets' && <WalletsTab />}
      {activeTab === 'Analytics' && <AnalyticsTab />}

      {activeTab === 'Transactions' && (
        <>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Transactions</h1>
            <button className="text-[#6e6e6e] text-[11px] border border-[#1A1A1A] rounded-[6px] px-3 py-1 hover:border-[#3f3f46] transition-colors">
              ↓ Export CSV
            </button>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {TYPE_FILTERS.map(f => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`px-3 py-1 rounded-[6px] text-[11px] font-medium transition-colors ${
                  typeFilter === f
                    ? 'bg-[#BEFF00] text-black'
                    : 'bg-[#111111] border border-[#1A1A1A] text-[#6e6e6e] hover:text-[#A1A1AA] hover:border-[#3f3f46]'
                }`}
              >
                {f}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <button className="text-[#6e6e6e] text-[11px] border border-[#1A1A1A] rounded-[6px] px-3 py-1 hover:border-[#3f3f46] transition-colors">
                All Chains ▾
              </button>
              <button className="text-[#6e6e6e] text-[11px] border border-[#1A1A1A] rounded-[6px] px-3 py-1 hover:border-[#3f3f46] transition-colors">
                Last 30 Days ▾
              </button>
              <input
                placeholder="Search by address..."
                className="bg-[#111111] border border-[#1A1A1A] rounded-[6px] px-3 py-1 text-[11px] text-white placeholder-[#333] focus:outline-none focus:border-[#BEFF0044] w-44"
              />
            </div>
          </div>

          {/* Table */}
          <div className="rounded-[8px] border border-[#1A1A1A] overflow-hidden">
            <div
              className="grid items-center bg-[#111111] border-b border-[#1A1A1A] px-4"
              style={{ gridTemplateColumns: '168.5px 168.5px 168.5px 168.5px 168.5px 35px 168.5px 70px 70px 70px', height: '40px' }}
            >
              {['Tx Hash', 'Type', 'Block', 'Age', 'From', '', 'To', 'Token', 'Amount', 'Gas Fee'].map((h, i) => (
                <span key={i} className="text-[#71717a] text-[11px] font-semibold uppercase tracking-[0.06em]">{h}</span>
              ))}
            </div>

            {filtered.map((tx, i) => {
              return (
                <div
                  key={i}
                  className="grid items-center px-4 border-b border-[#1A1A1A] last:border-0 hover:bg-[#111111] transition-colors"
                  style={{ gridTemplateColumns: '168.5px 168.5px 168.5px 168.5px 168.5px 35px 168.5px 70px 70px 70px', height: '56px' }}
                >
                  <div className="flex items-center gap-1 min-w-0 pr-2">
                    <span className="font-mono text-[11px] text-[#60a5fa] truncate">{tx.hash}</span>
                    <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer" className="shrink-0 text-[#6e6e6e] hover:text-[#a1a1aa] transition-colors flex">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  </div>
                  <div>
                    <Tag variant={TX_TYPE_VARIANT[tx.type] ?? 'neutral'}>{tx.type}</Tag>
                  </div>
                  <span className="font-mono text-[11px] text-[#6e6e6e]">{tx.block}</span>
                  <span className="text-[11px] text-[#6e6e6e]">{tx.age}</span>
                  <div className="flex items-center gap-1 min-w-0 pr-1">
                    <span className="font-mono text-[11px] text-[#6e6e6e] truncate">{tx.from}</span>
                    <span className="text-[#6e6e6e] text-[8px] shrink-0">⊕</span>
                  </div>
                  <span className="text-[#6e6e6e] text-[10px] text-center">→</span>
                  <div className="flex items-center gap-1 min-w-0 pr-1">
                    <span className="font-mono text-[11px] text-[#6e6e6e] truncate">{tx.to}</span>
                    <span className="text-[#6e6e6e] text-[8px] shrink-0">⊕</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[#6e6e6e] text-[9px]">◈</span>
                    <span className="text-[11px] text-[#A1A1AA]">{tx.token}</span>
                  </div>
                  <span className="text-[11px] text-white tabular-nums">{tx.amount}</span>
                  <span className="text-[11px] text-[#6e6e6e] tabular-nums">{tx.gasFee}</span>
                </div>
              );
            })}
          </div>

          {/* View all link */}
          <div className="text-center mt-4">
            <button className="text-[#6e6e6e] text-[11px] hover:text-[#A1A1AA] transition-colors">
              View All Transactions →
            </button>
          </div>
        </>
      )}
    </main>
  );
}
