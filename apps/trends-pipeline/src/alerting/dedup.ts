import { getRedis } from "@/storage/redis-client";
import type { FinalAlert, AlertTier } from "@/shared/types";

const DEDUP_WINDOW_SEC = 30 * 60; // 30 minutes
const TIER_ORDER: Record<AlertTier, number> = { yellow: 1, orange: 2, red: 3 };

function dedupKey(alert: FinalAlert): string {
  return `dedup:alert:${alert.identifier}:${alert.tier}`;
}

function tierKey(identifier: string): string {
  return `dedup:tier:${identifier}`;
}

export async function shouldSendAlert(alert: FinalAlert): Promise<boolean> {
  const redis = getRedis();
  const key = dedupKey(alert);

  const alreadySent = await redis.get(key);
  if (alreadySent) return false;

  return true;
}

export async function markAlertSent(alert: FinalAlert): Promise<void> {
  const redis = getRedis();
  const key = dedupKey(alert);
  await redis.set(key, "1", "EX", DEDUP_WINDOW_SEC);
  await redis.set(tierKey(alert.identifier), alert.tier, "EX", DEDUP_WINDOW_SEC);
}

export async function isTierEscalation(alert: FinalAlert): Promise<boolean> {
  const redis = getRedis();
  const prevTier = (await redis.get(tierKey(alert.identifier))) as AlertTier | null;
  if (!prevTier) return false;
  return TIER_ORDER[alert.tier] > TIER_ORDER[prevTier];
}
