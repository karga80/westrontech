import { Worker, Queue } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { xClient } from "@/ingestion/x-client";
import { createLogger } from "@/shared/logger";
import type { RawXPost } from "@/shared/types";

const log = createLogger("x-trends-worker");

const RAW_POSTS_STREAM = "x:raw-posts";
// const WORLDWIDE_WOEID = 1; // reserved for trends API when available

const CRYPTO_PATTERN =
  /(\$[A-Z]{2,10}|NFT|mint|floor|sweep|0x[a-fA-F0-9]{10}|pump\.fun|solana|ethereum|bitcoin|crypto|memecoin|defi|web3)/i;

export function createXTrendsWorker(): Worker {
  const redis = getRedis();

  const worker = new Worker(
    "x-trends",
    async () => {
      await xClient.resolveHandle("xtrends_dummy"); // placeholder — trends API uses different method
      // Note: twitter-api-v2 getTrends requires OAuth1 or different endpoint
      // Using search as fallback for now
      log.debug("x-trends-worker: trends API placeholder, using keyword search fallback");

      // Fallback: search for native trending terms with crypto overlap
      const fallbackQuery = "$BTC OR $ETH OR $SOL OR NFT floor OR mint live";
      const tweets = await xClient.searchRecent(fallbackQuery, undefined, 30);

      let pushed = 0;
      for (const tweet of tweets) {
        if (!CRYPTO_PATTERN.test(tweet.text)) continue;

        const post: RawXPost = {
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.author_id ?? "",
          authorHandle: "",
          authorFollowers: 0,
          likes: tweet.public_metrics?.like_count ?? 0,
          retweets: tweet.public_metrics?.retweet_count ?? 0,
          createdAt: tweet.created_at ?? new Date().toISOString(),
          source: "native-trend",
        };

        await redis.xadd(RAW_POSTS_STREAM, "*", "payload", JSON.stringify(post));
        pushed++;
      }

      log.info({ pushed }, "x-trends-worker complete");
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "x-trends-worker job failed");
  });

  return worker;
}

export async function scheduleXTrendsJob(): Promise<void> {
  const redis = getRedis();
  const queue = new Queue("x-trends", { connection: redis });
  await queue.upsertJobScheduler("x-trends-cron", { pattern: "*/5 * * * *" }, { name: "poll-trends" });
  log.info("x-trends-worker scheduled (every 5 minutes)");
}
