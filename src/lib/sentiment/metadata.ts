// ─── Metadata resolver — contract name/symbol lookup ─────────────────────────
// resolveTokenMeta: Helius DAS getAsset (Solana)
// resolveNFTMeta:   Alchemy getContractMetadata (ETH)

const HELIUS_BASE = 'https://mainnet.helius-rpc.com/';
const ALCHEMY_BASE = 'https://eth-mainnet.g.alchemy.com/nft/v3';

function loadApiKey(name: string): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(`wr-apikey-${name}`)?.trim() ?? '';
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface MetaResult {
  name: string;
  symbol: string;
  imageUrl: string;
}

export async function resolveTokenMeta(contractAddress: string): Promise<MetaResult> {
  const fallback: MetaResult = { name: shortenAddress(contractAddress), symbol: '?', imageUrl: '' };

  try {
    const key = loadApiKey('helius');
    if (!key) return fallback;

    const response = await fetch(`${HELIUS_BASE}?api-key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'meta',
        method: 'getAsset',
        params: { id: contractAddress },
      }),
    });

    if (!response.ok) return fallback;

    const body = await response.json() as unknown;
    if (typeof body !== 'object' || body === null) return fallback;

    const b = body as Record<string, unknown>;
    const result = b['result'] as Record<string, unknown> | undefined;
    if (!result) return fallback;

    const content = result['content'] as Record<string, unknown> | undefined;
    if (!content) return fallback;

    const metadata = content['metadata'] as Record<string, unknown> | undefined;
    if (!metadata) return fallback;

    const name = typeof metadata['name'] === 'string' && metadata['name'] ? metadata['name'] : shortenAddress(contractAddress);
    const symbol = typeof metadata['symbol'] === 'string' && metadata['symbol'] ? metadata['symbol'] : '?';

    const links = content['links'] as Record<string, unknown> | undefined;
    const files = content['files'] as Array<Record<string, unknown>> | undefined;
    const imageUrl =
      (typeof links?.['image'] === 'string' && links['image'])
        ? links['image']
        : (typeof files?.[0]?.['uri'] === 'string' && files[0]['uri'])
          ? files[0]['uri']
          : '';

    return { name, symbol, imageUrl };
  } catch {
    return fallback;
  }
}

interface AlchemyContractMetadataBody {
  contractMetadata?: {
    name?: string;
    symbol?: string;
    openSea?: {
      imageUrl?: string;
      bannerImageUrl?: string;
    };
  };
}

export async function resolveNFTMeta(contractAddress: string): Promise<MetaResult> {
  const fallback: MetaResult = { name: shortenAddress(contractAddress), symbol: '?', imageUrl: '' };

  try {
    const key = loadApiKey('alchemy');
    if (!key) return fallback;

    const url =
      `${ALCHEMY_BASE}/${encodeURIComponent(key)}/getContractMetadata` +
      `?contractAddress=${encodeURIComponent(contractAddress)}`;

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) return fallback;

    const body = await response.json() as AlchemyContractMetadataBody;
    const cm = body?.contractMetadata;

    const name = cm?.name && cm.name.trim() ? cm.name.trim() : shortenAddress(contractAddress);
    const symbol = cm?.symbol && cm.symbol.trim() ? cm.symbol.trim() : '?';
    const imageUrl = cm?.openSea?.imageUrl ?? cm?.openSea?.bannerImageUrl ?? '';

    return { name, symbol, imageUrl };
  } catch {
    return fallback;
  }
}
