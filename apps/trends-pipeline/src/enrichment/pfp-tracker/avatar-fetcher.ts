import { xClient } from "@/ingestion/x-client";
import { getRedis } from "@/storage/redis-client";
import { createLogger } from "@/shared/logger";

const log = createLogger("avatar-fetcher");

const PFP_URL_PREFIX = "pfp:url";
const PFP_TTL_SEC = 35 * 60; // slightly over 30min polling interval

export interface AvatarInfo {
  handle: string;
  imageUrl: string;
  fetchedAt: string;
}

export async function fetchAvatar(handle: string): Promise<AvatarInfo | null> {
  const redis = getRedis();
  const cacheKey = `${PFP_URL_PREFIX}:${handle}`;

  const user = await xClient.resolveHandle(handle);
  if (!user?.profile_image_url) {
    log.debug({ handle }, "Could not resolve avatar");
    return null;
  }

  // X normalizes profile images to 48x48 by default; get 400x400
  const imageUrl = user.profile_image_url.replace("_normal", "_400x400");

  const info: AvatarInfo = { handle, imageUrl, fetchedAt: new Date().toISOString() };
  await redis.set(cacheKey, JSON.stringify(info), "EX", PFP_TTL_SEC);

  return info;
}

export async function getCachedAvatar(handle: string): Promise<AvatarInfo | null> {
  const redis = getRedis();
  const raw = await redis.get(`${PFP_URL_PREFIX}:${handle}`);
  return raw ? (JSON.parse(raw) as AvatarInfo) : null;
}
