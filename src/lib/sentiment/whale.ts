// ─── Whale Tracker — Alchemy NFT API ─────────────────────────────────────────
// ETH NFT holder distribution for whale concentration analysis
// API key: localStorage 'wr-apikey-alchemy'

import { WhaleData, WhaleHolder } from './types';

const ALCHEMY_BASE = 'https://eth-mainnet.g.alchemy.com/nft/v3';

function loadApiKey(name: 'opensea' | 'alchemy'): string {
  return localStorage.getItem(`wr-apikey-${name}`) ?? '';
}

interface AlchemyOwner {
  ownerAddress: string;
  tokenBalances: Array<{ tokenId: string; balance: string }>;
}

interface AlchemyOwnersResponse {
  owners: AlchemyOwner[];
}

interface AlchemyContractMetadata {
  totalSupply?: string;
}

interface AlchemyContractMetadataResponse {
  totalSupply?: string;
  contractMetadata?: AlchemyContractMetadata;
}

async function fetchTotalSupply(apiKey: string, contractAddress: string): Promise<number> {
  const url =
    `${ALCHEMY_BASE}/${encodeURIComponent(apiKey)}/getContractMetadata` +
    `?contractAddress=${encodeURIComponent(contractAddress)}`;

  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`Alchemy getContractMetadata failed: ${resp.status}`);
  }
  const body = await resp.json() as unknown;
  const data = body as AlchemyContractMetadataResponse;
  const raw = data.totalSupply ?? data.contractMetadata?.totalSupply;
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function fetchWhaleData(contractAddress: string): Promise<WhaleData> {
  const apiKey = loadApiKey('alchemy');
  if (!apiKey) {
    throw new Error('Alchemy API key not configured (wr-apikey-alchemy)');
  }

  const [ownersResp, totalSupply] = await Promise.all([
    fetch(
      `${ALCHEMY_BASE}/${encodeURIComponent(apiKey)}/getOwnersForContract` +
        `?contractAddress=${encodeURIComponent(contractAddress)}&withTokenBalances=true`,
      { headers: { Accept: 'application/json' } },
    ),
    fetchTotalSupply(apiKey, contractAddress),
  ]);

  if (!ownersResp.ok) {
    throw new Error(`Alchemy getOwnersForContract failed: ${ownersResp.status}`);
  }

  const ownersBody = await ownersResp.json() as unknown;
  const { owners } = ownersBody as AlchemyOwnersResponse;

  const withCounts = owners.map(owner => ({
    address: owner.ownerAddress,
    tokenCount: owner.tokenBalances.reduce(
      (sum, t) => sum + parseInt(t.balance, 10),
      0,
    ),
  }));

  withCounts.sort((a, b) => b.tokenCount - a.tokenCount);

  const top10 = withCounts.slice(0, 10);
  const effectiveSupply = totalSupply > 0 ? totalSupply : (withCounts[0]?.tokenCount ?? 1);

  const topHolders: WhaleHolder[] = top10.map(owner => {
    const supplyPercent = (owner.tokenCount / effectiveSupply) * 100;
    return {
      address: owner.address,
      tokenCount: owner.tokenCount,
      supplyPercent,
      etherscanUrl: `https://etherscan.io/address/${owner.address}`,
    };
  });

  const whaleConcentration = topHolders.reduce((sum, h) => sum + h.supplyPercent, 0);

  return {
    topHolders,
    whaleConcentration,
    whaleMovement7d: { entering: 0, exiting: 0 },
    fetchedAt: new Date().toISOString(),
  };
}
