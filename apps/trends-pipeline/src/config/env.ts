import { z } from "zod";

const envSchema = z.object({
  // X API
  X_BEARER_TOKEN: z.string().min(1, "X_BEARER_TOKEN required"),
  X_OAUTH_CONSUMER_KEY: z.string().optional(),
  X_OAUTH_CONSUMER_SECRET: z.string().optional(),

  // TikTok
  SCRAPECREATORS_API_KEY: z.string().min(1, "SCRAPECREATORS_API_KEY required"),

  // NFT
  RESERVOIR_API_KEY: z.string().min(1, "RESERVOIR_API_KEY required"),
  OPENSEA_API_KEY: z.string().optional(),

  // LLM
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY required"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN required"),
  TELEGRAM_USER_ID: z.string().min(1, "TELEGRAM_USER_ID required"),

  // Storage
  POSTGRES_URL: z.string().url(),
  POSTGRES_URL_TEST: z.string().url().optional(),
  REDIS_URL: z.string().url(),

  // xmcp
  XMCP_URL: z.string().url().default("http://localhost:8001/mcp"),

  // App
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  WESTRON_USER_TOKEN: z.string().default("dev-token"),

  // Ports
  WS_PORT: z.coerce.number().default(3001),
  API_PORT: z.coerce.number().default(3000),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${missing}`);
  }
  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
