import { invoke } from '@tauri-apps/api/core';

export interface NftItemTrait {
  trait_type: string;
  value: string;
  display_type?: string | null;
}

export interface OpenSeaNftItem {
  identifier: string;
  name?: string | null;
  image_url?: string | null;
  display_image_url?: string | null;
  opensea_url?: string | null;
  traits?: NftItemTrait[];
  rarity?: { rank: number } | null;
  price_eth?: number | null;
  last_sale_eth?: number | null;
  order_hash?: string | null;
}

export interface NftPage {
  items: OpenSeaNftItem[];
  next: string | null;
}

export type ItemStatus = 'all' | 'listed' | 'unlisted' | 'owned';
export type SortOption =
  | 'Price low to high'
  | 'Price high to low'
  | 'Most rare'
  | 'Least rare'
  | 'Recently listed'
  | 'Highest last sale'
  | 'Lowest last sale'
  | 'Top offer'
  | 'Recently transferred'
  | 'Recently created'
  | 'Oldest'
  | 'Recently sold';

export const SORT_OPTIONS: SortOption[] = [
  'Price low to high',
  'Price high to low',
  'Most rare',
  'Least rare',
  'Recently listed',
  'Highest last sale',
  'Lowest last sale',
  'Top offer',
  'Recently transferred',
  'Recently created',
  'Oldest',
  'Recently sold',
];

export interface FetchNftsParams {
  status: ItemStatus;
  walletAddress?: string;
  cursor?: string | null;
  sort?: SortOption;
  limit?: number;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Rust NftAsset → OpenSeaNftItem */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rustNftToItem(nft: any): OpenSeaNftItem {
  return {
    identifier: nft.identifier,
    name: nft.name ?? null,
    image_url: nft.image_url ?? null,
    display_image_url: nft.display_image_url ?? null,
    opensea_url: nft.opensea_url ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    traits: (nft.traits ?? []).map((t: any) => ({ trait_type: t.trait_type, value: t.value })),
    rarity: nft.rarity_rank != null ? { rank: nft.rarity_rank } : null,
    price_eth: nft.price_eth ?? null,
    last_sale_eth: nft.last_sale_eth ?? null,
    order_hash: nft.order_hash ?? null,
  };
}

class OpenSeaApiClient {
  async fetchNFTsByCollection(slug: string, params: FetchNftsParams): Promise<NftPage> {
    if (!isTauri()) {
      throw new Error('OpenSea lookup requires the desktop app');
    }

    const { status, walletAddress, cursor, sort = 'Price ↑', limit = 48 } = params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await invoke<{ items: any[]; next: string | null }>(
      'fetch_nfts_by_collection',
      {
        collectionSlug: slug,
        status,
        walletAddress: walletAddress ?? null,
        cursor: cursor ?? null,
        sort,
        limit,
      },
    );

    return {
      items: result.items.map(rustNftToItem),
      next: result.next ?? null,
    };
  }
}

export const openSeaApi = new OpenSeaApiClient();
