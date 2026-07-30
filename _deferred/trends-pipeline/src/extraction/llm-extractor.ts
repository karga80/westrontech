import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { getRedis } from "@/storage/redis-client";
import { env } from "@/config/env";
import { createLogger } from "@/shared/logger";

const log = createLogger("llm-extractor");

const LLM_CACHE_TTL_SEC = 24 * 60 * 60;
const RATE_LIMIT_WINDOW_SEC = 60 * 60;
const RATE_LIMIT_MAX = 200;
const RATE_KEY = "llm:calls:hour";

const SignalSchema = z.object({
  tickers: z.array(z.string()),
  contracts: z.array(z.string()),
  collections: z.array(z.string()),
  isCallout: z.boolean(),
  sentiment: z.enum(["bullish", "bearish", "neutral"]),
  confidence: z.number().min(0).max(1),
});

export type LLMSignal = z.infer<typeof SignalSchema>;

let anthropic: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return anthropic;
}

async function isRateLimited(): Promise<boolean> {
  const redis = getRedis();
  const count = await redis.get(RATE_KEY);
  return count !== null && parseInt(count, 10) >= RATE_LIMIT_MAX;
}

async function incrementRateLimit(): Promise<void> {
  const redis = getRedis();
  const count = await redis.incr(RATE_KEY);
  if (count === 1) await redis.expire(RATE_KEY, RATE_LIMIT_WINDOW_SEC);
}

function cacheKey(text: string): string {
  // simple hash using Bun's built-in
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (Math.imul(31, hash) + text.charCodeAt(i)) | 0;
  }
  return `llm:cache:${Math.abs(hash)}`;
}

export async function extractWithLLM(text: string): Promise<LLMSignal | null> {
  if (await isRateLimited()) {
    log.warn("LLM rate limit reached — skipping extraction");
    return null;
  }

  const redis = getRedis();
  const key = cacheKey(text);
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached) as LLMSignal;
  }

  const client = getClient();
  if (!client) {
    log.debug("ANTHROPIC_API_KEY not set — skipping LLM extraction");
    return null;
  }

  await incrementRateLimit();

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: `You are a crypto/NFT signal extractor. Extract structured data from social media posts.
Return ONLY valid JSON matching this schema:
{ tickers: string[], contracts: string[], collections: string[], isCallout: boolean, sentiment: "bullish"|"bearish"|"neutral", confidence: number }
- tickers: cashtag symbols found (e.g. ["$SOL","$BONK"])
- contracts: blockchain contract addresses (EVM 0x... or Solana base58)
- collections: NFT collection slugs or names
- isCallout: true if this is someone recommending a buy/action
- sentiment: overall market sentiment of the post
- confidence: 0-1 how confident you are in the extraction`,
      messages: [{ role: "user", content: `Extract signals from: "${text.slice(0, 500)}"` }],
    });

    const content = response.content[0];
    if (content?.type !== "text") return null;

    const parsed = JSON.parse(content.text) as unknown;
    const result = SignalSchema.safeParse(parsed);
    if (!result.success) {
      log.warn({ text: text.slice(0, 50) }, "LLM response failed schema validation");
      return null;
    }

    await redis.set(key, JSON.stringify(result.data), "EX", LLM_CACHE_TTL_SEC);
    return result.data;
  } catch (err) {
    log.error({ err }, "LLM extraction failed");
    return null;
  }
}
