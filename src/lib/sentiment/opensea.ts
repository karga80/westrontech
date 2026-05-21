// ─── OpenSea API client — NFT sentiment data ─────────────────────────────────
// API key: localStorage 'wr-apikey-opensea'
// Base URL: https://api.opensea.io/api/v2

import { OpenSeaData } from './types';

const BASE_URL = 'https://api.opensea.io/api/v2';

function loadApiKey(name: 'opensea' | 'alchemy'): string {
  return localStorage.getItem(`wr-apikey-${name}`) ?? '';
}

interface CollectionResult {
  collection: string;
}

interface CollectionsResponse {
  results: CollectionResult[];
}

interface CollectionStats {
  total: {
    floor_price?: number;
    volume?: number;
    num_sales?: number;
  };
  intervals?: Array<{
    interval: string;
    volume?: number;
    volume_change?: number;
    sales?: number;
    floor_price?: number;
    floor_price_percentage_change?: number;
  }>;
}

function extractOneDayInterval(stats: CollectionStats) {
  return stats.intervals?.find(i => i.interval === 'one_day');
}

export async function fetchOpenSeaData(
  contractAddress: string,
  openSeaUrl: string,
): Promise<OpenSeaData> {
  const apiKey = loadApiKey('opensea');
  if (!apiKey) {
    throw new Error('OpenSea API key not configured (wr-apikey-opensea)');
  }

  const headers = { 'X-API-KEY': apiKey, Accept: 'application/json' };

  // Step 1: resolve collection slug from contract address
  const collectionsResp = await fetch(
    `${BASE_URL}/collections?asset_contract_address=${encodeURIComponent(contractAddress)}&limit=1`,
    { headers },
  );
  if (!collectionsResp.ok) {
    throw new Error(`OpenSea collections lookup failed: ${collectionsResp.status}`);
  }
  const collectionsBody = await collectionsResp.json() as unknown;
  const { results } = collectionsBody as CollectionsResponse;
  const slug = results?.[0]?.collection;
  if (!slug) {
    throw new Error(`No OpenSea collection found for contract ${contractAddress}`);
  }

  // Step 2: fetch collection stats
  const statsResp = await fetch(`${BASE_URL}/collections/${encodeURIComponent(slug)}/stats`, {
    headers,
  });
  if (!statsResp.ok) {
    throw new Error(`OpenSea stats fetch failed: ${statsResp.status}`);
  }
  const statsBody = await statsResp.json() as unknown;
  const stats = statsBody as CollectionStats;

  const oneDayInterval = extractOneDayInterval(stats);

  const floorPrice = stats.total?.floor_price ?? 0;
  const volume24h = oneDayInterval?.volume ?? 0;
  const volumeChange24h = oneDayInterval?.volume_change ?? 0;
  const salesCount24h = oneDayInterval?.sales ?? 0;
  const floorPriceChange24h = oneDayInterval?.floor_price_percentage_change ?? 0;
  const salesVelocity = salesCount24h / 24;

  const resolvedUrl =
    openSeaUrl || `https://opensea.io/collection/${slug}`;

  return {
    floorPrice,
    floorPriceChange24h,
    volume24h,
    volumeChange24h,
    salesCount24h,
    salesVelocity,
    openSeaUrl: resolvedUrl,
    fetchedAt: new Date().toISOString(),
  };
}
