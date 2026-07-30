import axios, { type AxiosInstance } from "axios";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";
import type { CollectionData, Sale, Chain } from "@/shared/types";

const log = createLogger("opensea");

const BASE_URL = "https://api.opensea.io/api/v2";

let instance: OpenSeaClient | null = null;

interface OSCollection {
  collection: string;
  name: string;
  description?: string;
  image_url?: string;
  contracts?: Array<{ address: string; chain: string }>;
  total_supply?: number;
  created_date?: string;
}

interface OSCollectionStats {
  total_volume?: number;
  total_sales?: number;
  total_supply?: number;
  num_owners?: number;
  average_price?: number;
  floor_price?: number;
  floor_price_symbol?: string;
  one_day_volume?: number;
  one_day_sales?: number;
  one_day_average_price?: number;
  seven_day_volume?: number;
}

interface OSEvent {
  transaction?: string;
  nft?: { identifier?: string };
  payment?: { quantity?: string; decimals?: number };
  buyer?: string;
  seller?: string;
  event_timestamp?: string;
  event_type?: string;
}

export class OpenSeaClient {
  private readonly http: AxiosInstance;

  private constructor() {
    this.http = axios.create({
      baseURL: BASE_URL,
      headers: {
        "x-api-key": env.OPENSEA_API_KEY,
        accept: "application/json",
      },
      timeout: 15_000,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err) => {
        const status = err.response?.status ?? 0;
        const msg = err.response?.data?.errors?.[0] ?? err.message;
        log.warn({ status, msg }, "OpenSea API error");
        throw err;
      },
    );
  }

  static getInstance(): OpenSeaClient {
    if (!instance) instance = new OpenSeaClient();
    return instance;
  }

  async getCollection(slug: string): Promise<CollectionData | null> {
    try {
      const [colRes, statsRes] = await Promise.all([
        this.http.get<OSCollection>(`/collections/${slug}`),
        this.http.get<{ stats: OSCollectionStats }>(`/collections/${slug}/stats`),
      ]);

      const col = colRes.data;
      const stats = statsRes.data.stats ?? {};

      const contract = col.contracts?.[0];
      const chain = normalizeChain(contract?.chain ?? "ethereum");

      return {
        slug,
        name: col.name,
        contractAddress: contract?.address ?? "",
        chain,
        floorPriceEth: stats.floor_price ?? 0,
        volume24hEth: stats.one_day_volume ?? 0,
        volume1hEth: 0, // OpenSea v2 doesn't expose 1h volume directly
        sales24h: stats.one_day_sales ?? 0,
        ownerCount: stats.num_owners ?? 0,
        listingCount: 0, // would need separate listings endpoint
        imageUrl: col.image_url ?? null,
        createdAt: col.created_date ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async getCollectionStats(slug: string): Promise<CollectionData | null> {
    return this.getCollection(slug);
  }

  async getRecentSales(slug: string, limit = 50): Promise<Sale[]> {
    try {
      const res = await this.http.get<{ asset_events: OSEvent[] }>(`/events/collection/${slug}`, {
        params: { event_type: "sale", limit },
      });

      return (res.data.asset_events ?? []).map((e) => {
        const rawQty = e.payment?.quantity ?? "0";
        const decimals = e.payment?.decimals ?? 18;
        const priceEth = parseFloat(rawQty) / Math.pow(10, decimals);

        return {
          txHash: e.transaction ?? "",
          tokenId: e.nft?.identifier ?? "",
          priceEth,
          buyer: e.buyer ?? "",
          seller: e.seller ?? "",
          timestamp: e.event_timestamp
            ? new Date(parseInt(e.event_timestamp, 10) * 1000).toISOString()
            : new Date().toISOString(),
          marketplace: "opensea",
        };
      });
    } catch {
      return [];
    }
  }

  async searchCollections(query: string): Promise<CollectionData[]> {
    try {
      const res = await this.http.get<{ collections: OSCollection[] }>("/collections", {
        params: { include_hidden: false, order_by: "seven_day_volume", limit: 10 },
      });
      // OpenSea v2 doesn't have a text search endpoint — filter client-side
      const lower = query.toLowerCase();
      const filtered = (res.data.collections ?? []).filter((c) =>
        c.name?.toLowerCase().includes(lower) || c.collection?.includes(lower),
      );
      const results: CollectionData[] = [];
      for (const c of filtered.slice(0, 5)) {
        const col = await this.getCollection(c.collection);
        if (col) results.push(col);
      }
      return results;
    } catch {
      return [];
    }
  }
}

function normalizeChain(chain: string): Chain {
  if (chain === "base") return "base";
  if (chain === "solana") return "solana";
  return "ethereum";
}

export const opensea = OpenSeaClient.getInstance();
