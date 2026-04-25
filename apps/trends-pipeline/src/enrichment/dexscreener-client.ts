import axios, { type AxiosInstance } from "axios";
import pLimit from "p-limit";
import { createLogger } from "@/shared/logger";
import type { TokenData, Chain } from "@/shared/types";

const log = createLogger("dexscreener");

const BASE_URL = "https://api.dexscreener.com/latest/dex";
const limit = pLimit(5); // max 5 concurrent requests

let instance: DexscreenerClient | null = null;

interface DexPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  priceUsd?: string;
  priceChange?: { h24?: number; h1?: number; m5?: number };
  volume?: { h24?: number; h1?: number; m5?: number };
  txns?: {
    h24?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    m5?: { buys?: number; sells?: number };
  };
  pairCreatedAt?: number;
  info?: { socials?: unknown[] };
}

export class DexscreenerClient {
  private readonly http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: BASE_URL,
      timeout: 10_000,
    });
  }

  static getInstance(): DexscreenerClient {
    if (!instance) instance = new DexscreenerClient();
    return instance;
  }

  async getTokenByAddress(chain: Chain, address: string): Promise<TokenData | null> {
    return limit(async () => {
      try {
        const res = await this.http.get<{ pairs: DexPair[] }>(`/tokens/${address}`);
        const pairs = res.data.pairs ?? [];
        // Prefer the pair on the requested chain with highest liquidity
        const chainPairs = pairs
          .filter((p) => p.chainId === chain || (chain === "ethereum" && p.chainId === "ethereum"))
          .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));

        const pair = chainPairs[0];
        if (!pair) return null;
        return normalizePair(pair, address, chain);
      } catch (err) {
        log.warn({ address, chain, err }, "Dexscreener getTokenByAddress failed");
        return null;
      }
    });
  }

  async searchTokens(query: string): Promise<TokenData[]> {
    return limit(async () => {
      try {
        const res = await this.http.get<{ pairs: DexPair[] }>(`/search/?q=${encodeURIComponent(query)}`);
        return (res.data.pairs ?? []).slice(0, 10).map((p) =>
          normalizePair(p, p.baseToken.address, p.chainId as Chain),
        );
      } catch {
        return [];
      }
    });
  }
}

function normalizePair(pair: DexPair, address: string, chain: Chain): TokenData {
  const now = Date.now();
  const createdAt = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : new Date().toISOString();
  const ageMs = pair.pairCreatedAt ? now - pair.pairCreatedAt : 0;

  const buys5m = pair.txns?.m5?.buys ?? 0;
  const sells5m = pair.txns?.m5?.sells ?? 0;
  const total5m = buys5m + sells5m;

  return {
    address,
    chain,
    name: pair.baseToken.name,
    symbol: pair.baseToken.symbol,
    liquidityUsd: pair.liquidity?.usd ?? 0,
    marketCap: pair.marketCap ?? 0,
    fdv: pair.fdv ?? 0,
    priceUsd: parseFloat(pair.priceUsd ?? "0"),
    priceChange24h: pair.priceChange?.h24 ?? 0,
    priceChange1h: pair.priceChange?.h1 ?? 0,
    priceChange5m: pair.priceChange?.m5 ?? 0,
    volume24h: pair.volume?.h24 ?? 0,
    volume1h: pair.volume?.h1 ?? 0,
    volume5m: pair.volume?.m5 ?? 0,
    txCount24h: (pair.txns?.h24?.buys ?? 0) + (pair.txns?.h24?.sells ?? 0),
    txCount1h: (pair.txns?.h1?.buys ?? 0) + (pair.txns?.h1?.sells ?? 0),
    txCount5m: total5m,
    ageMs,
    holders: null,
    pairAddress: pair.pairAddress,
    pairCreatedAt: createdAt,
  };
}

export const dexscreener = DexscreenerClient.getInstance();
