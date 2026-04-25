import Redis from "ioredis";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";

const log = createLogger("redis");

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    client.on("connect", () => log.info("Redis connected"));
    client.on("error", (err) => log.error({ err }, "Redis error"));
    client.on("reconnecting", () => log.warn("Redis reconnecting"));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
