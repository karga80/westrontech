import { Worker, Queue } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { xClient } from "@/ingestion/x-client";
import { createLogger } from "@/shared/logger";
import type { VelocitySpike } from "@/shared/types";
import watchedTerms from "../../seeds/watched-terms.json" with { type: "json" };

const log = createLogger("x-counts-worker");

const VELOCITY_THRESHOLD = 2.0;
const COUNTS_KEY_PREFIX = "counts";
const SPIKE_STREAM = "x:velocity-spike";
const BUCKET_TTL_SEC = 6 * 60 * 60; // keep 6h of buckets

function minuteBucket(ts: Date = new Date()): string {
  const d = new Date(ts);
  d.setSeconds(0, 0);
  return d.toISOString();
}

async function computeVelocity(redis: ReturnType<typeof getRedis>, term: string, currentCount: number): Promise<number> {
  // Get last 60 minute buckets for 1h average
  const now = Date.now();
  // oneHourAgo = now - 60 * 60 * 1000; // reserved for future range filtering
  const buckets: number[] = [];

  for (let i = 1; i <= 60; i++) {
    const ts = new Date(now - i * 60 * 1000);
    const key = `${COUNTS_KEY_PREFIX}:${term}:${minuteBucket(ts)}`;
    const val = await redis.get(key);
    if (val !== null) buckets.push(parseInt(val, 10));
  }

  if (buckets.length < 5) return 1; // not enough history yet
  const avg = buckets.reduce((a, b) => a + b, 0) / buckets.length;
  return avg > 0 ? currentCount / avg : 1;
}

function buildBulkQuery(): string {
  const terms = [
    ...watchedTerms.cashtags,
    ...watchedTerms.memecoin_keywords.slice(0, 5),
    ...watchedTerms.nft_keywords.slice(0, 5),
  ];
  return terms.join(" OR ");
}

export function createXCountsWorker(): Worker {
  const redis = getRedis();

  const worker = new Worker(
    "x-counts",
    async () => {
      const query = buildBulkQuery();
      log.debug({ query: query.slice(0, 80) }, "Fetching tweet counts");

      const counts = await xClient.getPostsCounts(query, "minute");
      if (counts.length === 0) {
        log.warn("No count data returned from X API");
        return;
      }

      const latestBucket = counts[counts.length - 1];
      if (!latestBucket) return;

      // Store per-term counts by re-querying individually for spikes only
      // Bulk query gives totals — we use it to detect overall spikes first
      const bucket = minuteBucket(new Date(latestBucket.start));
      const totalKey = `${COUNTS_KEY_PREFIX}:__all__:${bucket}`;
      await redis.set(totalKey, latestBucket.tweetCount, "EX", BUCKET_TTL_SEC);

      const velocityRatio = await computeVelocity(redis, "__all__", latestBucket.tweetCount);

      log.info(
        { tweetCount: latestBucket.tweetCount, velocityRatio: velocityRatio.toFixed(2) },
        "X counts polled",
      );

      if (velocityRatio >= VELOCITY_THRESHOLD) {
        const spike: VelocitySpike = {
          term: "__all__",
          current: latestBucket.tweetCount,
          baseline: Math.round(latestBucket.tweetCount / velocityRatio),
          ratio: velocityRatio,
          ts: new Date().toISOString(),
        };

        await redis.xadd(SPIKE_STREAM, "*", "payload", JSON.stringify(spike));
        log.info({ ratio: velocityRatio.toFixed(2) }, "Velocity spike detected — emitted to stream");
      }
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "x-counts-worker job failed");
  });

  return worker;
}

export async function scheduleXCountsJob(): Promise<void> {
  const redis = getRedis();
  const queue = new Queue("x-counts", { connection: redis });
  await queue.upsertJobScheduler("x-counts-cron", { pattern: "*/1 * * * *" }, { name: "poll-counts" });
  log.info("x-counts-worker scheduled (every 1 minute)");
}
