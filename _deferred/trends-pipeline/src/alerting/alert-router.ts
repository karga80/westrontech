import { getRedis } from "@/storage/redis-client";
import { pushAlert } from "./websocket-server";
import { sendAlert, isRateLimited, markSent } from "./telegram-bot";
import { shouldSendAlert, markAlertSent, isTierEscalation } from "./dedup";
import { formatForTelegram } from "./alert-formatter";
import { createLogger } from "@/shared/logger";
import type { FinalAlert } from "@/shared/types";

const log = createLogger("alert-router");

const FINAL_ALERTS_STREAM = "signals:final-alerts";
const CONSUMER_GROUP = "alert-router";

async function ensureGroup(redis: ReturnType<typeof getRedis>): Promise<void> {
  try {
    await redis.xgroup("CREATE", FINAL_ALERTS_STREAM, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

export async function runAlertRouter(): Promise<void> {
  const redis = getRedis();
  await ensureGroup(redis);
  log.info("Alert router started");

  while (true) {
    const messages = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, "alert-router-1",
      "COUNT", "10",
      "BLOCK", "5000",
      "STREAMS", FINAL_ALERTS_STREAM, ">",
    );

    if (!messages || messages.length === 0) continue;

    const [[, entries]] = messages as [[string, [string, string[]][]]];

    for (const [msgId, fields] of entries) {
      const payloadIdx = fields.indexOf("payload");
      if (payloadIdx === -1) continue;

      const alert = JSON.parse(fields[payloadIdx + 1] as string) as FinalAlert;

      const isEscalation = await isTierEscalation(alert);
      const shouldSend = isEscalation || (await shouldSendAlert(alert));

      if (shouldSend) {
        // Push via WebSocket (always, if clients connected)
        pushAlert(alert);

        // Push via Telegram (rate-limited per token)
        if (!isRateLimited(alert.identifier)) {
          const message = formatForTelegram(alert);
          await sendAlert(message, alert.tier, alert);
          markSent(alert.identifier);
        }

        await markAlertSent(alert);
        log.info({ id: alert.id, tier: alert.tier, identifier: alert.identifier }, "Alert dispatched");
      }

      await redis.xack(FINAL_ALERTS_STREAM, CONSUMER_GROUP, msgId);
    }
  }
}
