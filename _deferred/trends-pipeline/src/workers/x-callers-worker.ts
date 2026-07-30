import { Worker, Queue } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { xClient } from "@/ingestion/x-client";
import { createLogger } from "@/shared/logger";
import type { RawXPost, AlphaCaller } from "@/shared/types";
import alphaCallersData from "../../seeds/alpha-callers.json" with { type: "json" };

const log = createLogger("x-callers-worker");

const RAW_POSTS_STREAM = "x:raw-posts";
const CALLER_CURSOR_PREFIX = "x:caller:cursor";
const BATCH_SIZE = 20; // fetch 20 callers per minute → each caller checked every ~10 min for 200 callers

let callerIndex = 0;

export function createXCallersWorker(): Worker {
  const redis = getRedis();
  const callers: AlphaCaller[] = alphaCallersData.callers as AlphaCaller[];

  const worker = new Worker(
    "x-callers",
    async () => {
      if (callers.length === 0) {
        log.debug("No alpha callers configured yet — skipping");
        return;
      }

      const batch = callers.slice(callerIndex, callerIndex + BATCH_SIZE);
      callerIndex = (callerIndex + BATCH_SIZE) % callers.length;

      let totalPosts = 0;

      for (const caller of batch) {
        if (!caller.userId) continue;

        const cursorKey = `${CALLER_CURSOR_PREFIX}:${caller.userId}`;
        const sinceId = (await redis.get(cursorKey)) ?? undefined;

        const tweets = await xClient.getUserPosts(caller.userId, sinceId, 20);
        if (tweets.length === 0) continue;

        // Store newest tweet id as cursor
        await redis.set(cursorKey, tweets[0]!.id, "EX", 24 * 60 * 60);

        for (const tweet of tweets) {
          const post: RawXPost = {
            id: tweet.id,
            text: tweet.text,
            authorId: caller.userId,
            authorHandle: caller.handle,
            authorFollowers: 0,
            likes: tweet.public_metrics?.like_count ?? 0,
            retweets: tweet.public_metrics?.retweet_count ?? 0,
            createdAt: tweet.created_at ?? new Date().toISOString(),
            source: "alpha-caller",
            callerWeight: caller.weight,
          };

          await redis.xadd(RAW_POSTS_STREAM, "*", "payload", JSON.stringify(post));
          totalPosts++;
        }
      }

      log.info({ callersChecked: batch.length, totalPosts }, "Alpha callers polled");
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "x-callers-worker job failed");
  });

  return worker;
}

export async function scheduleXCallersJob(): Promise<void> {
  const redis = getRedis();
  const queue = new Queue("x-callers", { connection: redis });
  await queue.upsertJobScheduler("x-callers-cron", { pattern: "*/1 * * * *" }, { name: "poll-callers" });
  log.info("x-callers-worker scheduled (every 1 minute)");
}
