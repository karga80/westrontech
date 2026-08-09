// ─── Birdeye API client — Solana token price data ────────────────────────────
// API key: localStorage 'wr-apikey-birdeye'

import type { PriceData } from '../sentiment/types';

const BIRDEYE_BASE = 'https://public-api.birdeye.so';

function loadApiKey(name: string): string {
  if (typeof window === 'undefined') {
    throw new Error(`API key '${name}' unavailable outside browser context`);
  }
  const key = localStorage.getItem(`wr-apikey-${name}`);
  if (!key || key.trim() === '') {
    throw new Error(`API key '${name}' is not configured. Add it in Settings.`);
  }
  return key.trim();
}

interface BirdeyeTokenOverview {
  price?: number;
  priceChange24hPercent?: number;
  v24hUSD?: number;
  mc?: number;
  liquidity?: number;
}

interface BirdeyeResponse {
  success: boolean;
  data?: BirdeyeTokenOverview;
  message?: string;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && isFinite(value) ? value : 0;
}

export async function fetchPriceData(contractAddress: string): Promise<PriceData> {
  const apiKey = loadApiKey('birdeye');

  const url = `${BIRDEYE_BASE}/defi/token_overview?address=${encodeURIComponent(contractAddress)}`;
  const response = await fetch(url, {
    headers: {
      'X-API-KEY': apiKey,
      'x-chain': 'solana',
    },
  });

  if (!response.ok) {
    throw new Error(`Birdeye API error ${response.status}: ${response.statusText}`);
  }

  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) {
    throw new Error('Birdeye API returned an unexpected response shape');
  }

  const result = body as BirdeyeResponse;
  if (!result.success) {
    throw new Error(`Birdeye API returned failure: ${result.message ?? 'unknown error'}`);
  }

  const d = result.data ?? {};

  return {
    currentPrice: safeNumber(d.price),
    priceChange24h: safeNumber(d.priceChange24hPercent),
    volume24h: safeNumber(d.v24hUSD),
    marketCap: safeNumber(d.mc),
    liquidity: safeNumber(d.liquidity),
    fetchedAt: new Date().toISOString(),
  };
}
