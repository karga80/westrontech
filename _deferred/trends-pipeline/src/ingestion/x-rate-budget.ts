import { getRedis } from "@/storage/redis-client";
import { createLogger } from "@/shared/logger";

const log = createLogger("x-rate-budget");

// X API Basic tier: 60 req / 15 min per endpoint
const WINDOW_SEC = 15 * 60;
const LIMIT_PER_WINDOW = 60;
const SAFE_LIMIT = 50; // keep 10 in reserve

export class XRateBudget {
  private readonly prefix = "x:rate";

  private key(endpoint: string): string {
    return `${this.prefix}:${endpoint}`;
  }

  async canCall(endpoint: string): Promise<boolean> {
    const redis = getRedis();
    const count = await redis.get(this.key(endpoint));
    const used = count ? parseInt(count, 10) : 0;
    return used < SAFE_LIMIT;
  }

  async recordCall(endpoint: string): Promise<void> {
    const redis = getRedis();
    const key = this.key(endpoint);
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SEC);
    }
    if (count > LIMIT_PER_WINDOW) {
      log.warn({ endpoint, count }, "Rate limit window exceeded — calls may fail");
    }
  }

  async getUsage(endpoint: string): Promise<{ used: number; limit: number; remaining: number }> {
    const redis = getRedis();
    const count = await redis.get(this.key(endpoint));
    const used = count ? parseInt(count, 10) : 0;
    return { used, limit: SAFE_LIMIT, remaining: Math.max(0, SAFE_LIMIT - used) };
  }

  async reset(endpoint: string): Promise<void> {
    const redis = getRedis();
    await redis.del(this.key(endpoint));
    log.debug({ endpoint }, "Rate budget reset");
  }
}

export const rateBudget = new XRateBudget();
