import { createLogger } from "@/shared/logger";
import { env } from "@/config/env";
import { startWebSocketServer } from "@/alerting/websocket-server";
import { registerOwner } from "@/alerting/telegram-bot";
import { createXCountsWorker, scheduleXCountsJob } from "@/workers/x-counts-worker";
import { createXPostsWorker } from "@/workers/x-posts-worker";
import { createXCallersWorker, scheduleXCallersJob } from "@/workers/x-callers-worker";
import { createXTrendsWorker, scheduleXTrendsJob } from "@/workers/x-trends-worker";
import { createTikTokPollWorker, scheduleTikTokPollJob } from "@/workers/tiktok-poll-worker";
import { createTikTokTranscriptWorker } from "@/workers/tiktok-transcript-worker";
import { createPFPPollWorker, schedulePFPPollJob } from "@/workers/pfp-poll-worker";
import { runSignalRouter } from "@/extraction/signal-router";
import { runMemecoinEnricher } from "@/enrichment/memecoin-enricher";
import { runNFTEnricher } from "@/enrichment/nft-enricher";
import { runAlertRouter } from "@/alerting/alert-router";

const log = createLogger("main");

async function main() {
  log.info({ nodeEnv: env.NODE_ENV, dryRun: env.DRY_RUN }, "Westron Trends Pipeline starting");

  if (env.DRY_RUN) {
    log.warn("DRY_RUN=true — alerts will NOT be pushed to WebSocket or Telegram");
  }

  // Start WebSocket server
  await startWebSocketServer();

  // Register Telegram bot owner
  registerOwner();

  // Start BullMQ workers
  createXCountsWorker();
  createXPostsWorker();
  createXCallersWorker();
  createXTrendsWorker();
  createTikTokPollWorker();
  createTikTokTranscriptWorker();
  createPFPPollWorker();

  // Schedule cron jobs
  await scheduleXCountsJob();
  await scheduleXCallersJob();
  await scheduleXTrendsJob();
  await scheduleTikTokPollJob();
  await schedulePFPPollJob();

  // Start stream processors (blocking loops — run in background)
  runSignalRouter().catch((err) => log.error({ err }, "Signal router crashed"));
  runMemecoinEnricher().catch((err) => log.error({ err }, "Memecoin enricher crashed"));
  runNFTEnricher().catch((err) => log.error({ err }, "NFT enricher crashed"));
  runAlertRouter().catch((err) => log.error({ err }, "Alert router crashed"));

  log.info("All workers and processors started");
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
