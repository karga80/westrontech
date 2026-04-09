'use client';

import { useState, useEffect } from 'react';
import {
  getPnlSummary,
  getTradeHistory,
  getPortfolioSnapshot,
  loadAlchemyKey,
  type PnlSummary,
  type TradeRecord,
  type PortfolioSnapshot,
} from '@/lib/tauri';
import { MOCK_PORTFOLIO_SNAPSHOT, MOCK_PNL_SUMMARY, MOCK_TRADES } from '@/lib/mockData';

const DEMO_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

const isValidEthAddress = (addr: string): boolean =>
  /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

function shortenAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatPnl(value: number): { text: string; className: string } {
  if (value > 0) {
    return { text: `+${value.toFixed(4)} ETH`, className: 'text-[#34d399]' };
  }
  if (value < 0) {
    return { text: `${value.toFixed(4)} ETH`, className: 'text-[#f87171]' };
  }
  return { text: `${value.toFixed(4)} ETH`, className: 'text-[#a1a1aa]' };
}

export default function AnalyticsPage() {
  const [address, setAddress] = useState(DEMO_ADDRESS);
  const [apiKey, setApiKey] = useState('');
  const [isTauri, setIsTauri] = useState(false);

  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [pnl, setPnl] = useState<PnlSummary | null>(null);
  const [trades, setTrades] = useState<TradeRecord[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);
    const saved = localStorage.getItem('westron_address');
    if (saved) setAddress(saved);
    if (inTauri) {
      loadAlchemyKey().then(k => { if (k) setApiKey(k); }).catch(() => {});
    }
  }, []);

  const handleLoadAnalytics = async () => {
    if (!isTauri) {
      setSnapshot(MOCK_PORTFOLIO_SNAPSHOT);
      setPnl(MOCK_PNL_SUMMARY);
      setTrades(MOCK_TRADES);
      setLoaded(true);
      return;
    }
    if (!isValidEthAddress(address)) {
      setError('Geçersiz Ethereum adresi. 0x ile başlayan 42 karakterli bir adres girin.');
      return;
    }
    if (!apiKey.trim()) {
      setError('Alchemy API key gerekli.');
      return;
    }

    setLoading(true);
    setError(null);
    setLoaded(false);

    try {
      localStorage.setItem('westron_address', address);
      const [snap, pnlData, tradeData] = await Promise.all([
        getPortfolioSnapshot(address, apiKey),
        getPnlSummary(address, apiKey),
        getTradeHistory(address, apiKey),
      ]);
      setSnapshot(snap);
      setPnl(pnlData);
      setTrades(tradeData);
      setLoaded(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const addressInvalid = address.length >= 3 && !isValidEthAddress(address);
  const addressBorderClass = addressInvalid
    ? 'border-[#f87171] focus:border-[#f87171]'
    : 'border-[#1a1a1a] focus:border-[#beff00]';

  return (
    <main className="min-h-full bg-[#0a0a0a] text-white px-12 py-8">

      {/* Page header */}
      <div className="mb-6">
        <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 600, color: 'var(--wr-text)' }}>Analytics & PnL</h1>
        <p className="text-[#6e6e6e] text-[11px] mt-0.5">Track realized and unrealized performance across your wallets</p>
      </div>

      {/* Wallet + API key input */}
      <div className="mb-6 flex gap-3">
        <input
          type="text"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="0x... wallet address"
          className={`flex-1 bg-[#111111] border px-4 py-2 text-[13px] text-white placeholder-[#6e6e6e] focus:outline-none transition-colors ${addressBorderClass}`}
        />
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="Alchemy API key"
          className="w-48 bg-[#111111] border border-[#1a1a1a] px-4 py-2 text-[13px] text-white placeholder-[#6e6e6e] focus:outline-none focus:border-[#beff00]"
        />
        <button
          onClick={handleLoadAnalytics}
          disabled={loading}
          className="bg-[#beff00] text-black font-semibold px-6 py-2 text-[13px] rounded-[6px] hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          style={{ fontFamily: 'var(--font-jetbrains)' }}
        >
          {loading ? 'Loading...' : 'Load Analytics'}
        </button>
        {!isTauri && (
          <span className="flex items-center text-[#f59e0b] text-[11px] bg-[#f59e0b]/10 px-3 py-1 border border-[#f59e0b]/20">
            Browser mode
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-[#f87171]/10 border border-[#f87171]/30 px-4 py-3 text-[#f87171] text-[13px]">
          {error}
        </div>
      )}

      {/* Portfolio Snapshot — 4 stat cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'ETH Balance', value: snapshot ? `${snapshot.eth_balance.toFixed(4)} ETH` : '—' },
          { label: 'Portfolio Value', value: snapshot ? `$${snapshot.portfolio_value_usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—' },
          { label: 'NFT Count', value: snapshot ? String(snapshot.nft_count) : '—' },
          { label: 'ERC-20 Tokens', value: snapshot ? String(snapshot.token_count) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#111111] border border-[#1a1a1a] p-6">
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>{label}</p>
            <p className="text-[22px] font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* PnL Summary */}
      <div className="mb-6">
        {/* Row 1 — 3 big stats */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-[#111111] border border-[#1a1a1a] p-6">
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>Realized PnL</p>
            {pnl ? (() => {
              const { text, className } = formatPnl(pnl.realized_pnl_eth);
              return <p className={`text-[22px] font-bold ${className}`}>{text}</p>;
            })() : <p className="text-[22px] font-bold">—</p>}
          </div>
          <div className="bg-[#111111] border border-[#1a1a1a] p-6">
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>Unrealized PnL</p>
            {pnl ? (() => {
              const { text, className } = formatPnl(pnl.unrealized_pnl_eth);
              return <p className={`text-[22px] font-bold ${className}`}>{text}</p>;
            })() : <p className="text-[22px] font-bold">—</p>}
          </div>
          <div className="bg-[#111111] border border-[#1a1a1a] p-6">
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>Total Volume</p>
            <p className="text-[22px] font-bold">
              {pnl ? `${(pnl.total_buy_volume_eth + pnl.total_sell_volume_eth).toFixed(4)} ETH` : '—'}
            </p>
          </div>
        </div>

        {/* Row 2 — 4 small stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Win Rate', value: pnl ? `${pnl.trade_count > 0 ? ((pnl.win_count / pnl.trade_count) * 100).toFixed(0) : 0}%` : '—' },
            { label: 'Total Trades', value: pnl ? String(pnl.trade_count) : '—' },
            { label: 'Gas Spent', value: pnl ? `${pnl.gas_spent_eth.toFixed(4)} ETH` : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#111111] border border-[#1a1a1a] p-5">
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '6px' }}>{label}</p>
              <p className="text-[18px] font-bold">{value}</p>
            </div>
          ))}
          <div className="bg-[#111111] border border-[#1a1a1a] p-5">
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '6px' }}>Win / Loss</p>
            <p className="text-[18px] font-bold">
              {pnl ? (
                <span>
                  <span className="text-[#34d399]">{pnl.win_count}</span>
                  <span className="text-[#6e6e6e]"> / </span>
                  <span className="text-[#f87171]">{pnl.loss_count}</span>
                </span>
              ) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Trade History Table */}
      <div className="bg-[#111111] border border-[#1a1a1a] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
          <h2 className="text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-wider">Trade History</h2>
          {trades.length > 0 && (
            <span className="text-[11px] text-[#6e6e6e]">{trades.length} trade{trades.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Table header */}
        <div className="grid grid-cols-12 px-6 py-2 text-[10px] text-[#6e6e6e] uppercase tracking-wider border-b border-[#1a1a1a]">
          <div className="col-span-3">Contract</div>
          <div className="col-span-2">Token ID</div>
          <div className="col-span-2">Buy Price</div>
          <div className="col-span-2">Sell Price</div>
          <div className="col-span-2">PnL</div>
          <div className="col-span-1 text-right">Status</div>
        </div>

        {/* Empty/loading states */}
        {loaded && trades.length === 0 && (
          <div className="px-6 py-12 text-center text-[#6e6e6e] text-[13px]">
            No trade history found.
          </div>
        )}

        {!loaded && !loading && (
          <div className="px-6 py-12 text-center text-[#6e6e6e] text-[13px]">
            Enter a wallet address and API key, then click Load Analytics.
          </div>
        )}

        {loading && (
          <div className="px-6 py-12 text-center text-[#6e6e6e] text-[13px]">
            Loading...
          </div>
        )}

        {/* Rows */}
        {trades.length > 0 && (
          <div className="divide-y divide-[#1a1a1a]">
            {trades.map((trade, i) => {
              const pnlDisplay = trade.pnl_eth != null ? formatPnl(trade.pnl_eth) : null;
              return (
                <div
                  key={i}
                  className="grid grid-cols-12 px-6 py-3 items-center hover:bg-[#1a1a1a]/50 transition-colors"
                >
                  <div className="col-span-3 font-mono text-[11px] text-[#6e6e6e]">
                    {shortenAddress(trade.contract_address)}
                  </div>
                  <div className="col-span-2 text-[13px] text-[#a1a1aa]">
                    #{trade.token_id}
                  </div>
                  <div className="col-span-2 text-[13px] text-[#a1a1aa]">
                    {trade.buy_price_eth.toFixed(4)} ETH
                  </div>
                  <div className="col-span-2 text-[13px] text-[#6e6e6e]">
                    {trade.sell_price_eth != null
                      ? `${trade.sell_price_eth.toFixed(4)} ETH`
                      : '—'}
                  </div>
                  <div className="col-span-2 text-[13px]">
                    {pnlDisplay ? (
                      <span className={pnlDisplay.className}>{pnlDisplay.text}</span>
                    ) : (
                      <span className="text-[#6e6e6e]">—</span>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {trade.sell_price_eth != null ? (
                      <span className="text-[10px] px-2 py-0.5 font-medium bg-[#2a2a2a] text-[#a1a1aa]">
                        SOLD
                      </span>
                    ) : (
                      <span className="text-[10px] px-2 py-0.5 font-medium bg-[#60a5fa]/20 text-[#60a5fa]">
                        HOLDING
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
