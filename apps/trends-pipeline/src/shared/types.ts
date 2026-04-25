// ── Source types ──────────────────────────────────────────────────────────────

export type DataSource = "x" | "tiktok";
export type Chain = "solana" | "ethereum" | "base";
export type SignalType = "memecoin" | "nft" | "mixed";
export type AlertTier = "yellow" | "orange" | "red";
export type AlertType = "memecoin" | "nft" | "pfp_cluster";
export type IdentifierType = "ticker" | "contract" | "collection" | "handle" | "keyword";

// ── Raw ingestion ─────────────────────────────────────────────────────────────

export interface RawXPost {
  id: string;
  text: string;
  authorId: string;
  authorHandle: string;
  authorFollowers: number;
  likes: number;
  retweets: number;
  createdAt: string;
  source: "velocity-trigger" | "alpha-caller" | "native-trend";
  term?: string;
  callerWeight?: number;
}

export interface RawTikTokVideo {
  id: string;
  author: string;
  views: number;
  likes: number;
  shares: number;
  hashtags: string[];
  caption: string;
  transcript: string | null;
  createdAt: string;
}

// ── Signals ───────────────────────────────────────────────────────────────────

export interface ExtractedSignal {
  source: DataSource;
  sourceId: string;
  author: string;
  authorWeight: number;
  text: string;
  tickers: string[];
  contracts: Array<{ address: string; chain: Chain }>;
  collections: string[];
  signalType: SignalType;
  timestamp: string;
  extractedBy: "regex" | "llm";
  mintDetected: boolean;
  pfpDetected: boolean;
  sweepDetected: boolean;
}

// ── Enriched signals ──────────────────────────────────────────────────────────

export interface EnrichedMemecoinSignal extends ExtractedSignal {
  tokenData: TokenData;
  velocityScore: number;
  liquidityHealth: number;
  buySellRatio5m: number;
}

export interface EnrichedNFTSignal extends ExtractedSignal {
  collectionData: CollectionData;
  floorVelocity1h: number;
  volumeVelocity1h: number;
  listingPressure: number;
  uniqueBuyers1h: number;
}

export interface PFPChangeSignal {
  handle: string;
  weight: number;
  oldCollection: string | null;
  newCollection: string | null;
  collectionConfidence: number;
  ts: string;
}

// ── External API types ────────────────────────────────────────────────────────

export interface TokenData {
  address: string;
  chain: Chain;
  name: string;
  symbol: string;
  liquidityUsd: number;
  marketCap: number;
  fdv: number;
  priceUsd: number;
  priceChange24h: number;
  priceChange1h: number;
  priceChange5m: number;
  volume24h: number;
  volume1h: number;
  volume5m: number;
  txCount24h: number;
  txCount1h: number;
  txCount5m: number;
  ageMs: number;
  holders: number | null;
  pairAddress: string;
  pairCreatedAt: string;
}

export interface CollectionData {
  slug: string;
  name: string;
  contractAddress: string;
  chain: Chain;
  floorPriceEth: number;
  volume24hEth: number;
  volume1hEth: number;
  sales24h: number;
  ownerCount: number;
  listingCount: number;
  imageUrl: string | null;
  createdAt: string;
}

export interface Sale {
  txHash: string;
  tokenId: string;
  priceEth: number;
  buyer: string;
  seller: string;
  timestamp: string;
  marketplace: string;
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export interface FinalAlert {
  id: string;
  emittedAt: string;
  alertType: AlertType;
  tier: AlertTier;
  identifier: string;
  chain: Chain | null;
  score: number;
  velocityScore: number;
  authorityScore: number;
  onchainScore: number;
  confluenceCount: number;
  confluenceSources: string[];
  enrichmentData: TokenData | CollectionData | null;
  sourceTweets: string[];
  pfpChanges?: PFPChangeSignal[];
}

// ── Velocity ──────────────────────────────────────────────────────────────────

export interface VelocitySpike {
  term: string;
  current: number;
  baseline: number;
  ratio: number;
  ts: string;
}

// ── Alpha callers ─────────────────────────────────────────────────────────────

export interface AlphaCaller {
  handle: string;
  userId: string;
  weight: number;
  tier: 1 | 2 | 3;
  category: "memecoin" | "nft" | "both";
  notes?: string;
}

export interface PFPWatchHandle {
  handle: string;
  weight: number;
  category: "blue-chip" | "memecoin" | "data" | "both";
  notes?: string;
}
