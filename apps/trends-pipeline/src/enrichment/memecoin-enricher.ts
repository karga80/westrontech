import { getRedis } from "@/storage/redis-client";
import { dexscreener } from "./dexscreener-client";
import { createLogger } from "@/shared/logger";
import type { ExtractedSignal, EnrichedMemecoinSignal, TokenData } from "@/shared/types";
import blocklist from "../../seeds/dexscreener-blocklist.json" with { type: "json" };

const log = createLogger("memecoin-enricher");

const SIGNALS_STREAM = "signals:extracted";
const ENRICHED_STREAM = "signals:enriched-memecoin";
const CONSUMER_GROUP = "memecoin-enricher";

// Hard filters
const MIN_LIQUIDITY_USD = 5_000;
const MAX_MARKET_CAP = 5_000_000;
const MIN_AGE_MS = 60_000; // 1 minute
// const MIN_HOLDERS = 30; // reserved for future filter use

const BLOCKLIST_SET = new Set<string>([...blocklist.evm as string[], ...blocklist.solana as string[]]);

type DropReason = "liquidity" | "age" | "market_cap" | "zero_volume" | "blocklist" | "no_data";
const dropStats: Record<DropReason, number> = {
  liquidity: 0, age: 0, market_cap: 0, zero_volume: 0, blocklist: 0, no_data: 0,
};

function applyHardFilters(token: TokenData): DropReason | null {
  if (BLOCKLIST_SET.has(token.address)) return "blocklist";
  if (token.liquidityUsd < MIN_LIQUIDITY_USD) return "liquidity";
  if (token.ageMs < MIN_AGE_MS) return "age";
  if (token.marketCap > MAX_MARKET_CAP && token.marketCap !== 0) return "market_cap";
  if (token.volume24h === 0) return "zero_volume";
  return null;
}

async function ensureGroup(redis: ReturnType<typeof getRedis>): Promise<void> {
  try {
    await redis.xgroup("CREATE", SIGNALS_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

export async function runMemecoinEnricher(): Promise<void> {
  const redis = getRedis();
  await ensureGroup(redis);
  log.info("Memecoin enricher started");

  let processed = 0;

  while (true) {
    const messages = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, "memecoin-enricher-1",
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

      // Only process memecoin/mixed signals with contracts
      if (signal.signalType === "nft" || signal.contracts.length === 0) {
        await redis.xack(SIGNALS_STREAM, CONSUMER_GROUP, msgId);
        continue;
      }

      for (const { address, chain } of signal.contracts) {
        const tokenData = await dexscreener.getTokenByAddress(chain, address);

        if (!tokenData) {
          dropStats.no_data++;
          continue;
        }

        const dropReason = applyHardFilters(tokenData);
        if (dropReason) {
          dropStats[dropReason]++;
          continue;
        }

        const vol5mAvg = tokenData.volume1h / 12; // 1h / 12 five-minute slots
        const velocityScore = vol5mAvg > 0 ? tokenData.volume5m / vol5mAvg : 0;

        const liquidityHealth = tokenData.marketCap > 0
          ? tokenData.liquidityUsd / tokenData.marketCap
          : 0;

        const total5m = tokenData.txCount5m;
        const buySellRatio5m = total5m > 0
          ? (total5m * 0.6) / total5m // approximate without buy/sell split from Dexscreener
          : 0.5;

        const enriched: EnrichedMemecoinSignal = {
          ...signal,
          tokenData,
          velocityScore,
          liquidityHealth,
          buySellRatio5m,
        };

        await redis.xadd(ENRICHED_STREAM, "*", "payload", JSON.stringify(enriched));
      }

      processed++;
      await redis.xack(SIGNALS_STREAM, CONSUMER_GROUP, msgId);

      if (processed % 50 === 0) {
        log.info({ processed, dropStats }, "Memecoin enricher stats");
      }
    }
  }
}
