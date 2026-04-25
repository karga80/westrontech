import { getRedis } from "@/storage/redis-client";
import { slidingWindow } from "./sliding-window";
import { influencerWeights } from "./influencer-weights";
import { createLogger } from "@/shared/logger";
import type { EnrichedMemecoinSignal, EnrichedNFTSignal, AlertTier, FinalAlert } from "@/shared/types";

const log = createLogger("velocity-engine");

const MENTION_KEY_PREFIX = "mentions:window";
// const FINAL_ALERTS_STREAM = "signals:final-alerts"; // reserved for future use

// Tier thresholds
const TIER_THRESHOLDS: Record<AlertTier, number> = {
  yellow: 3.0,
  orange: 6.0,
  red: 10.0,
};

function getTier(score: number): AlertTier | null {
  if (score >= TIER_THRESHOLDS.red) return "red";
  if (score >= TIER_THRESHOLDS.orange) return "orange";
  if (score >= TIER_THRESHOLDS.yellow) return "yellow";
  return null;
}

export async function scoreMemecoin(signal: EnrichedMemecoinSignal): Promise<FinalAlert | null> {
  getRedis();
  const identifier = signal.tokenData.address;
  const mentionKey = `${MENTION_KEY_PREFIX}:memecoin:${identifier}`;

  // Track mention with author weight
  await slidingWindow.increment(mentionKey, 1);

  // Mention velocity: 5min vs 1h avg (12 slots of 5min)
  const mentions5m = await slidingWindow.getCount(mentionKey, 5 * 60);
  const mentions1hTotal = await slidingWindow.getCount(mentionKey, 60 * 60);
  const mentions1hAvgPer5m = Math.max(mentions1hTotal / 12, 1);
  const mentionVelocity = mentions5m / mentions1hAvgPer5m;

  // Authority score
  const authorWeight = await influencerWeights.getWeight(signal.author);
  const authorityScore = Math.min(authorWeight * Math.log(Math.max(signal.authorWeight, 1) + 1), 10);

  // On-chain score
  const vol1hAvgPer5m = Math.max(signal.tokenData.volume1h / 12, 1);
  const volRatio = signal.tokenData.volume5m / vol1hAvgPer5m;
  const onchainScore = Math.min(Math.log(Math.max(volRatio, 0.1)) * signal.velocityScore, 10);

  const totalScore =
    mentionVelocity * 0.4 +
    authorityScore * 0.35 +
    onchainScore * 0.25;

  const tier = getTier(totalScore);
  if (!tier) return null;

  const alert: FinalAlert = {
    id: `mc:${identifier}:${Date.now()}`,
    emittedAt: new Date().toISOString(),
    alertType: "memecoin",
    tier,
    identifier,
    chain: signal.tokenData.chain,
    score: parseFloat(totalScore.toFixed(2)),
    velocityScore: parseFloat(mentionVelocity.toFixed(2)),
    authorityScore: parseFloat(authorityScore.toFixed(2)),
    onchainScore: parseFloat(onchainScore.toFixed(2)),
    confluenceCount: 0,
    confluenceSources: [],
    enrichmentData: signal.tokenData,
    sourceTweets: [signal.sourceId],
  };

  log.debug({ identifier, tier, score: alert.score }, "Memecoin scored");
  return alert;
}

export async function scoreNFT(signal: EnrichedNFTSignal): Promise<FinalAlert | null> {
  const identifier = signal.collectionData.slug;
  const mentionKey = `${MENTION_KEY_PREFIX}:nft:${identifier}`;

  await slidingWindow.increment(mentionKey, 1);

  // NFT uses slower windows
  const mentions1h = await slidingWindow.getCount(mentionKey, 60 * 60);
  const mentions24hTotal = await slidingWindow.getCount(mentionKey, 24 * 60 * 60);
  const mentions24hAvgPerHour = Math.max(mentions24hTotal / 24, 1);
  const mentionVelocity = mentions1h / mentions24hAvgPerHour;

  const floorScore = Math.max(0, signal.floorVelocity1h * 100);
  const volumeScore = Math.log(Math.max(signal.volumeVelocity1h, 0.1) + 1);

  const totalScore =
    mentionVelocity * 0.3 +
    floorScore * 0.25 +
    volumeScore * 0.2;
  // pfp_score added by confluence detector when PFP changes come in

  const tier = getTier(totalScore);
  if (!tier) return null;

  const alert: FinalAlert = {
    id: `nft:${identifier}:${Date.now()}`,
    emittedAt: new Date().toISOString(),
    alertType: "nft",
    tier,
    identifier,
    chain: signal.collectionData.chain,
    score: parseFloat(totalScore.toFixed(2)),
    velocityScore: parseFloat(mentionVelocity.toFixed(2)),
    authorityScore: 0,
    onchainScore: parseFloat(volumeScore.toFixed(2)),
    confluenceCount: 0,
    confluenceSources: [],
    enrichmentData: signal.collectionData,
    sourceTweets: [signal.sourceId],
  };

  return alert;
}
