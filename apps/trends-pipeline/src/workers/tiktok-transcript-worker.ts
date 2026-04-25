import { Worker } from "bullmq";
import { getRedis } from "@/storage/redis-client";
import { tiktokClient } from "@/ingestion/tiktok-client";
import { createLogger } from "@/shared/logger";
import type { RawTikTokVideo } from "@/shared/types";

const log = createLogger("tiktok-transcript-worker");

const RAW_VIDEOS_STREAM = "tiktok:raw-videos";
const ENRICHED_VIDEOS_STREAM = "tiktok:enriched-videos";
const CONSUMER_GROUP = "transcript-fetcher";

const MIN_VIEWS_FOR_TRANSCRIPT = 10_000;
const MIN_LIKES_FOR_TRANSCRIPT = 1_000;

async function ensureGroup(redis: ReturnType<typeof getRedis>): Promise<void> {
  try {
    await redis.xgroup("CREATE", RAW_VIDEOS_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

export function createTikTokTranscriptWorker(): Worker {
  const redis = getRedis();

  const worker = new Worker(
    "tiktok-transcript",
    async () => {
      await ensureGroup(redis);

      const messages = await redis.xreadgroup(
        "GROUP",
        CONSUMER_GROUP,
        "transcript-worker-1",
        "COUNT",
        "20",
        "STREAMS",
        RAW_VIDEOS_STREAM,
        ">",
      );

      if (!messages || messages.length === 0) return;

      const [[, entries]] = messages as [[string, [string, string[]][]]];
      let transcriptsFetched = 0;

      for (const [msgId, fields] of entries) {
        const payloadIdx = fields.indexOf("payload");
        if (payloadIdx === -1) continue;

        const video = JSON.parse(fields[payloadIdx + 1] as string) as RawTikTokVideo;

        // Only fetch transcripts for high-engagement videos
        if (video.views >= MIN_VIEWS_FOR_TRANSCRIPT || video.likes >= MIN_LIKES_FOR_TRANSCRIPT) {
          if (!video.transcript) {
            video.transcript = await tiktokClient.getVideoTranscript(video.id);
            if (video.transcript) transcriptsFetched++;
          }
        }

        await redis.xadd(ENRICHED_VIDEOS_STREAM, "*", "payload", JSON.stringify(video));
        await redis.xack(RAW_VIDEOS_STREAM, CONSUMER_GROUP, msgId);
      }

      if (transcriptsFetched > 0) {
        log.info({ transcriptsFetched }, "Transcripts fetched");
      }
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "tiktok-transcript-worker job failed");
  });

  return worker;
}
