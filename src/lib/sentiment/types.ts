// ─── Sentiment Module — Core Types ──────────────────────────────────────────

export type WatchlistItemType = 'token' | 'nft';
export type UpdateInterval = '15m' | '1h' | '4h' | 'manual';
export type AnalysisDays = 1 | 3 | 7;
export type ScoreLevel = 'low' | 'mid' | 'high';

// ─── Watchlist ───────────────────────────────────────────────────────────────

export interface WatchlistItem {
  id: string;
  type: WatchlistItemType;
  name: string;
  contractAddress: string;
  twitterUrl: string;
  discordUrl?: string;
  openSeaUrl?: string;
  extraLinks?: string[];
  analysisDays: AnalysisDays;
  updateInterval: UpdateInterval;
  createdAt: string;
  lastUpdated?: string;
}

export interface TokenWatchlistItem extends WatchlistItem {
  type: 'token';
}

export interface NFTWatchlistItem extends WatchlistItem {
  type: 'nft';
  discordUrl: string;
  openSeaUrl: string;
}

// ─── Score ───────────────────────────────────────────────────────────────────

export interface ScoreSnapshot {
  score: number;            // 0–100 toplam skor
  twitterScore: number;     // 0–35 (token) veya 0–25 (nft)
  onchainScore: number;     // 0–25 (token) — buy/sell + holder
  openSeaScore: number;     // 0–40 (nft) — volume + floor
  whaleScore: number;       // 0–15 (nft)
  kolScore: number;         // KOL bileşeni (token'da twitter'a dahil)
  level: ScoreLevel;
  computedAt: string;
}

export interface ScoreHistory {
  watchlistId: string;
  entries: Array<{
    score: number;
    snapshot: ScoreSnapshot;
    createdAt: string;
  }>;
}

// ─── Twitter ─────────────────────────────────────────────────────────────────

export interface KOLMention {
  handle: string;
  displayName: string;
  followerCount: number;
  tweetText: string;       // ilk 120 karakter
  tweetUrl: string;
  likes: number;
  retweets: number;
  postedAt: string;
  isManualList: boolean;
}

export interface TwitterData {
  mentionCount: number;
  mentionVelocity: number;         // son 1sa / önceki 1sa oranı
  sentimentBreakdown: {
    positive: number;              // yüzde
    negative: number;
    neutral: number;
  };
  kolMentions: KOLMention[];
  fetchedAt: string;
}

// ─── On-chain (Helius — Solana) ───────────────────────────────────────────────

export interface OnChainData {
  holderCount: number;
  holderChange24h: number;
  holderChangePct24h: number;
  buyCount: number;
  sellCount: number;
  buySellRatio: number;
  solscanUrl: string;
  birdeyeUrl: string;
  fetchedAt: string;
}

// ─── Price (Birdeye) ─────────────────────────────────────────────────────────

export interface PriceData {
  currentPrice: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  fetchedAt: string;
}

// ─── OpenSea (NFT) ───────────────────────────────────────────────────────────

export interface OpenSeaData {
  floorPrice: number;
  floorPriceChange24h: number;
  volume24h: number;
  volumeChange24h: number;
  salesCount24h: number;
  salesVelocity: number;
  openSeaUrl: string;
  fetchedAt: string;
}

// ─── Whale Tracker ───────────────────────────────────────────────────────────

export interface WhaleHolder {
  address: string;
  tokenCount: number;
  supplyPercent: number;
  etherscanUrl: string;
}

export interface WhaleData {
  topHolders: WhaleHolder[];
  whaleConcentration: number;     // top 10 toplam %
  whaleMovement7d: {
    entering: number;
    exiting: number;
  };
  fetchedAt: string;
}

// ─── Aggregated Data ─────────────────────────────────────────────────────────

export interface TokenFetchResult {
  watchlistId: string;
  twitter?: TwitterData;
  onchain?: OnChainData;
  price?: PriceData;
  error?: string;
}

export interface NFTFetchResult {
  watchlistId: string;
  twitter?: TwitterData;
  openSea?: OpenSeaData;
  whale?: WhaleData;
  error?: string;
}

// ─── KOL ─────────────────────────────────────────────────────────────────────

export interface KOLEntry {
  id: string;
  twitterHandle: string;
  displayName: string;
  followerCount: number;
  isManual: boolean;
  lastSynced?: string;
}

// ─── Alert ───────────────────────────────────────────────────────────────────

export type AlertType = 'score_change' | 'kol_mention' | 'whale_movement' | 'floor_change';

export interface SentimentAlert {
  id: string;
  watchlistId: string;
  type: AlertType;
  message: string;
  seen: boolean;
  createdAt: string;
}

// ─── Score helpers ───────────────────────────────────────────────────────────

export function getScoreLevel(score: number): ScoreLevel {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export function getScoreColor(level: ScoreLevel): string {
  switch (level) {
    case 'high': return 'var(--wr-success)';
    case 'mid':  return 'var(--wr-warn)';
    case 'low':  return 'var(--wr-danger)';
  }
}

export function getScoreLabel(level: ScoreLevel): string {
  switch (level) {
    case 'high': return 'STRONG';
    case 'mid':  return 'MID';
    case 'low':  return 'LOW';
  }
}
