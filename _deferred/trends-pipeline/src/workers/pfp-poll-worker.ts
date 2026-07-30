import { Worker, Queue } from "bullmq";
import pLimit from "p-limit";
import { getRedis } from "@/storage/redis-client";
import { fetchAvatar } from "@/enrichment/pfp-tracker/avatar-fetcher";
import { hashImage, compareHashes } from "@/enrichment/pfp-tracker/hash-comparator";
import { resolveCollection } from "@/enrichment/pfp-tracker/collection-resolver";
import { createLogger } from "@/shared/logger";
import type { PFPWatchHandle, PFPChangeSignal } from "@/shared/types";
import pfpWatchList from "../../seeds/pfp-watch-list.json" with { type: "json" };

const log = createLogger("pfp-poll-worker");

const PFP_HASH_PREFIX = "pfp:hash";
const PFP_CHANGE_STREAM = "signals:pfp-change";
const BATCH_CONCURRENCY = 10;

const limit = pLimit(BATCH_CONCURRENCY);

export function createPFPPollWorker(): Worker {
  const redis = getRedis();
  const handles: PFPWatchHandle[] = pfpWatchList.handles as PFPWatchHandle[];

  const worker = new Worker(
    "pfp-poll",
    async () => {
      log.info({ count: handles.length }, "PFP poll starting");
      let changed = 0;
      let unchanged = 0;
      let errors = 0;

      const tasks = handles.map((entry) =>
        limit(async () => {
          try {
            const avatar = await fetchAvatar(entry.handle);
            if (!avatar) { errors++; return; }

            const newHash = await hashImage(avatar.imageUrl);
            if (!newHash) { errors++; return; }

            const hashKey = `${PFP_HASH_PREFIX}:${entry.handle}`;
            const oldData = await redis.hgetall(hashKey);

            if (!oldData.hash) {
              // First time seeing this handle — store hash, no alert
              await redis.hset(hashKey, { hash: newHash, url: avatar.imageUrl, updatedAt: avatar.fetchedAt });
              return;
            }

            const comparison = compareHashes(oldData.hash, newHash);

            if (comparison === "different") {
              // PFP changed — resolve collection
              const resolution = await resolveCollection(entry.handle, avatar.imageUrl);

              const changeSignal: PFPChangeSignal = {
                handle: entry.handle,
                weight: entry.weight,
                oldCollection: oldData.collection ?? null,
                newCollection: resolution.collection_slug,
                collectionConfidence: resolution.confidence,
                ts: new Date().toISOString(),
              };

              await redis.xadd(PFP_CHANGE_STREAM, "*", "payload", JSON.stringify(changeSignal));
              await redis.hset(hashKey, {
                hash: newHash,
                url: avatar.imageUrl,
                collection: resolution.collection_slug ?? "",
                updatedAt: avatar.fetchedAt,
              });

              log.info({ handle: entry.handle, newCollection: resolution.collection_slug }, "PFP change detected");
              changed++;
            } else if (comparison === "uncertain") {
              // Recheck next cycle — don't update hash
              log.debug({ handle: entry.handle }, "PFP uncertain — will recheck");
            } else {
              unchanged++;
            }
          } catch (err) {
            log.warn({ handle: entry.handle, err }, "PFP poll error for handle");
            errors++;
          }
        }),
      );

      await Promise.all(tasks);
      log.info({ changed, unchanged, errors, total: handles.length }, "PFP poll complete");
    },
    { connection: redis, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    log.error({ jobId: job?.id, err: err.message }, "pfp-poll-worker job failed");
  });

  return worker;
}

export async function schedulePFPPollJob(): Promise<void> {
  const redis = getRedis();
  const queue = new Queue("pfp-poll", { connection: redis });
  await queue.upsertJobScheduler("pfp-poll-cron", { pattern: "*/30 * * * *" }, { name: "poll-pfp" });
  log.info("pfp-poll-worker scheduled (every 30 minutes)");
}
