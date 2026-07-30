import { Worker } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { xClient } from "@/ingestion/x-client";
import { createLogger } from "@/shared/logger";
import type { VelocitySpike, RawXPost } from "@/shared/types";

const log = createLogger("x-posts-worker");

const SPIKE_STREAM = "x:velocity-spike";
const RAW_POSTS_STREAM = "x:raw-posts";
const SEEN_POSTS_KEY = "x:seen-posts";
const SEEN_TTL_SEC = 24 * 60 * 60;
const CONSUMER_GROUP = "posts-fetcher";
const MAX_RESULTS_PER_SPIKE = 50;

async function ensureConsumerGroup(redis: ReturnType<typeof getRedis>): Promise<void> {
  try {
    await redis.xgroup("CREATE", SPIKE_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

export function createXPostsWorker(): Worker {
  const redis = getRedis();

  const worker = new Worker(
    "x-posts",
    async () => {
      await ensureConsumerGroup(redis);

      const messages = await redis.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        "posts-worker-1",
        "COUNT",
        "10",
        "STREAMS",
        SPIKE_STREAM,
        ">",
      );

      if (!messages || messages.length === 0) return;

      const [[, entries]] = messages as [[string, [string, string[]][]]];
      let newPosts = 0;

      for (const [msgId, fields] of entries) {
        const payloadIdx = fields.indexOf("payload");
        if (payloadIdx === -1) continue;

        const spike = JSON.parse(fields[payloadIdx + 1] as string) as VelocitySpike;
        const query = `(${spike.term}) lang:en`;

        const tweets = await xClient.searchRecent(query, undefined, MAX_RESULTS_PER_SPIKE);

        for (const tweet of tweets) {
          const alreadySeen = await redis.sismember(SEEN_POSTS_KEY, tweet.id);
          if (alreadySeen) continue;

          await redis.sadd(SEEN_POSTS_KEY, tweet.id);
          await redis.expire(SEEN_POSTS_KEY, SEEN_TTL_SEC);

          const post: RawXPost = {
            id: tweet.id,
            text: tweet.text,
            authorId: tweet.author_id ?? "",
            authorHandle: "",
            authorFollowers: 0,
            likes: tweet.public_metrics?.like_count ?? 0,
            retweets: tweet.public_metrics?.retweet_count ?? 0,
            createdAt: tweet.created_at ?? new Date().toISOString(),
            source: "velocity-trigger",
            term: spike.term,
          };

          await redis.xadd(RAW_POSTS_STREAM, "*", "payload", JSON.stringify(post));
          newPosts++;
        }

        await redis.xack(SPIKE_STREAM, CONSUMER_GROUP, msgId);
      }

      if (newPosts > 0) {
        log.info({ newPosts }, "Posts pushed to x:raw-posts stream");
      }
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "x-posts-worker job failed");
  });

  return worker;
}
