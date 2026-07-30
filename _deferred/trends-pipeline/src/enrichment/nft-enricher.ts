import { getRedis } from "@/storage/redis-client";
import { opensea } from "./opensea-client";
import { createLogger } from "@/shared/logger";
import type { ExtractedSignal, EnrichedNFTSignal, CollectionData } from "@/shared/types";

const log = createLogger("nft-enricher");

const SIGNALS_STREAM = "signals:extracted";
const ENRICHED_STREAM = "signals:enriched-nft";
const CONSUMER_GROUP = "nft-enricher";

// Hard filters
const MIN_OWNER_COUNT = 100;
const MIN_VOLUME_24H = 0;
const MIN_COLLECTION_AGE_DAYS = 1;
const MIN_FLOOR_ETH_NEW = 0.001;

type DropReason = "low_owners" | "zero_volume" | "likely_scam" | "no_data";
const dropStats: Record<DropReason, number> = {
  low_owners: 0, zero_volume: 0, likely_scam: 0, no_data: 0,
};

// Floor price history cache: slug → { price, ts }
const floorCache = new Map<string, { price: number; ts: number }>();

function applyHardFilters(col: CollectionData): DropReason | null {
  if (col.ownerCount < MIN_OWNER_COUNT) return "low_owners";
  if (col.volume24hEth === MIN_VOLUME_24H) return "zero_volume";

  const ageMs = Date.now() - new Date(col.createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays < MIN_COLLECTION_AGE_DAYS && col.floorPriceEth < MIN_FLOOR_ETH_NEW) return "likely_scam";

  return null;
}

function computeFloorVelocity(slug: string, currentFloor: number): number {
  const cached = floorCache.get(slug);
  if (!cached) {
    floorCache.set(slug, { price: currentFloor, ts: Date.now() });
    return 0;
  }
  const ageMs = Date.now() - cached.ts;
  if (ageMs < 55 * 60 * 1000) return 0; // not enough time elapsed

  const velocity = cached.price > 0 ? (currentFloor - cached.price) / cached.price : 0;
  floorCache.set(slug, { price: currentFloor, ts: Date.now() });
  return velocity;
}

async function ensureGroup(redis: ReturnType<typeof getRedis>): Promise<void> {
  try {
    await redis.xgroup("CREATE", SIGNALS_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

export async function runNFTEnricher(): Promise<void> {
  const redis = getRedis();
  await ensureGroup(redis);
  log.info("NFT enricher started (OpenSea API)");

  let processed = 0;

  while (true) {
    const messages = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, "nft-enricher-1",
      "COUNT", "10",
      "BLOCK", "5000",
      "STREAMS", SIGNALS_STREAM, ">",
    );

    if (!messages || messages.length === 0) continue;

    const [[, entries]] = messages as [string, [string, string[]][]][];

    for (const [msgId, fields] of entries) {
      const payloadIdx = fields.indexOf("payload");
      if (payloadIdx === -1) continue;

      const signal = JSON.parse(fields[payloadIdx + 1] as string) as ExtractedSignal;

      // Only process NFT/mixed signals with collection slugs
      if (signal.signalType === "memecoin" || signal.collections.length === 0) {
        await redis.xack(SIGNALS_STREAM, CONSUMER_GROUP, msgId);
        continue;
      }

      for (const slug of signal.collections) {
        const colData = await opensea.getCollection(slug);

        if (!colData) {
          dropStats.no_data++;
          continue;
        }

        const dropReason = applyHardFilters(colData);
        if (dropReason) {
          dropStats[dropReason]++;
          continue;
        }

        const floorVelocity1h = computeFloorVelocity(slug, colData.floorPriceEth);

        // Volume velocity: 24h average per hour vs recent
        const vol24hAvgPerHour = colData.volume24hEth / 24;
        const volumeVelocity1h = vol24hAvgPerHour > 0 ? colData.volume1hEth / vol24hAvgPerHour : 0;

        // Listing pressure: estimate from sales vs owners ratio
        const listingPressure = colData.ownerCount > 0 ? colData.listingCount / colData.ownerCount : 0;

        const recentSales = await opensea.getRecentSales(slug, 20);
        const uniqueBuyers1h = new Set(
          recentSales
            .filter((s) => Date.now() - new Date(s.timestamp).getTime() < 60 * 60 * 1000)
            .map((s) => s.buyer),
        ).size;

        const enriched: EnrichedNFTSignal = {
          ...signal,
          collectionData: colData,
          floorVelocity1h,
          volumeVelocity1h,
          listingPressure,
          uniqueBuyers1h,
        };

        await redis.xadd(ENRICHED_STREAM, "*", "payload", JSON.stringify(enriched));
      }

      processed++;
      await redis.xack(SIGNALS_STREAM, CONSUMER_GROUP, msgId);

      if (processed % 50 === 0) {
        log.info({ processed, dropStats }, "NFT enricher stats");
      }
    }
  }
}
