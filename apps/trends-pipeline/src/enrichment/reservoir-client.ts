import axios, { type AxiosInstance } from "axios";
import { env } from "@/config/env";
import { ReservoirError } from "@/shared/errors";
import type { CollectionData, Sale, Chain } from "@/shared/types";

// const log = createLogger("reservoir"); // reserved for future logging

const BASE_URL = "https://api.reservoir.tools";

let instance: ReservoirClient | null = null;

interface ReservoirCollection {
  id: string;
  name: string;
  slug: string;
  contractAddresses: string[];
  chainId: number;
  image?: string;
  createdAt?: string;
  floorAsk?: { price?: { amount?: { native?: number } } };
  volume?: { "1day"?: number; "1h"?: number };
  salesCount?: { "1day"?: number };
  ownerCount?: number;
  listingsCount?: number;
}

interface ReservoirSale {
  txHash: string;
  token?: { tokenId?: string };
  price?: { amount?: { native?: number } };
  buyer?: string;
  seller?: string;
  timestamp?: number;
  orderSource?: string;
}

export class ReservoirClient {
  private readonly http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: { "x-api-key": env.RESERVOIR_API_KEY },
      timeout: 15_000,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        throw new ReservoirError(err.response?.status ?? 0, err.response?.data?.message ?? err.message);
      },
    );
  }

  static getInstance(): ReservoirClient {
    if (!instance) instance = new ReservoirClient();
    return instance;
  }

  async getCollection(slugOrAddress: string): Promise<CollectionData | null> {
    try {
      const res = await this.http.get<{ collections: ReservoirCollection[] }>("/collections/v7", {
        params: { slug: slugOrAddress, limit: 1, includeFloorAsk: true },
      });
      const col = res.data.collections?.[0];
      if (!col) return null;
      return normalizeCollection(col);
    } catch {
      return null;
    }
  }

  async getCollectionStats(slug: string): Promise<CollectionData | null> {
    return this.getCollection(slug);
  }

  async getRecentSales(slug: string, limit = 50): Promise<Sale[]> {
    try {
      const res = await this.http.get<{ sales: ReservoirSale[] }>("/sales/v6", {
        params: { collection: slug, limit, sortBy: "time" },
      });
      return (res.data.sales ?? []).map(normalizeSale);
    } catch {
      return [];
    }
  }

  async searchCollections(query: string): Promise<CollectionData[]> {
    try {
      const res = await this.http.get<{ collections: ReservoirCollection[] }>("/search/collections/v2", {
        params: { name: query, limit: 10 },
      });
      return (res.data.collections ?? []).map(normalizeCollection);
    } catch {
      return [];
    }
  }
}

function normalizeCollection(c: ReservoirCollection): CollectionData {
  const chainMap: Record<number, Chain> = { 1: "ethereum", 8453: "base" };
  return {
    slug: c.slug ?? c.id,
    name: c.name,
    contractAddress: c.contractAddresses?.[0] ?? "",
    chain: chainMap[c.chainId] ?? "ethereum",
    floorPriceEth: c.floorAsk?.price?.amount?.native ?? 0,
    volume24hEth: c.volume?.["1day"] ?? 0,
    volume1hEth: c.volume?.["1h"] ?? 0,
    sales24h: c.salesCount?.["1day"] ?? 0,
    ownerCount: c.ownerCount ?? 0,
    listingCount: c.listingsCount ?? 0,
    imageUrl: c.image ?? null,
    createdAt: c.createdAt ?? new Date().toISOString(),
  };
}

function normalizeSale(s: ReservoirSale): Sale {
  return {
    txHash: s.txHash ?? "",
    tokenId: s.token?.tokenId ?? "",
    priceEth: s.price?.amount?.native ?? 0,
    buyer: s.buyer ?? "",
    seller: s.seller ?? "",
    timestamp: s.timestamp ? new Date(s.timestamp * 1000).toISOString() : new Date().toISOString(),
    marketplace: s.orderSource ?? "unknown",
  };
}

export const reservoir = ReservoirClient.getInstance();
