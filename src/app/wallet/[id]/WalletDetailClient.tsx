'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getPortfolioSnapshot, getNftsForOwner, getAssetTransfers, loadAlchemyKey, getPrivateKey,
  type PortfolioSnapshot, type OwnedNft, type AssetTransfer,
} from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { persistTask } from '@/lib/taskStore';
import { getSwapQuote, type SwapQuote } from '@/lib/uniswap';
import { executeSwap, type SwapStatus } from '@/lib/swap';
import { parseUnits } from 'viem';
import { loadAddressBook, saveAddressEntry, deleteAddressEntry, updateAddressEntry, type AddressEntry } from '@/lib/addressBook';
import { MOCK_PORTFOLIO_SNAPSHOT, MOCK_NFTS_RESPONSE, MOCK_TRANSFERS } from '@/lib/mockData';
import { Tag, WALLET_TOKEN_VARIANT } from '@/components/Tag';

// ─── Wallet Detail Client ─────────────────────────────────────────────────────

type Tab = 'Holdings' | 'Transactions' | 'Analytics' | 'Address Book';
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
  name: string; ticker: string; color: string; verified: boolean; walletCount: number;
  heldValue: string; heldQty: string; price: string; fdv: string;
  change1d: string; change7d: string; vol1d: string;
}>> = {
  '0': [
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', verified: true,  walletCount: 4, heldValue: '$45,200', heldQty: '15.89',    price: '$2,842',  fdv: '$340B',  change1d: '+1.4%',  change7d: '+8.2%',   vol1d: '$14.2B' },
    { name: 'USD Coin',    ticker: 'USDC', color: '#2775ca', verified: true,  walletCount: 2, heldValue: '$15,000', heldQty: '15,000',   price: '$1.00',   fdv: '$52B',   change1d: '+0.0%',  change7d: '+0.0%',   vol1d: '$8.1B'  },
    { name: 'Wrapped ETH', ticker: 'WETH', color: '#627eea', verified: true,  walletCount: 1, heldValue: '$12,400', heldQty: '4.36',     price: '$2,842',  fdv: '$340B',  change1d: '+1.4%',  change7d: '+8.2%',   vol1d: '$420M'  },
    { name: 'Uniswap',     ticker: 'UNI',  color: '#ff007a', verified: true,  walletCount: 1, heldValue: '$11,600', heldQty: '1,601.1',  price: '$7.24',   fdv: '$7.2B',  change1d: '-2.1%',  change7d: '+14.8%',  vol1d: '$310M'  },
  ],
  '1': [
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', verified: true,  walletCount: 2, heldValue: '$20,100', heldQty: '7.07',     price: '$2,842',  fdv: '$340B',  change1d: '+1.4%',  change7d: '+8.2%',   vol1d: '$14.2B' },
    { name: 'Binance Coin',ticker: 'BNB',  color: '#f3ba2f', verified: true,  walletCount: 1, heldValue: '$10,200', heldQty: '24.76',    price: '$412',    fdv: '$63B',   change1d: '-0.8%',  change7d: '+4.1%',   vol1d: '$1.8B'  },
    { name: 'Curve DAO',   ticker: 'CRV',  color: '#3a3a3a', verified: false, walletCount: 1, heldValue: '$8,190',  heldQty: '15,166',   price: '$0.54',   fdv: '$540M',  change1d: '-3.4%',  change7d: '-12.1%',  vol1d: '$88M'   },
  ],
  '2': [
    { name: 'Polygon',     ticker: 'MATIC',color: '#8247e5', verified: true,  walletCount: 2, heldValue: '$8,400',  heldQty: '10,769',   price: '$0.78',   fdv: '$7.8B',  change1d: '+2.1%',  change7d: '+2.0%',   vol1d: '$620M'  },
    { name: 'Ethereum',    ticker: 'ETH',  color: '#627eea', verified: true,  walletCount: 1, heldValue: '$5,600',  heldQty: '1.97',     price: '$2,842',  fdv: '$340B',  change1d: '+1.4%',  change7d: '+8.2%',   vol1d: '$14.2B' },
    { name: 'Aave',        ticker: 'AAVE', color: '#b6509e', verified: true,  walletCount: 1, heldValue: '$3,200',  heldQty: '25.81',    price: '$124',    fdv: '$1.8B',  change1d: '-1.2%',  change7d: '+18.4%',  vol1d: '$210M'  },
    { name: 'Chainlink',   ticker: 'LINK', color: '#2a5ada', verified: true,  walletCount: 1, heldValue: '$1,800',  heldQty: '126.76',   price: '$14.2',   fdv: '$14.2B', change1d: '+3.8%',  change7d: '+22.1%',  vol1d: '$980M'  },
    { name: 'Synthetix',   ticker: 'SNX',  color: '#00d1ff', verified: false, walletCount: 1, heldValue: '$700',    heldQty: '224.36',   price: '$3.12',   fdv: '$940M',  change1d: '-0.5%',  change7d: '+5.3%',   vol1d: '$42M'   },
    { name: 'USD Coin',    ticker: 'USDC', color: '#2775ca', verified: true,  walletCount: 1, heldValue: '$441',    heldQty: '441',      price: '$1.00',   fdv: '$52B',   change1d: '+0.0%',  change7d: '+0.0%',   vol1d: '$8.1B'  },
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

// ── Transfer Modal ────────────────────────────────────────────────────────────

function EthIcon() {
  return (
    <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
      <path d="M6 0L0 10.2L6 13.6L12 10.2L6 0Z" fill="#627EEA" opacity="0.9"/>
      <path d="M6 0L0 10.2L6 13.6V0Z" fill="#627EEA" opacity="0.6"/>
      <path d="M6 15.2L0 11.8L6 20L12 11.8L6 15.2Z" fill="#627EEA" opacity="0.9"/>
      <path d="M6 15.2L0 11.8L6 20V15.2Z" fill="#627EEA" opacity="0.6"/>
    </svg>
  );
}

type TxStatus = { label: string; address: string; amount: string; status: 'pending' | 'broadcasting' | 'confirmed' | 'failed'; hash?: string };

function TransferModal({ wallet, onClose }: { wallet: { id: string; name: string; address: string }; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const managedWallets = loadWallets().filter(w => w.id !== wallet.id);
  const addressBookEntries = loadAddressBook();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [abSelected, setAbSelected] = useState<Set<string>>(new Set());
  const [abAmounts, setAbAmounts] = useState<Record<string, string>>({});
  const [externals, setExternals] = useState([{ address: '', amount: '' }]);
  const [txStatuses, setTxStatuses] = useState<TxStatus[]>([]);

  const toggleWallet = (wid: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(wid)) { next.delete(wid); setAmounts(a => { const n = { ...a }; delete n[wid]; return n; }); }
      else next.add(wid);
      return next;
    });
  };

  const toggleAb = (id: string) => {
    setAbSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); setAbAmounts(a => { const n = { ...a }; delete n[id]; return n; }); }
      else next.add(id);
      return next;
    });
  };

  const updateExternal = (i: number, field: 'address' | 'amount', val: string) =>
    setExternals(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  const addExternal = () => setExternals(prev => [...prev, { address: '', amount: '' }]);

  const hasExternal = externals.some(e => e.address.trim().length > 0);
  const canProceed = selected.size > 0 || abSelected.size > 0 || hasExternal;

  const confirmTransfer = () => {
    const entries: TxStatus[] = [
      ...Array.from(selected).map(wid => {
        const mw = managedWallets.find(w => w.id === wid);
        return { label: mw?.name ?? wid, address: mw?.address ?? wid, amount: amounts[wid] ?? '—', status: 'pending' as const };
      }),
      ...Array.from(abSelected).map(id => {
        const ab = addressBookEntries.find(e => e.id === id);
        return { label: ab?.name ?? id, address: ab?.address ?? id, amount: abAmounts[id] ?? '—', status: 'pending' as const };
      }),
      ...externals.filter(e => e.address.trim()).map(e => ({
        label: `${e.address.slice(0, 6)}…${e.address.slice(-4)}`, address: e.address, amount: e.amount || '—', status: 'pending' as const,
      })),
    ];
    setTxStatuses(entries);
    entries.forEach((_, i) => {
      setTimeout(() => setTxStatuses(prev => prev.map((t, j) => j === i ? { ...t, status: 'broadcasting' } : t)), 600 + i * 800);
      setTimeout(() => {
        const hash = `0x${Math.random().toString(16).slice(2, 10)}…${Math.random().toString(16).slice(2, 6)}`;
        setTxStatuses(prev => prev.map((t, j) => j === i ? { ...t, status: 'confirmed', hash } : t));
      }, 2200 + i * 800);
    });
  };

  const btnPrimary: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#BEFF00', border: 'none', padding: '8px 16px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' };
  const btnSecondary: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 16px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' };
  const inputStyle: React.CSSProperties = { fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '8px 10px', width: '100%', outline: 'none', boxSizing: 'border-box' };

  const hasMonitor = txStatuses.length > 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', width: hasMonitor ? '860px' : '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'row', overflow: 'hidden', transition: 'width 0.2s ease' }}>
        {/* Left column */}
        <div style={{ width: '560px', flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: hasMonitor ? '1px solid var(--wr-border)' : 'none', maxHeight: '80vh', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--wr-border)' }}>
          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text)' }}>Transfer Funds</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Step 1 — Select destinations */}
        {step === 1 && (
          <>
            <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
              {/* FROM */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>From</div>
                <div style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)' }}>{wallet.name}</div>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '380px' }}>{wallet.address}</div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: '#BEFF00', letterSpacing: '1px', textTransform: 'uppercase', border: '1px solid #BEFF00', padding: '2px 8px', flexShrink: 0 }}>Active</div>
                </div>
              </div>

              {/* TO — managed wallets */}
              <div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>To</div>
                {managedWallets.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                    {managedWallets.map(w => {
                      const isSel = selected.has(w.id);
                      return (
                        <div
                          key={w.id}
                          onClick={() => toggleWallet(w.id)}
                          style={{ border: `1px solid ${isSel ? '#BEFF00' : 'var(--wr-border)'}`, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: isSel ? 'rgba(190,255,0,0.04)' : 'transparent' }}
                        >
                          <div style={{ width: '16px', height: '16px', border: `2px solid ${isSel ? '#BEFF00' : 'var(--wr-border)'}`, backgroundColor: isSel ? '#BEFF00' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isSel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{w.name}</div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.address}</div>
                          </div>
                          <div
                            onClick={e => { e.stopPropagation(); if (!isSel) toggleWallet(w.id); }}
                            style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', backgroundColor: '#111', width: '90px', flexShrink: 0, cursor: 'text' }}
                          >
                            <span style={{ padding: '4px 5px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', flexShrink: 0 }}>
                              <EthIcon />
                            </span>
                            <input
                              type="text"
                              placeholder="0.00"
                              value={amounts[w.id] ?? ''}
                              onFocus={() => { if (!isSel) toggleWallet(w.id); }}
                              onChange={e => setAmounts(a => ({ ...a, [w.id]: e.target.value }))}
                              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '4px 5px', width: '100%', outline: 'none', minWidth: 0, cursor: 'text' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Address Book entries */}
                {addressBookEntries.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '4px' }}>Address Book</div>
                    {addressBookEntries.map(ab => {
                      const isSel = abSelected.has(ab.id);
                      return (
                        <div
                          key={ab.id}
                          onClick={() => toggleAb(ab.id)}
                          style={{ border: `1px solid ${isSel ? '#BEFF00' : 'var(--wr-border)'}`, padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: isSel ? 'rgba(190,255,0,0.04)' : 'transparent' }}
                        >
                          <div style={{ width: '16px', height: '16px', border: `2px solid ${isSel ? '#BEFF00' : 'var(--wr-border)'}`, backgroundColor: isSel ? '#BEFF00' : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {isSel && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{ab.name}</span>
                              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#BEFF00', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                            </div>
                            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.address}</div>
                          </div>
                          <div
                            onClick={e => { e.stopPropagation(); if (!isSel) toggleAb(ab.id); }}
                            style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', backgroundColor: '#111', width: '90px', flexShrink: 0, cursor: 'text' }}
                          >
                            <span style={{ padding: '4px 5px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', flexShrink: 0 }}>
                              <EthIcon />
                            </span>
                            <input
                              type="text"
                              placeholder="0.00"
                              value={abAmounts[ab.id] ?? ''}
                              onFocus={() => { if (!isSel) toggleAb(ab.id); }}
                              onChange={e => setAbAmounts(a => ({ ...a, [ab.id]: e.target.value }))}
                              style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '4px 5px', width: '100%', outline: 'none', minWidth: 0, cursor: 'text' }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* External wallets */}
                <div style={{ border: '1px solid var(--wr-border)', padding: '14px' }}>
                  <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '8px' }}>External Wallet</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {externals.map((ext, i) => (
                      <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                        <input
                          type="text"
                          placeholder="0x… wallet address"
                          value={ext.address}
                          onChange={e => updateExternal(i, 'address', e.target.value)}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--wr-border)', flexShrink: 0, width: '110px' }}>
                          <span style={{ padding: '0 7px', display: 'flex', alignItems: 'center', borderRight: '1px solid var(--wr-border)', alignSelf: 'stretch', justifyContent: 'center' }}>
                            <EthIcon />
                          </span>
                          <input
                            type="text"
                            placeholder="0.00"
                            value={ext.amount}
                            onChange={e => updateExternal(i, 'amount', e.target.value)}
                            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', padding: '8px 6px', width: '100%', outline: 'none', minWidth: 0 }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={addExternal}
                    style={{ marginTop: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#BEFF00', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  >
                    + Add another wallet
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
              <button onClick={onClose} style={btnSecondary}>Cancel</button>
              <button
                disabled={!canProceed}
                onClick={() => setStep(2)}
                style={{ ...btnPrimary, opacity: canProceed ? 1 : 0.4, cursor: canProceed ? 'pointer' : 'default' }}
              >
                Review →
              </button>
            </div>
          </>
        )}

        {/* Step 2 — Confirm */}
        {step === 2 && (
          <>
            <div style={{ padding: '20px', flex: 1, overflowY: 'auto' }}>
              <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--wr-text-3)', marginBottom: '12px' }}>Confirm Transfer</div>
              <div style={{ border: '1px solid var(--wr-border)', padding: '14px', marginBottom: '10px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '1px' }}>From</div>
                <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{wallet.name}</div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '2px' }}>{wallet.address}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                {Array.from(selected).map(wid => {
                  const mw = managedWallets.find(w => w.id === wid);
                  if (!mw) return null;
                  return (
                    <div key={wid} style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{mw.name}</div>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mw.address}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', flexShrink: 0, marginLeft: '12px' }}>{amounts[wid] ? `${amounts[wid]} ETH` : '—'}</div>
                    </div>
                  );
                })}
                {Array.from(abSelected).map(id => {
                  const ab = addressBookEntries.find(e => e.id === id);
                  if (!ab) return null;
                  return (
                    <div key={id} style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{ab.name}</div>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: '#BEFF00', border: '1px solid rgba(190,255,0,0.4)', padding: '1px 5px', letterSpacing: '0.5px' }}>BOOK</span>
                        </div>
                        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ab.address}</div>
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', flexShrink: 0, marginLeft: '12px' }}>{abAmounts[id] ? `${abAmounts[id]} ETH` : '—'}</div>
                    </div>
                  );
                })}
                {externals.filter(e => e.address.trim()).map((ext, i) => (
                  <div key={`ext-${i}`} style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>External</div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '340px' }}>{ext.address}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', flexShrink: 0, marginLeft: '12px' }}>{ext.amount ? `${ext.amount} ETH` : '—'}</div>
                  </div>
                ))}
              </div>
              <div style={{ border: '1px solid var(--wr-border)', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(190,255,0,0.03)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px' }}>Est. Gas Fee</span>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)' }}>~0.0012 ETH</span>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '16px 20px', borderTop: '1px solid var(--wr-border)' }}>
              <button onClick={() => setStep(1)} style={btnSecondary}>← Back</button>
              <button
                onClick={() => { if (!hasMonitor) confirmTransfer(); }}
                style={{ ...btnPrimary, opacity: hasMonitor ? 0.35 : 1, cursor: hasMonitor ? 'default' : 'pointer' }}
              >Confirm Transfer</button>
            </div>
          </>
        )}
        </div>{/* end left column */}

        {/* Right column — Monitor */}
        {hasMonitor && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#0a0a0a', maxHeight: '80vh' }}>
            {/* Monitor header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--wr-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text-3)' }}>Monitor</span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                {txStatuses.filter(t => t.status === 'confirmed').length}/{txStatuses.length} confirmed
              </span>
            </div>
            {/* Tx list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {txStatuses.map((tx, i) => {
                const statusColor = tx.status === 'confirmed' ? '#34d399' : tx.status === 'failed' ? '#f87171' : tx.status === 'broadcasting' ? '#BEFF00' : '#a1a1aa';
                const statusLabel = tx.status === 'confirmed' ? 'Confirmed' : tx.status === 'failed' ? 'Failed' : tx.status === 'broadcasting' ? 'Broadcasting…' : 'Pending';
                return (
                  <div key={i} style={{ border: '1px solid var(--wr-border)', padding: '10px 12px', backgroundColor: 'var(--wr-surface)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', backgroundColor: statusColor, flexShrink: 0, boxShadow: tx.status === 'broadcasting' ? `0 0 6px ${statusColor}` : 'none' }} />
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '12px', fontWeight: 600, color: 'var(--wr-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.label}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: 'var(--wr-text)', flexShrink: 0, marginLeft: '8px' }}>{tx.amount !== '—' ? `${tx.amount} ETH` : '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingLeft: '15px' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: statusColor, letterSpacing: '0.5px' }}>{statusLabel}</span>
                      {tx.hash && (
                        <a
                          href={`https://etherscan.io/tx/${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '3px', textDecoration: 'none' }}
                        >
                          {tx.hash.slice(0, 10)}… <ExternalLinkIcon />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Monitor footer */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--wr-border)' }}>
              <button onClick={onClose} style={btnSecondary}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Swap / Buy Modal ──────────────────────────────────────────────────────────

const ETH_TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',        color: '#627EEA' },
  { symbol: 'USDC', name: 'USD Coin',         color: '#2775CA' },
  { symbol: 'USDT', name: 'Tether',           color: '#26A17B' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin',  color: '#F7931A' },
  { symbol: 'LINK', name: 'Chainlink',        color: '#375BD2' },
  { symbol: 'UNI',  name: 'Uniswap',         color: '#FF007A' },
  { symbol: 'AAVE', name: 'Aave',            color: '#B6509E' },
  { symbol: 'PEPE', name: 'Pepe',            color: '#00b04f' },
];

const MOCK_RATES: Record<string, number> = {
  ETH: 3200, USDC: 1, USDT: 1, WBTC: 62000,
  LINK: 14, UNI: 8, AAVE: 95, PEPE: 0.0000142,
};

function TokenIcon({ symbol, color, size = 28 }: { symbol: string; color: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: Math.round(size * 0.38) + 'px', fontWeight: 700, color: '#fff' }}>{symbol[0]}</span>
    </div>
  );
}

// ─── Address Book ─────────────────────────────────────────────────────────────

function AddressBookTab() {
  const [entries, setEntries] = useState<AddressEntry[]>([]);
  const [nameInput, setNameInput] = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => { setEntries(loadAddressBook()); }, []);

  const isValidAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a.trim());

  function handleAdd() {
    if (!nameInput.trim() || !isValidAddress(addressInput)) return;
    const entry: AddressEntry = {
      id: String(Date.now()),
      name: nameInput.trim(),
      address: addressInput.trim().toLowerCase() as `0x${string}`,
      note: noteInput.trim() || undefined,
      createdAt: Date.now(),
    };
    saveAddressEntry(entry);
    setEntries(loadAddressBook());
    setNameInput(''); setAddressInput(''); setNoteInput('');
  }

  function handleDelete(id: string) {
    deleteAddressEntry(id);
    setEntries(loadAddressBook());
  }

  function handleSaveEdit(id: string) {
    updateAddressEntry(id, { name: editName.trim(), note: editNote.trim() || undefined });
    setEntries(loadAddressBook());
    setEditingId(null);
  }

  function handleCopy(address: string) {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(address);
    setTimeout(() => setCopied(null), 1500);
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)',
    backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)',
    padding: '8px 12px', outline: 'none', width: '100%',
  };

  return (
    <div>
      {/* Add form */}
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', padding: '20px', marginBottom: '20px' }}>
        <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '14px' }}>Add Address</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1.5fr auto', gap: '8px', alignItems: 'end' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Name</div>
            <input
              style={inputStyle} placeholder="Vitalik" value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Wallet Address</div>
            <input
              style={{ ...inputStyle, borderColor: addressInput && !isValidAddress(addressInput) ? 'rgba(248,113,113,0.6)' : 'var(--wr-border)' }}
              placeholder="0x..." value={addressInput}
              onChange={e => setAddressInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Note (optional)</div>
            <input
              style={inputStyle} placeholder="e.g. team treasury" value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!nameInput.trim() || !isValidAddress(addressInput)}
            style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', padding: '8px 18px', border: 'none', cursor: nameInput.trim() && isValidAddress(addressInput) ? 'pointer' : 'default', backgroundColor: nameInput.trim() && isValidAddress(addressInput) ? '#BEFF00' : 'rgba(255,255,255,0.06)', color: nameInput.trim() && isValidAddress(addressInput) ? '#000' : 'var(--wr-text-3)', whiteSpace: 'nowrap' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Entry list */}
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>
          No addresses saved yet. Add one above.
        </div>
      ) : (
        <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px 120px', alignItems: 'center', padding: '0 20px', height: '38px', borderBottom: '1px solid var(--wr-border)', columnGap: '16px' }}>
            {(['NAME', 'ADDRESS', 'NOTE', ''] as const).map(h => (
              <div key={h} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>{h}</div>
            ))}
          </div>
          {entries.map(entry => (
            <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px 120px', alignItems: 'center', padding: '0 20px', minHeight: '54px', borderBottom: '1px solid var(--wr-border)', columnGap: '16px' }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
            >
              {/* Name */}
              <div>
                {editingId === entry.id ? (
                  <input
                    autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(entry.id); if (e.key === 'Escape') setEditingId(null); }}
                    style={{ ...inputStyle, padding: '4px 8px', width: '100%' }}
                  />
                ) : (
                  <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)' }}>{entry.name}</div>
                )}
              </div>
              {/* Address */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.address.slice(0, 10)}…{entry.address.slice(-8)}
                </span>
                <button
                  onClick={() => handleCopy(entry.address)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: copied === entry.address ? '#BEFF00' : 'var(--wr-text-3)', flexShrink: 0 }}
                  title="Copy address"
                >
                  {copied === entry.address ? (
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7L5 10L11 3" stroke="#BEFF00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="4" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.3"/><path d="M1 4v8h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  )}
                </button>
                <a href={`https://etherscan.io/address/${entry.address}`} target="_blank" rel="noopener noreferrer"
                  style={{ color: 'var(--wr-text-3)', flexShrink: 0, display: 'flex' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V7M8 1h3m0 0v3M11 1L5.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </a>
              </div>
              {/* Note */}
              <div>
                {editingId === entry.id ? (
                  <input
                    value={editNote} onChange={e => setEditNote(e.target.value)}
                    placeholder="note"
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(entry.id); if (e.key === 'Escape') setEditingId(null); }}
                    style={{ ...inputStyle, padding: '4px 8px', width: '100%' }}
                  />
                ) : (
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>{entry.note ?? '—'}</span>
                )}
              </div>
              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                {editingId === entry.id ? (
                  <>
                    <button onClick={() => handleSaveEdit(entry.id)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: '#000', backgroundColor: '#BEFF00', border: 'none', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}>Save</button>
                    <button onClick={() => setEditingId(null)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingId(entry.id); setEditName(entry.name); setEditNote(entry.note ?? ''); }}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', background: 'none', border: '1px solid var(--wr-border)', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}
                    >Edit</button>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#f87171', background: 'none', border: '1px solid rgba(248,113,113,0.3)', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.5px' }}
                    >Delete</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Swap ─────────────────────────────────────────────────────────────────────

type ExecStage = 'idle' | 'quoting' | 'ready' | 'checking-allowance' | 'approving' | 'waiting-approve' | 'swapping' | 'waiting-swap' | 'confirmed' | 'error';

const STAGE_LABEL: Record<ExecStage, string> = {
  idle: '',
  quoting: 'Fetching best route...',
  ready: '',
  'checking-allowance': 'Checking token approval...',
  approving: 'Approving token spend...',
  'waiting-approve': 'Waiting for approval tx...',
  swapping: 'Sending swap transaction...',
  'waiting-swap': 'Waiting for confirmation...',
  confirmed: 'Swap confirmed',
  error: '',
};

function SwapModal({ mode, onClose, sellTicker = 'ETH', sellColor = '#627EEA', sellName = 'Ethereum', walletAddress = '', alchemyKey = '' }: { mode: 'swap' | 'buy'; onClose: () => void; sellTicker?: string; sellColor?: string; sellName?: string; walletAddress?: string; alchemyKey?: string }) {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const sellToken = sellTicker;
  const [buyToken, setBuyToken] = useState(sellTicker === 'USDC' ? 'ETH' : 'USDC');
  const [sellAmount, setSellAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [showTokenSearch, setShowTokenSearch] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const [stage, setStage] = useState<ExecStage>('idle');
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [txHash, setTxHash] = useState('');
  const [approveTxHash, setApproveTxHash] = useState('');
  const [execError, setExecError] = useState('');

  // Debounced quote fetch whenever amount or output token changes
  useEffect(() => {
    if (!sellAmount || parseFloat(sellAmount) <= 0 || orderType === 'limit') {
      setQuote(null);
      setStage('idle');
      return;
    }
    setStage('quoting');
    setQuoteError('');
    const t = setTimeout(async () => {
      try {
        const q = await getSwapQuote({ tokenIn: sellToken, tokenOut: buyToken, amountIn: sellAmount, recipient: walletAddress });
        setQuote(q);
        setStage('ready');
      } catch (err) {
        setQuoteError(err instanceof Error ? err.message : 'Failed to get quote');
        setQuote(null);
        setStage('error');
      }
    }, 600);
    return () => clearTimeout(t);
  }, [sellAmount, buyToken, sellToken, walletAddress, orderType]);

  const sellTok = ETH_TOKENS.find(t => t.symbol === sellToken) ?? { symbol: sellToken, name: sellName, color: sellColor };
  const buyTok  = ETH_TOKENS.find(t => t.symbol === buyToken) ?? ETH_TOKENS[1];
  const sellNum = parseFloat(sellAmount) || 0;
  const sellUsd = sellNum * (MOCK_RATES[sellToken] ?? 0);
  const isDone = (stage as string) === 'confirmed';
  const canExecute = (stage as string) === 'ready' && !!walletAddress && !!alchemyKey;
  const canLimitSubmit = orderType === 'limit' && sellNum > 0 && sellToken !== buyToken && !isDone;
  const isExecuting = ['checking-allowance','approving','waiting-approve','swapping','waiting-swap'].includes(stage as string);

  const panelStyle: React.CSSProperties = { backgroundColor: '#0d0d0d', border: '1px solid var(--wr-border)', padding: '14px 16px' };
  const tokenBtnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)', padding: '7px 11px', cursor: 'pointer' };

  const filteredTokens = ETH_TOKENS.filter(t =>
    t.symbol !== sellToken &&
    (tokenSearch === '' || t.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) || t.name.toLowerCase().includes(tokenSearch.toLowerCase()))
  );
  const quickTokens = ETH_TOKENS.filter(t => t.symbol !== sellToken).slice(0, 5);

  async function handleExecute() {
    if (!quote || !walletAddress || !alchemyKey) return;
    setExecError('');
    setApproveTxHash('');
    try {
      const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      let privateKeyHex = '';
      if (inTauri) {
        privateKeyHex = await getPrivateKey(walletAddress);
      } else {
        throw new Error('Swap execution requires the desktop app');
      }
      const result = await executeSwap({
        privateKeyHex,
        tokenIn: sellToken,
        calldata: quote.calldata,
        value: quote.value,
        routerAddress: quote.routerAddress,
        amountInRaw: parseUnits(sellAmount, (quote.amountInRaw.toString().length)),
        alchemyKey,
        onStatus: (s: SwapStatus) => setStage(s as ExecStage),
      });
      setTxHash(result.swapTxHash);
      if (result.approveTxHash) setApproveTxHash(result.approveTxHash);
      setStage('confirmed');
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Transaction failed');
      setStage('error');
    }
  }

  function handleLimitSubmit() {
    if (!canLimitSubmit) return;
    persistTask({
      id: String(Date.now()),
      iconChar: '⇄',
      iconBg: '#627EEA',
      label: `Limit ${sellTok.symbol} → ${buyTok.symbol} · ${sellAmount} ${sellTok.symbol}`,
      meta: `When 1 ${sellTok.symbol} = ${limitPrice || (MOCK_RATES[sellToken]?.toLocaleString() ?? '—')} USD`,
      status: 'Scheduled',
      tab: 'Scheduled',
    });
    setStage('confirmed');
    setTxHash('limit');
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget) { onClose(); } }}
    >
      <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', width: '460px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--wr-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--wr-text)' }}>
              {mode === 'swap' ? 'Swap' : 'Buy'}
            </span>
            <div style={{ display: 'flex' }}>
              {(['market', 'limit'] as const).map(t => (
                <button key={t} onClick={() => setOrderType(t)} style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', padding: '4px 10px', border: 'none', background: 'transparent', cursor: 'pointer', color: orderType === t ? '#BEFF00' : 'var(--wr-text-3)', borderBottom: orderType === t ? '2px solid #BEFF00' : '2px solid transparent' }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--wr-text-3)', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: '0' }}>

          {/* You Pay */}
          <div style={panelStyle}>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>You Pay</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                <TokenIcon symbol={sellTok.symbol} color={sellTok.color} />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{sellTok.symbol}</span>
              </div>
              <div style={{ textAlign: 'right', flex: 1, minWidth: 0 }}>
                <input
                  type="text" inputMode="decimal" placeholder="0.00"
                  value={sellAmount} onChange={e => setSellAmount(e.target.value)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '26px', fontWeight: 700, color: 'var(--wr-text)', background: '#0d0d0d', border: 'none', outline: 'none', boxShadow: 'none', WebkitAppearance: 'none', textAlign: 'right', width: '100%', padding: 0 }}
                />
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '4px' }}>
                  {sellUsd > 0 ? `$${sellUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '$0.00'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ height: '8px' }} />

          {/* You Receive */}
          <div style={panelStyle}>
            <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '14px' }}>You Receive</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
              <button style={tokenBtnStyle} onClick={() => { setShowTokenSearch(true); setTokenSearch(''); }}>
                <TokenIcon symbol={buyTok.symbol} color={buyTok.color} />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{buyTok.symbol}</span>
                <svg width="9" height="5" viewBox="0 0 9 5" fill="none"><path d="M1 1L4.5 4L8 1" stroke="var(--wr-text-3)" strokeWidth="1.4" strokeLinecap="round"/></svg>
              </button>
              <div style={{ textAlign: 'right', flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '26px', fontWeight: 700, color: quote ? 'var(--wr-text)' : stage === 'quoting' ? 'var(--wr-text-3)' : '#3f3f3f' }}>
                  {stage === 'quoting' ? '...' : quote ? Number(quote.amountOut).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '0.00'}
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', marginTop: '4px' }}>
                  {quote ? `$${(Number(quote.amountOut) * (MOCK_RATES[buyToken] ?? 0)).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '$0.00'}
                </div>
              </div>
            </div>
          </div>

          {/* Token search overlay */}
          {showTokenSearch && (
            <div style={{ position: 'absolute', inset: 0, backgroundColor: '#0d0d0d', zIndex: 10, display: 'flex', flexDirection: 'column' }}>
              {/* Search bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--wr-border)' }}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="6.5" cy="6.5" r="5" stroke="var(--wr-text-3)" strokeWidth="1.4"/>
                  <path d="M10.5 10.5L13.5 13.5" stroke="var(--wr-text-3)" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <input
                  autoFocus
                  type="text"
                  placeholder='Search any token. Include " " for exact match.'
                  value={tokenSearch}
                  onChange={e => setTokenSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') setShowTokenSearch(false); }}
                  style={{ flex: 1, fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', background: 'transparent', border: 'none', outline: 'none', padding: 0 }}
                />
                <button
                  onClick={() => setShowTokenSearch(false)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: 'var(--wr-text-3)', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--wr-border)', padding: '4px 10px', cursor: 'pointer', letterSpacing: '1px' }}
                >
                  ESC
                </button>
              </div>

              {/* Quick access */}
              {tokenSearch === '' && (
                <div style={{ display: 'flex', gap: '8px', padding: '12px 16px', borderBottom: '1px solid var(--wr-border)' }}>
                  {quickTokens.map(t => (
                    <button
                      key={t.symbol}
                      onClick={() => { setBuyToken(t.symbol); setShowTokenSearch(false); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', background: buyToken === t.symbol ? 'rgba(190,255,0,0.08)' : 'rgba(255,255,255,0.04)', border: buyToken === t.symbol ? '1px solid #BEFF00' : '1px solid var(--wr-border)', padding: '5px 10px', cursor: 'pointer' }}
                    >
                      <TokenIcon symbol={t.symbol} color={t.color} size={18} />
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: buyToken === t.symbol ? '#BEFF00' : 'var(--wr-text)' }}>{t.symbol}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Top tab label */}
              <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--wr-border)' }}>
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 700, color: 'var(--wr-text)', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '2px solid #BEFF00', paddingBottom: '8px' }}>Top</span>
              </div>

              {/* Token list */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {filteredTokens.length === 0 ? (
                  <div style={{ padding: '24px 16px', textAlign: 'center', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text-3)' }}>No tokens found</div>
                ) : filteredTokens.map(t => (
                  <div
                    key={t.symbol}
                    onClick={() => { setBuyToken(t.symbol); setShowTokenSearch(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--wr-border)', backgroundColor: buyToken === t.symbol ? 'rgba(190,255,0,0.04)' : 'transparent' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = buyToken === t.symbol ? 'rgba(190,255,0,0.04)' : 'transparent'; }}
                  >
                    <TokenIcon symbol={t.symbol} color={t.color} size={36} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{t.symbol}</span>
                        {buyToken === t.symbol && <span style={{ fontSize: '10px', color: '#BEFF00' }}>✓</span>}
                      </div>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', marginTop: '2px' }}>
                        {t.name} · ETH Mainnet
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text)' }}>
                        ${MOCK_RATES[t.symbol]?.toLocaleString() ?? '—'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Limit price row */}
          {orderType === 'limit' && (
            <div style={{ border: '1px solid var(--wr-border)', padding: '11px 14px', marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                When 1 {sellTok.symbol} =
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  type="text" placeholder={(MOCK_RATES[sellToken] ?? 0).toLocaleString()}
                  value={limitPrice} onChange={e => setLimitPrice(e.target.value)}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)', backgroundColor: 'transparent', border: 'none', outline: 'none', textAlign: 'right', width: '110px' }}
                />
                <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>USD</span>
              </div>
            </div>
          )}

          {/* Route + gas info from real quote */}
          {quote && orderType === 'market' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '10px' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                {quote.routeString} · Price impact {quote.priceImpact}
              </span>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)' }}>
                Gas ~${quote.gasEstimateUSD}
              </span>
            </div>
          )}

          {/* Exec status */}
          {STAGE_LABEL[stage] && (
            <div style={{ marginTop: '10px', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', textAlign: 'center', letterSpacing: '0.5px' }}>
              {STAGE_LABEL[stage]}
            </div>
          )}

          {/* Error */}
          {(quoteError || execError) && stage === 'error' && (
            <div style={{ marginTop: '8px', padding: '8px 12px', backgroundColor: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#f87171' }}>
              {quoteError || execError}
            </div>
          )}

          {/* Confirmed */}
          {isDone && txHash && txHash !== 'limit' && (
            <div style={{ marginTop: '10px', padding: '10px 12px', backgroundColor: 'rgba(190,255,0,0.06)', border: '1px solid rgba(190,255,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#BEFF00' }}>✓ Swap confirmed</span>
              <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#3b82f6', textDecoration: 'none' }}>
                View on Etherscan ↗
              </a>
            </div>
          )}
          {approveTxHash && (
            <div style={{ marginTop: '4px', fontFamily: 'var(--font-jetbrains)', fontSize: '9px', color: 'var(--wr-text-3)' }}>
              Approval tx: <a href={`https://etherscan.io/tx/${approveTxHash}`} target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>{approveTxHash.slice(0, 12)}…</a>
            </div>
          )}

          {/* CTA */}
          {orderType === 'market' ? (
            <button
              onClick={handleExecute}
              disabled={!canExecute || isExecuting || isDone}
              style={{
                marginTop: '14px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
                letterSpacing: '1.5px', textTransform: 'uppercase', padding: '14px', width: '100%', border: 'none',
                cursor: canExecute && !isExecuting && stage !== 'confirmed' ? 'pointer' : 'default',
                color: isDone ? '#BEFF00' : canExecute ? '#000' : 'var(--wr-text-3)',
                backgroundColor: isDone ? 'transparent' : canExecute && !isExecuting ? '#BEFF00' : 'rgba(255,255,255,0.05)',
                outline: isDone ? '1px solid #BEFF00' : 'none',
                opacity: isExecuting ? 0.7 : 1,
              }}
            >
              {isDone ? '✓ Swap Complete' : isExecuting ? STAGE_LABEL[stage] : mode === 'swap' ? `Swap ${sellTok.symbol} → ${buyTok.symbol}` : `Buy ${buyTok.symbol}`}
            </button>
          ) : (
            <button
              onClick={handleLimitSubmit}
              disabled={!canLimitSubmit || isDone}
              style={{
                marginTop: '14px', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700,
                letterSpacing: '1.5px', textTransform: 'uppercase', padding: '14px', width: '100%', border: 'none',
                cursor: canLimitSubmit && stage !== 'confirmed' ? 'pointer' : 'default',
                color: isDone ? '#BEFF00' : canLimitSubmit ? '#000' : 'var(--wr-text-3)',
                backgroundColor: isDone ? 'transparent' : canLimitSubmit ? '#BEFF00' : 'rgba(255,255,255,0.05)',
                outline: isDone ? '1px solid #BEFF00' : 'none',
              }}
            >
              {isDone ? '✓ Limit Order Scheduled' : 'Schedule Limit Order'}
            </button>
          )}
        </div>
      </div>
    </div>
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
  const [selectedNfts, setSelectedNfts] = useState<Set<string>>(new Set());
  const [nftSort, setNftSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'RECEIVED', dir: 'desc' });
  const [selectedToken, setSelectedToken] = useState<string | null>(null);
  const [tokenSort, setTokenSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'HELD VALUE', dir: 'desc' });
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [alchemyKey, setAlchemyKey] = useState('');
  const [walletAddr, setWalletAddr] = useState('');

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
      const addr = stored.find(w => w.id === id)?.address ?? wallet.address;
      setWalletAddr(addr);
      setLiveTxs(MOCK_TRANSFERS.map(t => mapTransfer(t, addr)));
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const apiKey = await loadAlchemyKey().catch(() => '');
        setAlchemyKey(apiKey);
        if (!apiKey) { setLoading(false); return; }

        const stored = loadWallets();
        const walletRecord = stored.find(w => w.id === id);
        const address = walletRecord?.address ?? wallet.address;
        setWalletAddr(address);

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
        {(['Holdings', 'Transactions', 'Analytics', 'Address Book'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 500,
              padding: '10px 18px',
              color: tab === t ? 'var(--wr-accent)' : 'var(--wr-text-3)',
              background: 'none',
              borderTop: 'none', borderLeft: 'none', borderRight: 'none',
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
              <div className="flex items-center gap-3">
                <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                  NFT Holdings
                </h2>
                {selectedNfts.size > 0 && (
                  <>
                    <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: '#BEFF00', letterSpacing: '1px' }}>
                      {selectedNfts.size} selected
                    </span>
                    <button
                      onClick={() => setSelectedNfts(new Set())}
                      style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '3px' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                    >
                      ✕ Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              {/* Header row */}
              <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr 88px 130px 90px 120px 140px 120px 80px', alignItems: 'center', padding: '0 16px', height: '40px', borderBottom: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedNfts.size === (liveNfts?.length ?? 0) && (liveNfts?.length ?? 0) > 0}
                    onChange={e => setSelectedNfts(e.target.checked ? new Set((liveNfts ?? []).map(n => n.contract.address + n.token_id)) : new Set())}
                    style={{ width: '14px', height: '14px', accentColor: '#BEFF00', cursor: 'pointer' }}
                  />
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {liveNfts?.length ?? 0} Items
                </div>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>Wallet</div>
                {(['LISTING PRICE', 'RARITY', 'FLOOR PRICE', 'TOP OFFER', 'COST', 'RECEIVED'] as const).map(col => (
                  <button
                    key={col}
                    onClick={() => setNftSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: nftSort.col === col ? 'var(--wr-text)' : 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase', padding: 0 }}
                  >
                    {col}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: nftSort.col === col ? 1 : 0.4 }}>
                      <path d="M5 2L7 4H3L5 2Z" fill="currentColor"/>
                      <path d="M5 8L3 6H7L5 8Z" fill="currentColor"/>
                    </svg>
                  </button>
                ))}
              </div>
              {/* NFT rows */}
              {(liveNfts ?? []).map(nft => {
                const key = nft.contract.address + nft.token_id;
                const isSelected = selectedNfts.has(key);
                const thumb = nft.image?.thumbnail_url || nft.image?.original_url || nft.image?.cached_url;
                const collectionName = nft.contract.opensea_collection_name || nft.contract.name || nft.contract.address.slice(0, 8);
                const floorPrice = nft.contract.opensea_floor_price;
                return (
                  <div
                    key={key}
                    style={{ display: 'grid', gridTemplateColumns: '40px 1fr 88px 130px 90px 120px 140px 120px 80px', alignItems: 'center', padding: '0 16px', height: '56px', borderBottom: '1px solid var(--wr-border)', backgroundColor: isSelected ? 'rgba(190,255,0,0.04)' : 'transparent', transition: 'background 0.1s' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSelected ? 'rgba(190,255,0,0.04)' : 'transparent'; }}
                  >
                    {/* Checkbox */}
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => setSelectedNfts(prev => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(key) : next.delete(key);
                          return next;
                        })}
                        style={{ width: '14px', height: '14px', accentColor: '#BEFF00', cursor: 'pointer' }}
                      />
                    </div>
                    {/* NFT identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: '36px', height: '36px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden', backgroundColor: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumb
                          ? <img src={thumb} alt={nft.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                          : <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: '#555' }}>{(nft.name ?? '?')[0]}</span>
                        }
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-inter)', fontSize: '13px', fontWeight: 600, color: 'var(--wr-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nft.name ?? `#${nft.token_id}`}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '160px' }}>{collectionName}</span>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                            <circle cx="7" cy="7" r="7" fill="#2563eb"/>
                            <path d="M4 7L6 9L10 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                    {/* Wallet */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '26px', height: '26px', borderRadius: '50%', backgroundColor: wallet.badge === 'ETH' ? '#627eea' : wallet.badge === 'BNB' ? '#f3ba2f' : '#8247e5', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '9px', fontWeight: 700, color: '#fff' }}>{wallet.name.slice(0, 2).toUpperCase()}</span>
                      </div>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '10px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '52px' }}>{wallet.name.split(' ')[0]}</span>
                    </div>
                    {/* Listing Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>–</div>
                    {/* Rarity */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>–</div>
                    {/* Floor Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>
                      {floorPrice ? <>{floorPrice} <span style={{ color: 'var(--wr-text-3)' }}>ETH</span></> : '–'}
                    </div>
                    {/* Top Offer */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: 'var(--wr-text)', border: '1px solid var(--wr-border)', padding: '2px 8px', whiteSpace: 'nowrap' }}>–</span>
                    </div>
                    {/* Cost */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>–</div>
                    {/* Received */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>–</div>
                  </div>
                );
              })}
            </div>
            {/* Selection action bar */}
            {selectedNfts.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', padding: '10px 16px', borderTop: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                <button
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#BEFF00', border: 'none', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#d4e800'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#BEFF00'; }}
                >
                  Edit {selectedNfts.size} listing{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  Cancel {selectedNfts.size} listing{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', whiteSpace: 'nowrap', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  Accept {selectedNfts.size} offer{selectedNfts.size !== 1 ? 's' : ''}
                </button>
                <button
                  title="Send"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', cursor: 'pointer', color: 'var(--wr-text)', flexShrink: 0 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                >
                  <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                    <path d="M1.5 6.5h10M7.5 2.5l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button
                  onClick={() => setSelectedNfts(new Set())}
                  style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '7px 4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Token Holdings */}
          <div>
            <div style={{ marginBottom: '12px' }}>
              <h2 style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', textTransform: 'uppercase', letterSpacing: '2px' }}>
                Token Holdings
              </h2>
            </div>
            <div style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 110px 100px 72px 110px 72px 90px 90px 90px', alignItems: 'center', padding: '0 16px', height: '40px', borderBottom: '1px solid var(--wr-border)', columnGap: '8px' }}>
                <div style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 600, color: 'var(--wr-text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  {tokens.length} Tokens
                </div>
                {(['HELD VALUE', 'HELD QTY', 'WALLETS', 'PRICE', 'FDV', '1D CHANGE', '7D CHANGE', '1D VOL'] as const).map(col => (
                  <button
                    key={col}
                    onClick={() => setTokenSort(s => ({ col, dir: s.col === col && s.dir === 'asc' ? 'desc' : 'asc' }))}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: col === 'WALLETS' ? 'center' : 'flex-end', gap: '3px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-jetbrains)', fontSize: '10px', fontWeight: tokenSort.col === col ? 700 : 600, color: tokenSort.col === col ? 'var(--wr-text)' : 'var(--wr-text-3)', letterSpacing: '0.8px', textTransform: 'uppercase', padding: 0, whiteSpace: 'nowrap' }}
                  >
                    {col}
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: tokenSort.col === col ? 1 : 0.35, flexShrink: 0 }}>
                      {tokenSort.col === col && tokenSort.dir === 'desc'
                        ? <path d="M5 7L2.5 4h5L5 7Z" fill="currentColor"/>
                        : tokenSort.col === col
                          ? <path d="M5 3L7.5 6h-5L5 3Z" fill="currentColor"/>
                          : <><path d="M5 2.5L7 4.5H3L5 2.5Z" fill="currentColor"/><path d="M5 7.5L3 5.5H7L5 7.5Z" fill="currentColor"/></>
                      }
                    </svg>
                  </button>
                ))}
              </div>
              {/* Rows */}
              {tokens.map(tok => {
                const isSelected = selectedToken === tok.ticker;
                const neutral = (v: string) => v === '0%' || v === '+0.0%' || v === '-0%';
                const changeColor = (v: string) => neutral(v) ? 'var(--wr-text-3)' : v.startsWith('+') ? '#34d399' : '#f87171';
                const AVATAR_COLORS = ['#627eea', '#f59e0b', '#34d399', '#a78bfa', '#f87171'];
                return (
                  <div
                    key={tok.ticker}
                    onClick={() => setSelectedToken(isSelected ? null : tok.ticker)}
                    style={{ display: 'grid', gridTemplateColumns: '2fr 110px 100px 72px 110px 72px 90px 90px 90px', alignItems: 'center', padding: '0 16px', height: '60px', borderBottom: '1px solid var(--wr-border)', columnGap: '8px', backgroundColor: isSelected ? 'rgba(190,255,0,0.06)' : 'transparent', transition: 'background 0.1s', cursor: 'pointer', outline: isSelected ? '1px solid rgba(190,255,0,0.3)' : 'none', outlineOffset: '-1px' }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--wr-overlay)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = isSelected ? 'rgba(190,255,0,0.06)' : 'transparent'; }}
                  >
                    {/* Token identity */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: tok.color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 700, color: '#fff' }}>{tok.ticker[0]}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'nowrap', minWidth: 0 }}>
                        <span style={{ fontFamily: 'var(--font-inter)', fontSize: '14px', fontWeight: 600, color: 'var(--wr-text)', whiteSpace: 'nowrap' }}>{tok.name}</span>
                        <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', whiteSpace: 'nowrap' }}>{tok.ticker}</span>
                        {tok.verified && (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
                            <circle cx="7" cy="7" r="7" fill="#2563eb"/>
                            <path d="M4 7L6 9L10 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {tok.walletCount > 1 && (
                          <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)' }}>({tok.walletCount})</span>
                        )}
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ color: 'var(--wr-text-3)', opacity: 0.5, flexShrink: 0 }}>
                          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                    {/* Held Value */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '13px', fontWeight: 700, color: 'var(--wr-text)' }}>{tok.heldValue}</div>
                    {/* Held Qty */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{tok.heldQty}</div>
                    {/* Wallets - stacked avatars */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <div style={{ display: 'flex' }}>
                        {Array.from({ length: Math.min(tok.walletCount, 3) }).map((_, i) => (
                          <div key={i} style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length], border: '2px solid var(--wr-surface)', marginLeft: i > 0 ? '-6px' : 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontSize: '8px', fontWeight: 700, color: '#fff' }}>{String.fromCharCode(65 + i)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {/* Price */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{tok.price}</div>
                    {/* FDV */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{tok.fdv}</div>
                    {/* 1D Change */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: changeColor(tok.change1d) }}>{tok.change1d}</div>
                    {/* 7D Change */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', fontWeight: 500, color: changeColor(tok.change7d) }}>{tok.change7d}</div>
                    {/* 1D Vol */}
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-jetbrains)', fontSize: '12px', color: '#a1a1aa' }}>{tok.vol1d}</div>
                  </div>
                );
              })}
            </div>
            {/* Token selection action bar */}
            {selectedToken !== null && (() => {
              const selTok = tokens.find(t => t.ticker === selectedToken);
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderTop: '1px solid var(--wr-border)', backgroundColor: 'var(--wr-surface)' }}>
                  <span style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', color: 'var(--wr-text-3)', flex: 1 }}>{selTok?.name ?? selectedToken} selected</span>
                  <button
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 700, color: '#000', backgroundColor: '#BEFF00', border: 'none', padding: '7px 14px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onClick={() => setShowTransferModal(true)}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#d4e800'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#BEFF00'; }}
                  >
                    Transfer
                  </button>
                  <button
                    onClick={() => setShowSwapModal(true)}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                  >
                    Swap
                  </button>
                  <button
                    onClick={() => setShowBuyModal(true)}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text)', backgroundColor: 'transparent', border: '1px solid var(--wr-border)', padding: '7px 14px', cursor: 'pointer', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border-hover)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-accent)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--wr-border)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                  >
                    Buy
                  </button>
                  <button
                    onClick={() => setSelectedToken(null)}
                    style={{ fontFamily: 'var(--font-jetbrains)', fontSize: '11px', fontWeight: 500, color: 'var(--wr-text-3)', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', padding: '7px 4px', letterSpacing: '0.5px', textTransform: 'uppercase' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--wr-text-3)'; }}
                  >
                    Clear
                  </button>
                </div>
              );
            })()}
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

      {/* ── ADDRESS BOOK TAB ── */}
      {tab === 'Address Book' && <AddressBookTab />}

      {showTransferModal && <TransferModal wallet={wallet} onClose={() => setShowTransferModal(false)} />}
      {showSwapModal && (() => { const t = tokens.find(x => x.ticker === selectedToken); return <SwapModal mode="swap" sellTicker={t?.ticker ?? 'ETH'} sellColor={t?.color ?? '#627EEA'} sellName={t?.name ?? 'Ethereum'} walletAddress={walletAddr} alchemyKey={alchemyKey} onClose={() => setShowSwapModal(false)} />; })()}
      {showBuyModal && (() => { const t = tokens.find(x => x.ticker === selectedToken); return <SwapModal mode="buy" sellTicker={t?.ticker ?? 'ETH'} sellColor={t?.color ?? '#627EEA'} sellName={t?.name ?? 'Ethereum'} walletAddress={walletAddr} alchemyKey={alchemyKey} onClose={() => setShowBuyModal(false)} />; })()}
    </main>
  );
}
