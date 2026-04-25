import { getRedis } from "@/storage/redis-client";
import { createLogger } from "@/shared/logger";
import {
  extractCashtags,
  extractEvmContracts,
  extractSolanaContracts,
  extractOpenseaSlugs,
  extractBlurSlugs,
  extractMagicEdenSlugs,
  extractPumpFunLinks,
  detectMintKeywords,
  detectPfpKeywords,
  detectSweepKeywords,
  isCryptoCandiate,
} from "./regex-extractor";
import { extractWithLLM } from "./llm-extractor";
import type { RawXPost, RawTikTokVideo, ExtractedSignal, Chain, SignalType } from "@/shared/types";

const log = createLogger("signal-router");

const X_RAW_STREAM = "x:raw-posts";
const TIKTOK_ENRICHED_STREAM = "tiktok:enriched-videos";
const EXTRACTED_STREAM = "signals:extracted";
const CONSUMER_GROUP = "signal-extractor";

let stats = { processed: 0, dropped: 0, llmCalls: 0 };

async function ensureGroup(redis: ReturnType<typeof getRedis>, stream: string): Promise<void> {
  try {
    await redis.xgroup("CREATE", stream, CONSUMER_GROUP, "0", "MKSTREAM");
  } catch (err: unknown) {
    if (err instanceof Error && !err.message.includes("BUSYGROUP")) throw err;
  }
}

function buildSignal(
  source: "x" | "tiktok",
  sourceId: string,
  author: string,
  authorWeight: number,
  text: string,
  tickers: string[],
  evmContracts: string[],
  solContracts: string[],
  collections: string[],
  mintDetected: boolean,
  pfpDetected: boolean,
  sweepDetected: boolean,
  extractedBy: "regex" | "llm",
): ExtractedSignal {
  const hasNft = collections.length > 0 || pfpDetected || sweepDetected;
  const hasMemecoin = tickers.length > 0 || evmContracts.length > 0 || solContracts.length > 0;
  const signalType: SignalType = hasNft && hasMemecoin ? "mixed" : hasNft ? "nft" : "memecoin";

  return {
    source,
    sourceId,
    author,
    authorWeight,
    text,
    tickers,
    contracts: [
      ...evmContracts.map((a) => ({ address: a, chain: "ethereum" as Chain })),
      ...solContracts.map((a) => ({ address: a, chain: "solana" as Chain })),
    ],
    collections,
    signalType,
    timestamp: new Date().toISOString(),
    extractedBy,
    mintDetected,
    pfpDetected,
    sweepDetected,
  };
}

async function processText(
  redis: ReturnType<typeof getRedis>,
  source: "x" | "tiktok",
  sourceId: string,
  author: string,
  authorWeight: number,
  text: string,
): Promise<boolean> {
  const tickers = extractCashtags(text);
  const evmContracts = extractEvmContracts(text);
  const solContracts = extractSolanaContracts(text);
  const openseaSlugs = extractOpenseaSlugs(text);
  const blurSlugs = extractBlurSlugs(text);
  const magicEdenSlugs = extractMagicEdenSlugs(text);
  const pumpFunLinks = extractPumpFunLinks(text);
  const mintDetected = detectMintKeywords(text);
  const pfpDetected = detectPfpKeywords(text);
  const sweepDetected = detectSweepKeywords(text);

  const collections = [...openseaSlugs, ...blurSlugs, ...magicEdenSlugs];
  // pump.fun links are treated as Solana contracts
  solContracts.push(...pumpFunLinks);

  const hasAnySignal =
    tickers.length > 0 ||
    evmContracts.length > 0 ||
    solContracts.length > 0 ||
    collections.length > 0 ||
    mintDetected ||
    pfpDetected ||
    sweepDetected;

  if (hasAnySignal) {
    const signal = buildSignal(
      source, sourceId, author, authorWeight, text,
      tickers, evmContracts, solContracts, collections,
      mintDetected, pfpDetected, sweepDetected, "regex",
    );
    await redis.xadd(EXTRACTED_STREAM, "*", "payload", JSON.stringify(signal));
    return true;
  }

  // Try LLM for crypto candidates that regex missed
  if (isCryptoCandiate(text)) {
    const llmResult = await extractWithLLM(text);
    if (llmResult && (llmResult.tickers.length > 0 || llmResult.contracts.length > 0 || llmResult.collections.length > 0)) {
      stats.llmCalls++;
      const evmFromLlm = llmResult.contracts.filter((c) => c.startsWith("0x"));
      const solFromLlm = llmResult.contracts.filter((c) => !c.startsWith("0x"));
      const signal = buildSignal(
        source, sourceId, author, authorWeight, text,
        llmResult.tickers, evmFromLlm, solFromLlm, llmResult.collections,
        false, false, false, "llm",
      );
      await redis.xadd(EXTRACTED_STREAM, "*", "payload", JSON.stringify(signal));
      return true;
    }
  }

  return false;
}

export async function runSignalRouter(): Promise<void> {
  const redis = getRedis();
  await ensureGroup(redis, X_RAW_STREAM);
  await ensureGroup(redis, TIKTOK_ENRICHED_STREAM);

  log.info("Signal router started — consuming x:raw-posts and tiktok:enriched-videos");

  while (true) {
    // Read from both streams
    const messages = await redis.xreadgroup(
      "GROUP", CONSUMER_GROUP, "signal-router-1",
      "COUNT", "20",
      "BLOCK", "5000",
      "STREAMS", X_RAW_STREAM, TIKTOK_ENRICHED_STREAM, ">", ">",
    );

    if (!messages || messages.length === 0) continue;

    for (const [stream, entries] of messages as [string, [string, string[]][]][]) {
      for (const [msgId, fields] of entries) {
        const payloadIdx = fields.indexOf("payload");
        if (payloadIdx === -1) continue;

        const payload = JSON.parse(fields[payloadIdx + 1] as string) as RawXPost | RawTikTokVideo;

        let extracted = false;
        if (stream === X_RAW_STREAM) {
          const post = payload as RawXPost;
          extracted = await processText(redis, "x", post.id, post.authorHandle, post.callerWeight ?? 1, post.text);
        } else {
          const video = payload as RawTikTokVideo;
          const text = [video.caption, ...(video.hashtags ?? []), video.transcript ?? ""].join(" ");
          extracted = await processText(redis, "tiktok", video.id, video.author, 1, text);
        }

        stats.processed++;
        if (!extracted) stats.dropped++;

        await redis.xack(stream as string, CONSUMER_GROUP, msgId);
      }
    }

    // Log stats every 100 items
    if (stats.processed % 100 === 0 && stats.processed > 0) {
      const dropRate = ((stats.dropped / stats.processed) * 100).toFixed(1);
      log.info({ ...stats, dropRate: `${dropRate}%` }, "Signal router stats");
    }
  }
}
