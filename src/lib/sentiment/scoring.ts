import type {
  TwitterData,
  OnChainData,
  PriceData,
  OpenSeaData,
  WhaleData,
  ScoreSnapshot,
  TokenFetchResult,
  NFTFetchResult,
} from './types';
import { getScoreLevel } from './types';

// ─── Token Scoring (100 puan) ─────────────────────────────────────────────────
//
//  KOL mention       35 puan  — manuel listeden: 20p + 20K+ otomatik: 15p max
//  Twitter velocity  25 puan  — velocity >2x = tam puan, lineer scale
//  Buy/Sell oranı    25 puan  — >3x = tam puan, <1x = 0
//  Holder artışı     15 puan  — >%5/24sa = tam puan

function scoreTokenTwitter(twitter: TwitterData): { kol: number; velocity: number } {
  const { kolMentions, mentionVelocity } = twitter;

  // KOL: manuel listeden biri varsa 20 puan, otomatik (20K+) varsa 15 puan
  const hasManual = kolMentions.some(m => m.isManualList);
  const hasAuto   = kolMentions.some(m => !m.isManualList && m.followerCount >= 20_000);
  const kolScore  = Math.min(35, (hasManual ? 20 : 0) + (hasAuto ? 15 : 0));

  // Velocity: 0x–2x arası lineer (0–25), 2x ve üstü = 25
  const velocityScore = Math.min(25, Math.max(0, (mentionVelocity / 2) * 25));

  return { kol: kolScore, velocity: Math.round(velocityScore) };
}

function scoreTokenOnChain(onchain: OnChainData): { buySell: number; holder: number } {
  // Buy/Sell: >3x = 25, <1x = 0, lineer arada
  const ratio     = onchain.buySellRatio;
  const buySell   = ratio >= 3 ? 25 : ratio < 1 ? 0 : Math.round(((ratio - 1) / 2) * 25);

  // Holder: >%5 değişim = 15 tam puan, lineer
  const pct       = Math.abs(onchain.holderChangePct24h);
  const holder    = pct >= 5 ? 15 : Math.round((pct / 5) * 15);

  return { buySell, holder };
}

export function calculateTokenScore(result: TokenFetchResult): ScoreSnapshot {
  const now = new Date().toISOString();

  const twitter = result.twitter;
  const onchain = result.onchain;

  let kolScore        = 0;
  let velocityScore   = 0;
  let buySellScore    = 0;
  let holderScore     = 0;

  if (twitter) {
    const t = scoreTokenTwitter(twitter);
    kolScore      = t.kol;
    velocityScore = t.velocity;
  }

  if (onchain) {
    const o = scoreTokenOnChain(onchain);
    buySellScore = o.buySell;
    holderScore  = o.holder;
  }

  const twitterScore = kolScore + velocityScore;
  const onchainScore = buySellScore + holderScore;
  const totalScore   = Math.min(100, twitterScore + onchainScore);

  return {
    score:       totalScore,
    twitterScore,
    onchainScore,
    openSeaScore: 0,
    whaleScore:   0,
    kolScore,
    level:        getScoreLevel(totalScore),
    computedAt:   now,
  };
}

// ─── NFT Scoring (100 puan) ───────────────────────────────────────────────────
//
//  OpenSea volume hareketi  40 puan  — volume velocity + floor trend
//  Twitter/Discord aktivite 25 puan  — mention hızı + KOL
//  Floor price trendi       20 puan  — 24sa değişim yönü ve büyüklüğü
//  Whale konsantrasyonu     15 puan  — düşük konsantrasyon = iyi skor

function scoreOpenSea(data: OpenSeaData): { volume: number; floor: number } {
  // Volume: volumeChange24h > %50 = 40 tam, < -%50 = 0, lineer
  const volChange = data.volumeChange24h;
  const volume = volChange >= 50
    ? 40
    : volChange <= -50
    ? 0
    : Math.round(((volChange + 50) / 100) * 40);

  // Floor: >%10 değişim = 20, < -%10 = 0, lineer
  const floorChange = data.floorPriceChange24h;
  const floor = floorChange >= 10
    ? 20
    : floorChange <= -10
    ? 0
    : Math.round(((floorChange + 10) / 20) * 20);

  return { volume, floor };
}

function scoreWhale(data: WhaleData): number {
  // Düşük konsantrasyon = iyi skor
  // <10% = 15 tam, >50% = 0, lineer
  const conc = data.whaleConcentration;
  if (conc <= 10) return 15;
  if (conc >= 50) return 0;
  return Math.round(((50 - conc) / 40) * 15);
}

function scoreNFTTwitter(twitter: TwitterData): number {
  const { kolMentions, mentionVelocity } = twitter;
  const hasManual = kolMentions.some(m => m.isManualList);
  const hasAuto   = kolMentions.some(m => !m.isManualList && m.followerCount >= 20_000);
  const kolPart   = (hasManual ? 13 : 0) + (hasAuto ? 7 : 0);   // 20 max
  const velPart   = Math.min(5, Math.max(0, (mentionVelocity / 2) * 5)); // 5 max
  return Math.min(25, kolPart + Math.round(velPart));
}

export function calculateNFTScore(result: NFTFetchResult): ScoreSnapshot {
  const now = new Date().toISOString();

  let openSeaVolumeScore = 0;
  let floorScore         = 0;
  let twitterScore       = 0;
  let whaleScore         = 0;

  if (result.openSea) {
    const s = scoreOpenSea(result.openSea);
    openSeaVolumeScore = s.volume;
    floorScore         = s.floor;
  }

  if (result.twitter) {
    twitterScore = scoreNFTTwitter(result.twitter);
  }

  if (result.whale) {
    whaleScore = scoreWhale(result.whale);
  }

  const openSeaScore = openSeaVolumeScore + floorScore;
  const totalScore   = Math.min(100, openSeaScore + twitterScore + whaleScore);

  return {
    score:       totalScore,
    twitterScore,
    onchainScore: 0,
    openSeaScore,
    whaleScore,
    kolScore:    0,
    level:       getScoreLevel(totalScore),
    computedAt:  now,
  };
}

// ─── Alert thresholds ─────────────────────────────────────────────────────────

export function checkScoreAlert(prev: ScoreSnapshot | undefined, next: ScoreSnapshot): boolean {
  if (!prev) return false;
  return Math.abs(next.score - prev.score) >= 15;
}

export function checkFloorAlert(prev: OpenSeaData | undefined, next: OpenSeaData): boolean {
  if (!prev) return false;
  const pct = Math.abs(((next.floorPrice - prev.floorPrice) / prev.floorPrice) * 100);
  return pct >= 10;
}
