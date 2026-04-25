import { getRedis } from "@/storage/redis-client";

const WINDOW_TTL_SEC = 24 * 60 * 60;

export class SlidingWindow {
  async increment(key: string, amount = 1): Promise<void> {
    const redis = getRedis();
    const ts = Date.now();
    await redis.zadd(key, ts, `${ts}:${Math.random()}`);
    if (amount > 1) {
      for (let i = 1; i < amount; i++) {
        await redis.zadd(key, ts, `${ts}:${Math.random()}`);
      }
    }
    await redis.expire(key, WINDOW_TTL_SEC);
  }

  async getCount(key: string, windowSec: number): Promise<number> {
    const redis = getRedis();
    const cutoff = Date.now() - windowSec * 1000;
    return redis.zcount(key, cutoff, "+inf");
  }

  async getVelocityRatio(key: string, shortWindowSec: number, longWindowSec: number): Promise<number> {
    const redis = getRedis();
    const now = Date.now();
    const shortCutoff = now - shortWindowSec * 1000;
    const longCutoff = now - longWindowSec * 1000;

    const shortCount = await redis.zcount(key, shortCutoff, "+inf");
    const longCount = await redis.zcount(key, longCutoff, shortCutoff);

    const longSlots = longWindowSec / shortWindowSec;
    const longAvgPerSlot = longSlots > 0 ? longCount / longSlots : 0;

    return longAvgPerSlot > 0 ? shortCount / longAvgPerSlot : 1;
  }

  async cleanup(key: string): Promise<void> {
    const redis = getRedis();
    const cutoff = Date.now() - WINDOW_TTL_SEC * 1000;
    await redis.zremrangebyscore(key, "-inf", cutoff);
  }
}

export const slidingWindow = new SlidingWindow();
