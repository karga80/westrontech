'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getPortfolioSnapshot, getNftsForOwner, getAssetTransfers, loadAlchemyKey,
  type PortfolioSnapshot, type OwnedNft, type AssetTransfer,
} from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { MOCK_PORTFOLIO_SNAPSHOT, MOCK_NFTS_RESPONSE, MOCK_TRANSFERS } from '@/lib/mockData';
import { Tag, WALLET_TOKEN_VARIANT } from '@/components/Tag';

// ─── Wallet Detail Client ─────────────────────────────────────────────────────

type Tab = 'Holdings' | 'Transactions' | 'Analytics';
const TIME_FILTERS = ['24h', '1W', '1M', 'ALL'] as const;

// ── Per-wallet configs ────────────────────────────────────────────────────────

const WALLET_CONFIGS = [
  {
    id: '0',
    name: 'Main Wallet',
    address: '0x3f4a6c2dB1eF8a92dC3Ab41e90F7cD8e2A91c',
    badge: 'ETH',
    totalValue: '$84,201.40',
    totalNfts: 12,
    totalTokens: 4,
    unrealizedPnl: '+$1,280.00',
    pnlPos: true,
    analytics: {
      totalAction: '$12,847.32',
      actionPct: '+28.4%',
      bestPerformer: 'Bored Ape YC',
      bestPct: '+42.1%',
      worstPerformer: 'Moonbirds',
      worstPct: '-33.5%',
      avgHoldTime: '47 days',
      totalTrades: '1,434',
      winRate: '49.45%',
      avgPrice: '$9.1k',
      portfolioValue: '$84,201.40',
      portfolioChange: '+12.4%',
    },
  },
  {
    id: '1',
    name: 'DeFi Wallet',
    address: '0x1234C2dB1eF8a92dC3Ab41e90F7cD8e25678',
    badge: 'BNB',
    totalValue: '$38,490.87',
    totalNfts: 5,
    totalTokens: 3,
    unrealizedPnl: '-$340.00',
    pnlPos: false,
    analytics: {
      totalAction: '$4,210.50',
      actionPct: '-3.2%',
      bestPerformer: 'Uniswap V3',
      bestPct: '+18.4%',
      worstPerformer: 'Curve LP',
      worstPct: '-12.1%',
      avgHoldTime: '23 days',
      totalTrades: '847',
      winRate: '44.20%',
      avgPrice: '$4.8k',
      portfolioValue: '$38,490.87',
      portfolioChange: '-0.69%',
    },
  },
  {
    id: '2',
    name: 'Polygon Cold',
    address: '0xabcdF8a92dC3Ab41e90F7cD8e2ef12',
    badge: 'MATIC',
    totalValue: '$20,141.65',
    totalNfts: 8,
    totalTokens: 6,
    unrealizedPnl: '+$2,490.00',
    pnlPos: true,
    analytics: {
      totalAction: '$6,320.10',
      actionPct: '+15.8%',
      bestPerformer: 'Azuki',
      bestPct: '+55.2%',
      worstPerformer: 'Clonex',
      worstPct: '-8.9%',
      avgHoldTime: '62 days',
      totalTrades: '312',
      winRate: '58.97%',
      avgPrice: '$2.3k',
      portfolioValue: '$20,141.65',
      portfolioChange: '+2.01%',
    },
  },
];

// ── NFT holdings per wallet ───────────────────────────────────────────────────

const NFT_DATA: Record<string, Array<{
  name: string; color: string; count: number; floor: string; change: string;
  neg: boolean; topPrice: string; vol24h: string; sales24h: number; supply: number; avgPa: string;
}>> = {
  '0': [
    { name: 'Bored Ape YC',   color: '#f59e0b', count: 6, floor: '23.5 ETH', change: '-7.3%',  neg: true,  topPrice: '24.8 ETH', vol24h: '142.5 ETH', sales24h: 0,  supply: 10000, avgPa: '14,998' },
    { name: 'Azuki',          color: '#f87171', count: 3, floor: '34.2 ETH', change: '-1.7%',  neg: true,  topPrice: '41.5 ETH', vol24h: '53.4 ETH',  sales24h: 13, supply: 5821,  avgPa: '10,200' },
    { name: 'Doodles',        color: '#60a5fa', count: 3, floor: '2.9 ETH',  change: '+8.3%',  neg: false, topPrice: '3.4 ETH',  vol24h: '14.2 ETH',  sales24h: 9,  supply: 10000, avgPa: '12,000' },
  ],
  '1': [
    { name: 'Pudgy Penguins', color: '#34d399', count: 4, floor: '7.4 ETH',  change: '+0.4%',  neg: false, topPrice: '7.2 ETH',  vol24h: '42.6 ETH',  sales24h: 14, supply: 8888,  avgPa: '3,988' },
    { name: 'Clonex',         color: '#a78bfa', count: 1, floor: '4.1 ETH',  change: '-1.1%',  neg: true,  topPrice: '4.8 ETH',  vol24h: '28.4 ETH',  sales24h: 9,  supply: 9534,  avgPa: '26,008' },
  ],
  '2': [
    { name: 'Azuki',          color: '#f87171', count: 2, floor: '34.2 ETH', change: '-1.7%',  neg: true,  topPrice: '41.5 ETH', vol24h: '53.4 ETH',  sales24h: 13, supply: 5821,  avgPa: '10,200' },
    { name: 'Doodles',        color: '#60a5fa', count: 4, floor: '2.9 ETH',  change: '+8.3%',  neg: false, topPrice: '3.4 ETH',  vol24h: '14.2 ETH',  sales24h: 9,  supply: 10000, avgPa: '12,000' },
    { name: 'Moonbirds',      color: '#fbbf24', count: 2, floor: '1.8 ETH',  change: '-5.2%',  neg: true,  topPrice: '2.1 ETH',  vol24h: '9.8 ETH',   sales24h: 5,  supply: 10000, avgPa: '8,420' },
  ],
};

// ── Token holdings per wallet ─────────────────────────────────────────────────

const TOKEN_DATA: Record<string, Array<{
  name: string; ticker: string; color: string; holding: string; price: string; change24h: string; change30: string;
}>> = {
  '0': [
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', holding: '$45,200', price: '$2,842', change24h: '+1.4%',  change30: '+8.2%'  },
    { name: 'USD Coin',    ticker: 'USDC', color: '#2775ca', holding: '$15,000', price: '$1.00',  change24h: '+0.0%',  change30: '+0.0%'  },
    { name: 'Wrapped ETH', ticker: 'WETH', color: '#627eea', holding: '$12,400', price: '$2,842', change24h: '+1.4%',  change30: '+8.2%'  },
    { name: 'Uniswap',     ticker: 'UNI',  color: '#ff007a', holding: '$11,600', price: '$7.24',  change24h: '-2.1%',  change30: '+14.8%' },
  ],
  '1': [
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', holding: '$20,100', price: '$2,842', change24h: '+1.4%',  change30: '+8.2%'  },
    { name: 'Binance Coin',ticker: 'BNB',  color: '#f3ba2f', holding: '$10,200', price: '$412',   change24h: '-0.8%',  change30: '+4.1%'  },
    { name: 'Curve DAO',   ticker: 'CRV',  color: '#3a3a3a', holding: '$8,190',  price: '$0.54',  change24h: '-3.4%',  change30: '-12.1%' },
  ],
  '2': [
    { name: 'Polygon',     ticker: 'MATIC',color: '#8247e5', holding: '$8,400',  price: '$0.78',  change24h: '+2.1%',  change30: '+2.0%'  },
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', holding: '$5,600',  price: '$2,842', change24h: '+1.4%',  change30: '+8.2%'  },
    { name: 'Aave',        ticker: 'AAVE', color: '#b6509e', holding: '$3,200',  price: '$124',   change24h: '-1.2%',  change30: '+18.4%' },
    { name: 'Chainlink',   ticker: 'LINK', color: '#2a5ada', holding: '$1,800',  price: '$14.2',  change24h: '+3.8%',  change30: '+22.1%' },
    { name: 'Synthetix',   ticker: 'SNX',  color: '#00d1ff', holding: '$700',    price: '$3.12',  change24h: '-0.5%',  change30: '+5.3%'  },
    { name: 'USD Coin',    ticker: 'USDC', color: '#2775ca', holding: '$441',    price: '$1.00',  change24h: '+0.0%',  change30: '+0.0%'  },
  ],
};

// ── Transactions per wallet ───────────────────────────────────────────────────

const TX_STYLE = {
  Receive: { bg: '#052e16', border: '#166534', text: '#34d399' },
  Send:    { bg: '#450a0a', border: '#7f1d1d', text: '#f87171' },
  Swap:    { bg: '#2a1800', border: '#4a3000', text: '#fbbf24' },
  NFT:     { bg: '#1a0a2e', border: '#3b1a5a', text: '#a855f7' },
} as const;

type TxType = keyof typeof TX_STYLE;

const TX_DATA: Record<string, Array<{
  hash: string; type: TxType; block: string; age: string; from: string; to: string; token: string; amount: string; gas: string;
}>> = {
  '0': [
    { hash: '0x8aDf73c1a4…', type: 'Receive', block: '1847343', age: '1 hr ago',   from: '0x6a4b…2sd8', to: '0x3f4a…A91c', token: 'ETH',  amount: '0.5 ETH',  gas: '0.00003157' },
    { hash: '0x3fc81dAe22…', type: 'Send',    block: '1846891', age: '3 hrs ago',  from: '0x3f4a…A91c', to: '0x7f2e…B3c1', token: 'ETH',  amount: '0.1 ETH',  gas: '0.00002841' },
    { hash: '0x1a8c9b7e55…', type: 'Swap',    block: '1844210', age: '1 day ago',  from: '0x3f4a…A91c', to: '0x3f4a…A91c', token: 'ETH',  amount: '1.5 ETH',  gas: '0.00001764' },
    { hash: '0xa1B9f2c7d4…', type: 'NFT',     block: '1842711', age: '2 days ago', from: '0x3f4a…A91c', to: '0xe4b1…9A3d', token: 'NFT',  amount: '1 NFT',    gas: '0.00007241' },
    { hash: '0x2eF8a17c90…', type: 'Receive', block: '1841203', age: '3 days ago', from: '0x3b7f…D2c9', to: '0x3f4a…A91c', token: 'ETH',  amount: '0.75 ETH', gas: '0.00001943' },
    { hash: '0x6bD0e31a77…', type: 'Swap',    block: '1838401', age: '6 days ago', from: '0x3f4a…A91c', to: '0x3f4a…A91c', token: 'DAI',  amount: '1200 DAI', gas: '0.00004455' },
    { hash: '0x1dA5b84c62…', type: 'Send',    block: '1837688', age: '7 days ago', from: '0x3f4a…A91c', to: '0x1234…5678', token: 'ETH',  amount: '2.0 ETH',  gas: '0.00002987' },
  ],
  '1': [
    { hash: '0x9aB2cd4f88…', type: 'Receive', block: '1847217', age: '2 hrs ago',  from: '0xbc4c…f13d', to: '0x1234…5678', token: 'ETH',  amount: '0 ETH',    gas: '0.00000892' },
    { hash: '0xc3D7e48f21…', type: 'Send',    block: '1843488', age: '2 days ago', from: '0x1234…5678', to: '0x5d3a…C8f2', token: 'USDC', amount: '500 USDC', gas: '0.00003880' },
    { hash: '0x7dC4b39e01…', type: 'Swap',    block: '1841990', age: '3 days ago', from: '0x1234…5678', to: '0x1234…5678', token: 'WETH', amount: '2.0 WETH', gas: '0.00005512' },
    { hash: '0x9cE1f74b38…', type: 'Send',    block: '1839844', age: '5 days ago', from: '0x1234…5678', to: '0xabcd…ef12', token: 'ETH',  amount: '0.05 ETH', gas: '0.00001320' },
  ],
  '2': [
    { hash: '0x5c29a31234…', type: 'Swap',    block: '1845430', age: '14 hrs ago', from: '0xabcd…ef12', to: '0xabcd…ef12', token: 'ETH',  amount: '1.5 ETH',  gas: '0.00004213' },
    { hash: '0xf4E2a1b9cc…', type: 'Receive', block: '1843902', age: '1 day ago',  from: '0x92ab…4F1e', to: '0xabcd…ef12', token: 'ETH',  amount: '3.2 ETH',  gas: '0.00002100' },
    { hash: '0xb5A3d92f44…', type: 'Send',    block: '1840517', age: '4 days ago', from: '0xabcd…ef12', to: '0x8c2e…5B7a', token: 'ETH',  amount: '0.3 ETH',  gas: '0.00002610' },
    { hash: '0x4aF6c28d55…', type: 'NFT',     block: '1839120', age: '5 days ago', from: '0xd19a…7F4b', to: '0xabcd…ef12', token: 'NFT',  amount: '2 NFTs',   gas: '0.00009870' },
  ],
};

// ── Top collections per wallet ────────────────────────────────────────────────

const TOP_COLLECTIONS: Record<string, Array<{ name: string; eth: string; pct: number }>> = {
  '0': [
    { name: 'Bored Ape Yacht Club', eth: '141 ETH',   pct: 55 },
    { name: 'Azuki',                eth: '102.6 ETH', pct: 30 },
    { name: 'Doodles',              eth: '8.7 ETH',   pct: 15 },
  ],
  '1': [
    { name: 'Pudgy Penguins',       eth: '29.6 ETH',  pct: 68 },
    { name: 'Clonex',               eth: '4.1 ETH',   pct: 32 },
  ],
  '2': [
    { name: 'Azuki',                eth: '68.4 ETH',  pct: 48 },
    { name: 'Doodles',              eth: '11.6 ETH',  pct: 30 },
    { name: 'Moonbirds',            eth: '3.6 ETH',   pct: 22 },
  ],
};

// ── Chart ─────────────────────────────────────────────────────────────────────

const CHART_POINTS: Record<string, number[]> = {
  '0': [0.55, 0.50, 0.45, 0.48, 0.52, 0.42, 0.38, 0.41, 0.36, 0.30, 0.35, 0.28, 0.32, 0.25, 0.30, 0.38, 0.34, 0.40, 0.48, 0.55, 0.62, 0.58, 0.65, 0.72, 0.68, 0.75, 0.70, 0.80, 0.85, 0.78, 0.88, 0.82, 0.90, 0.95, 0.88, 0.92, 0.85, 0.90, 0.95, 1.00],
  '1': [0.80, 0.75, 0.78, 0.72, 0.70, 0.65, 0.60, 0.58, 0.55, 0.52, 0.48, 0.50, 0.45, 0.42, 0.40, 0.43, 0.46, 0.44, 0.41, 0.38, 0.36, 0.34, 0.30, 0.28, 0.32, 0.35, 0.38, 0.42, 0.44, 0.46, 0.48, 0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.65, 0.63],
  '2': [0.30, 0.32, 0.35, 0.38, 0.42, 0.45, 0.48, 0.52, 0.55, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74, 0.75, 0.76, 0.78, 0.80, 0.82, 0.84, 0.85, 0.87, 0.88, 0.90, 0.91, 0.92, 0.93, 0.94, 0.95, 0.96, 0.97, 0.98, 0.99, 1.00, 0.99, 1.00],
};

function AreaChart({ walletId }: { walletId: string }) {
  const pts = CHART_POINTS[walletId] ?? CHART_POINTS['0'];
  const W = 560, H = 120, n = pts.length;
  const coords = pts.map((y, i) => ({ x: (i / (n - 1)) * W, y: H - y * H * 0.92 - 4 }));
  const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: '120px' }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`cg-${walletId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#beff00" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#beff00" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#cg-${walletId})`} />
      <path d={linePath} fill="none" stroke="#beff00" strokeWidth="1.5" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 10 10" fill="none">
      <path d="M5.5 1.5H8.5V4.5M8.5 1.5L4 6M3 2.5H1.5C1.2 2.5 1 2.7 1 3V8.5C1 8.8 1.2 9 1.5 9H7C7.3 9 7.5 8.8 7.5 8.5V7"
        stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Live data helpers ─────────────────────────────────────────────────────────

function groupNftsByCollection(owned: OwnedNft[]) {
  const COLORS = ['#f59e0b', '#f87171', '#60a5fa', '#34d399', '#a78bfa', '#fbbf24', '#06b6d4'];
  const map = new Map<string, { name: string; color: string; count: number; floor: string; change: string; neg: boolean; topPrice: string; vol24h: string; sales24h: number; supply: number; avgPa: string; }>();
  let ci = 0;
  for (const nft of owned) {
    const key = nft.contract.opensea_collection_name || nft.contract.name || nft.contract.address;
    if (!map.has(key)) {
      const floorEth = nft.contract.opensea_floor_price ?? 0;
      map.set(key, { name: key, color: COLORS[ci++ % COLORS.length], count: 0, floor: floorEth ? `${floorEth} ETH` : '—', change: '—', neg: false, topPrice: '—', vol24h: '—', sales24h: 0, supply: 0, avgPa: '—' });
    }
    map.get(key)!.count++;
  }
  return Array.from(map.values());
}

function mapTransfer(t: AssetTransfer, walletAddress: string) {
  const isOut = t.from.toLowerCase() === walletAddress.toLowerCase();
  const typeMap: Record<string, TxType> = { external: isOut ? 'Send' : 'Receive', erc20: 'Swap', erc721: 'NFT', erc1155: 'NFT' };
  const type = typeMap[t.category] ?? 'Receive';
  let age = '—';
  if (t.metadata?.block_timestamp) {
    const s = Math.floor((Date.now() - new Date(t.metadata.block_timestamp).getTime()) / 1000);
    if (s < 3600) age = `${Math.floor(s / 60)}m ago`;
    else if (s < 86400) age = `${Math.floor(s / 3600)}h ago`;
    else age = `${Math.floor(s / 86400)}d ago`;
  }
  return {
    hash: t.hash,
    type,
    block: String(parseInt(t.block_num, 16)),
    age,
    from: t.from,
    to: t.to ?? '—',
    token: t.asset ?? (t.category === 'erc721' || t.category === 'erc1155' ? 'NFT' : 'ETH'),
    amount: t.value !== undefined ? `${t.value} ${t.asset ?? 'ETH'}` : '—',
    gas: '—',
  };
}

/** Build a wallet config for an arbitrary stored wallet whose id isn't in
 *  WALLET_CONFIGS (anything added via the dashboard "Add wallet" modal gets
 *  a Date.now() id). Keeps the analytics mock layout while making header
 *  fields (name, address, badge) reflect the actual wallet the user clicked. */
function syntheticConfig(
  id: string,
  name: string,
  address: string,
): (typeof WALLET_CONFIGS)[number] {
  const template = WALLET_CONFIGS[0];
  return {
    ...template,
    id,
    name,
    address,
    badge: 'ETH',
    totalValue: '—',
    unrealizedPnl: '—',
    analytics: {
      ...template.analytics,
      portfolioValue: '—',
      portfolioChange: '—',
    },
  };
}

export default function WalletDetailClient({ id }: { id: string }) {
  // Resolve the wallet: prefer WALLET_CONFIGS (has analytics mocks), fall back
  // to the stored record so user-added wallets show their own name/address
  // instead of silently loading Main Wallet data.
  const walletFromConfig = WALLET_CONFIGS.find(w => w.id === id);
  const storedLookup = typeof window !== 'undefined'
    ? loadWallets().find(w => w.id === id)
    : undefined;
  const wallet: (typeof WALLET_CONFIGS)[number] = walletFromConfig
    ?? (storedLookup
      ? syntheticConfig(id, storedLookup.name, storedLookup.address)
      : WALLET_CONFIGS[0]);
  const [tab, setTab] = useState<Tab>('Holdings');
  const [timeFilter, setTimeFilter] = useState<string>('24h');

  // ── Live data ──────────────────────────────────────────────────────────────
  const [isTauri, setIsTauri] = useState(false);
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [liveNfts, setLiveNfts] = useState<OwnedNft[] | null>(null);
  const [liveTxs, setLiveTxs] = useState<ReturnType<typeof mapTransfer>[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);

    if (!inTauri) {
      setSnapshot(MOCK_PORTFOLIO_SNAPSHOT);
      setLiveNfts(MOCK_NFTS_RESPONSE.owned_nfts);
      const stored = loadWallets();
      const addr = stored.find(w => w.id === id)?.address ?? '';
      setLiveTxs(MOCK_TRANSFERS.map(t => mapTransfer(t, addr)));
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const apiKey = await loadAlchemyKey().catch(() => '');
        if (!apiKey) { setLoading(false); return; }

        const stored = loadWallets();
        const walletRecord = stored.find(w => w.id === id);
        const address = walletRecord?.address ?? wallet.address;

        const [snap, nftRes, transfers] = await Promise.allSettled([
          getPortfolioSnapshot(address, apiKey),
          getNftsForOwner(address, apiKey),
          getAssetTransfers(address, apiKey),
        ]);

        if (snap.status === 'fulfilled') setSnapshot(snap.value);
        if (nftRes.status === 'fulfilled') setLiveNfts(nftRes.value.owned_nfts);
        if (transfers.status === 'fulfilled') setLiveTxs(transfers.value.map(t => mapTransfer(t, address)));
      } catch {}
      setLoading(false);
    })();
  }, [id]);

  // Merge live data with static fallbacks
  const snap = snapshot ?? null;
  const displayTotalValue = snap ? `$${snap.portfolio_value_usd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : wallet.totalValue;
  const displayNftCount   = snap?.nft_count   ?? wallet.totalNfts;
  const displayTokenCount = snap?.token_count  ?? wallet.totalTokens;
  const displayEthBalance = snap?.eth_balance !== undefined ? `${snap.eth_balance.toFixed(4)} ETH` : null;

  const liveNftGroups = liveNfts ? groupNftsByCollection(liveNfts) : null;
  const displayNfts   = liveNftGroups ?? NFT_DATA[id] ?? [];
  const displayTxs    = liveTxs ?? TX_DATA[id] ?? [];

  const tokens = TOKEN_DATA[id] ?? [];
  const topCols = TOP_COLLECTIONS[id] ?? [];

  return (
    <main className="min-h-full bg-[#000000] text-white px-12 py-8">

      {/* Breadcrumb */}
      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginBottom: '20px', display: 'flex', gap: '6px', alignItems: 'center' }}>
        <Link href="/" style={{ color: 'var(--wr-accent)', textDecoration: 'none' }}>Dashboard</Link>
        <span>›</span>
        <span style={{ color: 'var(--wr-text)' }}>{wallet.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '22px', fontWeight: 700, color: 'var(--wr-text)' }}>
              {wallet.name}
            </h1>
            <Tag variant={WALLET_TOKEN_VARIANT[wallet.badge] ?? 'neutral'}>{wallet.badge}</Tag>
          </div>
          <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>
            {wallet.address}
          </p>
        </div>
        <a
          href={`https://etherscan.io/address/${wallet.address}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)',
            border: '1px solid var(--wr-border)', padding: '6px 12px', textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}
          className="hover:text-[#a1a1aa] hover:border-[var(--wr-border-hover)] transition-colors"
        >
          Etherscan <ExternalLinkIcon />
        </a>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-[var(--wr-border)] mb-6">
        {(['Holdings', 'Transactions', 'Analytics'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500,
              padding: '10px 18px',
              borderBottom: tab === t ? '2px solid var(--wr-accent)' : '2px solid transparent',
              color: tab === t ? 'var(--wr-accent)' : 'var(--wr-text-3)',
              background: 'none', border: 'none',
              borderBottomWidth: '2px',
              borderBottomStyle: 'solid',
              borderBottomColor: tab === t ? 'var(--wr-accent)' : 'transparent',
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
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
            {[
              { label: 'Total Value',    value: displayTotalValue,                           color: 'var(--wr-text)' },
              { label: 'Total NFTs',     value: String(displayNftCount),                     color: 'var(--wr-text)' },
              { label: 'Total Tokens',   value: String(displayTokenCount),                   color: 'var(--wr-text)' },
              { label: 'Unrealized PnL', value: wallet.unrealizedPnl, color: wallet.pnlPos ? '#34d399' : '#f87171' },
            ].map(card => (
              <div key={card.label} style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
                <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
                  {card.label}
                </p>
                <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700, color: card.color }}>
                  {card.value}
                </p>
              </div>
            ))}
          </div>

          {/* NFT Holdings */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                NFT Holdings
              </h2>
              <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, backgroundColor: '#BEFF00', color: '#000', padding: '6px 14px', border: 'none', cursor: 'pointer' }}>
                Bulk Actions →
              </button>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
                style={{ gridTemplateColumns: '2fr 60px 80px 70px 80px 90px 80px 60px 70px', columnGap: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface)' }}>
                <div>Collection</div>
                <div className="text-right">Count</div>
                <div className="text-right">Floor</div>
                <div className="text-right">Change</div>
                <div className="text-right">Top Price</div>
                <div className="text-right">24h Vol</div>
                <div className="text-right">24h Sales</div>
                <div className="text-right">Supply</div>
                <div className="text-right">Avg P/A</div>
              </div>
              {displayNfts.map((nft) => (
                <div key={nft.name}
                  className="grid px-4 py-3 border-b border-[var(--wr-border)] last:border-b-0 items-center hover:bg-[var(--wr-overlay)] transition-colors"
                  style={{ gridTemplateColumns: '2fr 60px 80px 70px 80px 90px 80px 60px 70px', columnGap: '16px' }}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 shrink-0 flex items-center justify-center text-[10px] font-bold text-black"
                      style={{ backgroundColor: nft.color }}>{nft.name[0]}</span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)' }}>{nft.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] font-bold text-black px-1.5 py-0.5" style={{ backgroundColor: nft.color }}>{nft.count}</span>
                  </div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{nft.floor}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: nft.neg ? '#f87171' : '#34d399', fontWeight: 500 }}>{nft.change}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{nft.topPrice}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{nft.vol24h}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{nft.sales24h || '—'}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{nft.supply.toLocaleString()}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{nft.avgPa}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Token Holdings */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                Token Holdings
              </h2>
              <button className="btn-cta" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, backgroundColor: '#BEFF00', color: '#000', padding: '6px 14px', border: 'none', cursor: 'pointer' }}>
                Bulk Actions →
              </button>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
                style={{ gridTemplateColumns: '2fr 120px 100px 90px 100px', columnGap: '16px', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', backgroundColor: 'var(--wr-surface)' }}>
                <div>Token</div>
                <div className="text-right">Holdings</div>
                <div className="text-right">Price</div>
                <div className="text-right">24h Change</div>
                <div className="text-right">30d Change</div>
              </div>
              {tokens.map((tok) => (
                <div key={tok.ticker}
                  className="grid px-4 py-3 border-b border-[var(--wr-border)] last:border-b-0 items-center hover:bg-[var(--wr-overlay)] transition-colors"
                  style={{ gridTemplateColumns: '2fr 120px 100px 90px 100px', columnGap: '16px' }}>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-black"
                      style={{ backgroundColor: tok.color }}>{tok.ticker[0]}</span>
                    <div>
                      <div style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 500, color: 'var(--wr-text)' }}>{tok.name}</div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>{tok.ticker}</div>
                    </div>
                  </div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)' }}>{tok.holding}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{tok.price}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: tok.change24h.startsWith('+') ? '#34d399' : '#f87171' }}>{tok.change24h}</div>
                  <div className="text-right" style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: tok.change30.startsWith('+') ? '#34d399' : '#f87171' }}>{tok.change30}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── TRANSACTIONS TAB ── */}
      {tab === 'Transactions' && (
        <div style={{ backgroundColor: 'var(--wr-surface-alt)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          <div className="grid px-4 py-2.5 border-b border-[var(--wr-border)]"
            style={{ gridTemplateColumns: '1.8fr 0.8fr 1fr 0.8fr 1.4fr 1.4fr 0.8fr 0.8fr 1fr', columnGap: '16px', backgroundColor: 'var(--wr-surface)', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>
            <span>Tx Hash</span>
            <span>Type</span>
            <span>Block</span>
            <span>Age</span>
            <span>From</span>
            <span>To</span>
            <span>Token</span>
            <span>Amount</span>
            <span>Gas Fee</span>
          </div>
          {displayTxs.map((tx, i) => {
            const ts = TX_STYLE[tx.type];
            return (
              <div key={i}
                className="grid px-4 py-3.5 border-b border-[var(--wr-border)] last:border-b-0 hover:bg-[var(--wr-surface)] transition-colors items-center"
                style={{ gridTemplateColumns: '1.8fr 0.8fr 1fr 0.8fr 1.4fr 1.4fr 0.8fr 0.8fr 1fr', columnGap: '16px' }}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span style={{ color: '#3b82f6', fontSize: '12px', fontFamily: 'var(--font-jetbrains)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.hash}</span>
                  <a href={`https://etherscan.io/tx/${tx.hash}`} target="_blank" rel="noopener noreferrer"
                    style={{ flexShrink: 0, color: 'var(--wr-text-3)', display: 'flex' }} className="hover:text-[#a1a1aa] transition-colors">
                    <ExternalLinkIcon />
                  </a>
                </div>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: ts.text, backgroundColor: ts.bg, border: `1px solid ${ts.border}`, padding: '2px 8px', display: 'inline-block' }}>{tx.type}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#3b82f6' }}>{tx.block}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.age}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#A1A1AA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.from}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#A1A1AA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.to}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.token}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>{tx.amount}</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>{tx.gas}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── ANALYTICS TAB ── */}
      {tab === 'Analytics' && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Total Action</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>{wallet.analytics.totalAction}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#34d399', marginTop: '4px' }}>{wallet.analytics.actionPct}</p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Best Performer</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 700 }}>{wallet.analytics.bestPerformer}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#34d399', marginTop: '4px' }}>{wallet.analytics.bestPct}</p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Worst Performer</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '16px', fontWeight: 700 }}>{wallet.analytics.worstPerformer}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#f87171', marginTop: '4px' }}>{wallet.analytics.worstPct}</p>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Avg Hold Time</p>
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>{wallet.analytics.avgHoldTime}</p>
            </div>
          </div>

          {/* Portfolio Value chart */}
          <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px', marginBottom: '24px' }}>
            <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '16px' }}>
              Portfolio Value
            </p>
            <div className="flex items-center gap-1 mb-4">
              {TIME_FILTERS.map((f) => (
                <button key={f} onClick={() => setTimeFilter(f)}
                  className={timeFilter === f ? 'btn-cta' : ''}
                  style={{
                    fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600,
                    padding: '4px 10px', cursor: 'pointer',
                    backgroundColor: timeFilter === f ? '#BEFF00' : 'transparent',
                    color: timeFilter === f ? '#000' : '#6e6e6e',
                    border: 'none',
                  }}>
                  {f}
                </button>
              ))}
            </div>
            <div className="mb-2">
              <p style={{ fontFamily: 'var(--font-inter)', fontSize: '22px', fontWeight: 700 }}>{wallet.analytics.portfolioValue}</p>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#34d399' }}>{wallet.analytics.portfolioChange} (USD)</p>
            </div>
            <div className="mt-4">
              <AreaChart walletId={id} />
            </div>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-2 gap-4">
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '20px' }}>
                Trading Performance
              </p>
              <div className="flex items-end gap-8">
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Total Trades</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>{wallet.analytics.totalTrades}</p>
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Win Rate</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '28px', fontWeight: 700, color: 'var(--wr-accent)' }}>{wallet.analytics.winRate}</p>
                </div>
                <div>
                  <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '4px' }}>Avg Price</p>
                  <p style={{ fontFamily: 'var(--font-inter)', fontSize: '20px', fontWeight: 700 }}>{wallet.analytics.avgPrice}</p>
                </div>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px' }}>
              <p style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '16px' }}>
                Top Collections by Value
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {topCols.map((col, i) => (
                  <div key={col.name} className="flex items-center gap-3">
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', width: '16px', flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', color: 'var(--wr-text)', flex: 1 }}>{col.name}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{col.eth}</span>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', width: '36px', textAlign: 'right' }}>{col.pct}%</span>
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
