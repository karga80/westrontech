/**
 * @jest-environment jsdom
 */
/**
 * Tests for trackedNftStore in-memory cache.
 *
 * Verifies:
 * - isTracked returns false when store is empty
 * - After addTrackedNft, isTracked returns true WITHOUT re-parsing localStorage (call count)
 * - After removeTrackedNft, isTracked returns false
 * - loadTrackedNfts still reads from localStorage (source of truth)
 * - Cache is invalidated after add/remove
 */

import {
  isTracked,
  addTrackedNft,
  removeTrackedNft,
  loadTrackedNfts,
  trackedNftId,
  _resetCacheForTesting,
} from '../trackedNftStore';

// ── localStorage mock ─────────────────────────────────────────────────────────

const store: Record<string, string> = {};
const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(k => store[k] ?? null);
const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { store[k] = v; });

// Helpers
function clearStore() {
  Object.keys(store).forEach(k => delete store[k]);
  getItemSpy.mockClear();
  setItemSpy.mockClear();
}

const CONTRACT = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d';
const TOKEN_ID = '1234';

const BASE_NFT = {
  contract: CONTRACT,
  tokenId: TOKEN_ID,
  name: 'Bored Ape #1234',
  collectionSlug: 'boredapeyachtclub',
  collectionName: 'Bored Ape Yacht Club',
  imageUrl: null,
  rarity: null,
  lastSaleEth: null,
  floorEth: null,
  traitFloorEth: null,
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearStore();
  // Reset the module-level in-memory cache so tests start with a clean slate.
  // (jest.resetModules() would re-evaluate the module but the spy bindings above
  // would break — use the exported reset helper instead.)
  _resetCacheForTesting();
});

describe('isTracked', () => {
  it('returns false when store is empty', () => {
    expect(isTracked(CONTRACT, TOKEN_ID)).toBe(false);
  });

  it('returns false for an unknown token when other tokens are present', () => {
    addTrackedNft(BASE_NFT);
    expect(isTracked(CONTRACT, '9999')).toBe(false);
  });
});

describe('addTrackedNft + isTracked cache behaviour', () => {
  it('returns true after addTrackedNft without re-parsing localStorage', () => {
    addTrackedNft(BASE_NFT);

    // Clear the spy call count so we can observe isTracked in isolation.
    getItemSpy.mockClear();

    const result = isTracked(CONTRACT, TOKEN_ID);

    expect(result).toBe(true);
    // With the in-memory cache, isTracked must NOT call localStorage.getItem.
    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('is case-insensitive for the contract address', () => {
    addTrackedNft(BASE_NFT);
    expect(isTracked(CONTRACT.toUpperCase(), TOKEN_ID)).toBe(true);
  });
});

describe('removeTrackedNft + isTracked cache behaviour', () => {
  it('returns false after removeTrackedNft without re-parsing localStorage', () => {
    addTrackedNft(BASE_NFT);

    removeTrackedNft(CONTRACT, TOKEN_ID);

    // Clear the spy call count so we can observe isTracked in isolation.
    getItemSpy.mockClear();

    const result = isTracked(CONTRACT, TOKEN_ID);

    expect(result).toBe(false);
    // With the in-memory cache, isTracked must NOT call localStorage.getItem.
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});

describe('loadTrackedNfts', () => {
  it('reads from localStorage (source of truth)', () => {
    addTrackedNft(BASE_NFT);
    getItemSpy.mockClear();

    const list = loadTrackedNfts();

    // loadTrackedNfts must always read localStorage regardless of cache state.
    expect(getItemSpy).toHaveBeenCalled();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(trackedNftId(CONTRACT, TOKEN_ID));
  });

  it('returns empty array when localStorage is empty', () => {
    expect(loadTrackedNfts()).toEqual([]);
  });
});

describe('cache invalidation', () => {
  it('reflects add then remove sequence correctly', () => {
    expect(isTracked(CONTRACT, TOKEN_ID)).toBe(false);

    addTrackedNft(BASE_NFT);
    expect(isTracked(CONTRACT, TOKEN_ID)).toBe(true);

    removeTrackedNft(CONTRACT, TOKEN_ID);
    expect(isTracked(CONTRACT, TOKEN_ID)).toBe(false);
  });

  it('reflects multiple adds without hitting localStorage on reads', () => {
    const TOKEN_ID_2 = '5678';
    addTrackedNft(BASE_NFT);
    addTrackedNft({ ...BASE_NFT, tokenId: TOKEN_ID_2, name: 'Bored Ape #5678' });

    getItemSpy.mockClear();

    expect(isTracked(CONTRACT, TOKEN_ID)).toBe(true);
    expect(isTracked(CONTRACT, TOKEN_ID_2)).toBe(true);
    expect(getItemSpy).not.toHaveBeenCalled();
  });
});
