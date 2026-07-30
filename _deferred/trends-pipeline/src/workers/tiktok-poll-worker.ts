import { Worker, Queue } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { tiktokClient } from "@/ingestion/tiktok-client";
import { createLogger } from "@/shared/logger";
import { env } from "@/config/env";
import watchlist from "../../seeds/tiktok-watchlist.json" with { type: "json" };

const log = createLogger("tiktok-poll-worker");

const RAW_VIDEOS_STREAM = "tiktok:raw-videos";
const SEEN_VIDEOS_KEY = "tiktok:seen-videos";
const SEEN_TTL_SEC = 48 * 60 * 60;
const BATCH_SIZE = 5; // hashtags per minute
const MAX_VIDEO_AGE_MS = 24 * 60 * 60 * 1000;

const allHashtags = [
  ...watchlist.hashtags_memecoin,
  ...watchlist.hashtags_nft,
  ...watchlist.hashtags_general,
];

let hashtagIndex = 0;

export function createTikTokPollWorker(): Worker {
  const redis = getRedis();

  const worker = new Worker(
    "tiktok-poll",
    async () => {
      if (!env.SCRAPECREATORS_API_KEY) {
        log.debug("SCRAPECREATORS_API_KEY not set — skipping TikTok poll");
        return;
      }
      const batch = allHashtags.slice(hashtagIndex, hashtagIndex + BATCH_SIZE);
      hashtagIndex = (hashtagIndex + BATCH_SIZE) % allHashtags.length;

      let newVideos = 0;
      let apiCalls = 0;

      for (const hashtag of batch) {
        const videos = await tiktokClient.searchByHashtag(hashtag, 20);
        apiCalls++;

        const now = Date.now();
        for (const video of videos) {
          const age = now - new Date(video.createdAt).getTime();
          if (age > MAX_VIDEO_AGE_MS) continue;

          const seen = await redis.sismember(SEEN_VIDEOS_KEY, video.id);
          if (seen) continue;

          await redis.sadd(SEEN_VIDEOS_KEY, video.id);
          await redis.expire(SEEN_VIDEOS_KEY, SEEN_TTL_SEC);
          await redis.xadd(RAW_VIDEOS_STREAM, "*", "payload", JSON.stringify(video));
          newVideos++;
        }
      }

      log.info({ hashtagsScanned: batch.length, newVideos, apiCalls }, "TikTok poll complete");
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "tiktok-poll-worker job failed");
  });

  return worker;
}

export async function scheduleTikTokPollJob(): Promise<void> {
  const redis = getRedis();
  const queue = new Queue("tiktok-poll", { connection: redis });
  await queue.upsertJobScheduler("tiktok-poll-cron", { pattern: "*/1 * * * *" }, { name: "poll-tiktok" });
  log.info("tiktok-poll-worker scheduled (every 1 minute)");
}
