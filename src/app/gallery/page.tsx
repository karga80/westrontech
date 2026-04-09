'use client';

import { useState, useEffect, useCallback } from 'react';
import { getNftsForOwner, saveAlchemyKey, loadAlchemyKey, type OwnedNft, type NftsForOwnerResponse } from '@/lib/tauri';
import { loadWallets } from '@/lib/walletStore';
import { MOCK_NFTS_RESPONSE } from '@/lib/mockData';

type ViewMode = 'grid' | 'list';
type SortKey = 'name' | 'collection' | 'floor_price';
type BulkAction = 'list' | 'cancel' | 'sweep';

// ─── Toast ──────────────────────────────────────────────────────────────────

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 bg-[#1a1a1a] border border-[#1a1a1a] text-white text-sm px-5 py-3 rounded-[6px] shadow-xl">
      {message}
    </div>
  );
}

// ─── ActionModal ─────────────────────────────────────────────────────────────

interface ActionModalProps {
  action: BulkAction;
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

const ACTION_LABELS: Record<BulkAction, string> = {
  list: 'List',
  cancel: 'Cancel Listing',
  sweep: 'Sweep',
};

function ActionModal({ action, count, onConfirm, onCancel }: ActionModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-[8px] p-6 max-w-md w-full mx-4">
        <h2 className="text-white font-semibold text-lg mb-2">{ACTION_LABELS[action]}</h2>
        <p className="text-[#a1a1aa] text-sm mb-6">
          You are about to <span className="text-white font-medium">{ACTION_LABELS[action].toLowerCase()}</span>{' '}
          <span className="text-[#34d399] font-semibold">{count} NFT{count !== 1 ? 's' : ''}</span>.
          Transaction signing coming soon.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#1a1a1a] text-[#a1a1aa] hover:bg-[#222222] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#beff00] text-black hover:bg-[#beff00] transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── BulkActionBar ───────────────────────────────────────────────────────────

interface BulkActionBarProps {
  count: number;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}

function BulkActionBar({ count, onAction, onClear }: BulkActionBarProps) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-black border-t border-[#1a1a1a] px-8 py-4 flex items-center gap-4">
      <span className="text-[#a1a1aa] text-sm font-medium mr-2">
        {count} NFT{count !== 1 ? 's' : ''} selected
      </span>
      <button
        onClick={() => onAction('list')}
        className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#beff00] text-black hover:bg-[#beff00] transition-colors"
      >
        List
      </button>
      <button
        onClick={() => onAction('cancel')}
        className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#fbbf24] text-black hover:opacity-90 transition-colors"
      >
        Cancel Listing
      </button>
      <button
        onClick={() => onAction('sweep')}
        className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#60a5fa] text-white hover:opacity-90 transition-colors"
      >
        Sweep
      </button>
      <button
        onClick={onClear}
        className="px-4 py-1.5 rounded-[6px] text-sm font-medium bg-[#1a1a1a] text-[#a1a1aa] hover:bg-[#222222] transition-colors ml-auto"
      >
        Clear Selection
      </button>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function Gallery() {
  const [address, setAddress] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [nfts, setNfts] = useState<OwnedNft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('collection');
  const [filterCollection, setFilterCollection] = useState('');
  const [isTauri, setIsTauri] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal state
  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);

  // Toast state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    setIsTauri(inTauri);

    if (!inTauri) {
      // Browser mode: load first wallet address and auto-fetch mock data
      const wallets = loadWallets();
      const firstAddr = wallets[0]?.address ?? '';
      setAddress(firstAddr);
      setNfts(MOCK_NFTS_RESPONSE.owned_nfts);
      setTotalCount(MOCK_NFTS_RESPONSE.total_count);
      return;
    }

    // Tauri mode: load API key + first wallet address, then auto-fetch
    (async () => {
      const key = await loadAlchemyKey().catch(() => '');
      if (key) setApiKey(key);
      const wallets = loadWallets();
      const firstAddr = wallets[0]?.address ?? localStorage.getItem('westron_address') ?? '';
      if (firstAddr) setAddress(firstAddr);

      if (key && firstAddr && /^0x[0-9a-fA-F]{40}$/.test(firstAddr.trim())) {
        setLoading(true);
        try {
          const result: NftsForOwnerResponse = await getNftsForOwner(firstAddr, key);
          setNfts(result.owned_nfts);
          setTotalCount(result.total_count);
        } catch {}
        setLoading(false);
      }
    })();
  }, []);

  const isValidEthAddress = (addr: string) => /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

  const fetchNfts = async () => {
    if (!isTauri) {
      setNfts(MOCK_NFTS_RESPONSE.owned_nfts);
      setTotalCount(MOCK_NFTS_RESPONSE.total_count);
      setSelectedIds(new Set());
      return;
    }
    if (!isValidEthAddress(address)) { setError('Geçersiz Ethereum adresi.'); return; }
    if (!apiKey.trim()) { setError('Alchemy API key gerekli.'); return; }

    setLoading(true);
    setError(null);
    setSelectedIds(new Set());

    try {
      localStorage.setItem('westron_address', address);
      await saveAlchemyKey(apiKey);
      const result: NftsForOwnerResponse = await getNftsForOwner(address, apiKey);
      setNfts(result.owned_nfts);
      setTotalCount(result.total_count);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const displayNfts = nfts
    .filter(nft => {
      if (!filterCollection) return true;
      const colName = (nft.contract.opensea_collection_name || nft.contract.name || '').toLowerCase();
      return colName.includes(filterCollection.toLowerCase());
    })
    .sort((a, b) => {
      if (sortKey === 'floor_price') {
        return (b.contract.opensea_floor_price ?? 0) - (a.contract.opensea_floor_price ?? 0);
      }
      if (sortKey === 'collection') {
        const aName = a.contract.opensea_collection_name || a.contract.name || '';
        const bName = b.contract.opensea_collection_name || b.contract.name || '';
        return aName.localeCompare(bName);
      }
      return (a.name || '').localeCompare(b.name || '');
    });

  const collections = Array.from(new Set(
    nfts.map(n => n.contract.opensea_collection_name || n.contract.name || n.contract.address)
  )).sort();

  // Selection helpers
  const getNftKey = (nft: OwnedNft) => `${nft.contract.address}-${nft.token_id}`;

  const handleSelect = useCallback((key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const handleSelectAll = () => {
    if (selectedIds.size === displayNfts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayNfts.map(getNftKey)));
    }
  };

  const handleClearSelection = () => setSelectedIds(new Set());

  // Bulk action
  const handleBulkAction = (action: BulkAction, ids: Set<string>) => {
setToastMessage('Transaction signing coming soon');
    setPendingAction(null);
    handleClearSelection();
  };

  const dismissToast = useCallback(() => setToastMessage(null), []);

  const allSelected = displayNfts.length > 0 && selectedIds.size === displayNfts.length;

  return (
    <main className="min-h-full bg-[#0a0a0a] text-white">
      <div className={`px-12 py-8 ${selectedIds.size > 0 ? 'pb-24' : ''}`}>
        {/* Wallet input */}
        <div className="mb-6 flex gap-3">
          <input
            type="text"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="0x... wallet address"
            className={`flex-1 bg-[#111111] border rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e6e6e] focus:outline-none transition-colors ${
              address.length >= 3 && !isValidEthAddress(address)
                ? 'border-[#f87171] focus:border-[#f87171]'
                : 'border-[#1a1a1a] focus:border-[#beff00]'
            }`}
          />
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Alchemy API key"
            className="w-48 bg-[#111111] border border-[#1a1a1a] rounded-[6px] px-4 py-2 text-sm text-white placeholder-[#6e6e6e] focus:outline-none focus:border-[#beff00]"
          />
          <button
            onClick={fetchNfts}
            disabled={loading}
            className="bg-[#beff00] text-black font-semibold px-6 py-2 rounded-[6px] text-sm hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : 'Load NFTs'}
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-[#f8717111] border border-[#f87171]/30 rounded-[6px] px-4 py-3 text-[#f87171] text-sm">
            {error}
          </div>
        )}

        {/* Stats + controls */}
        {nfts.length > 0 && (
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-[#a1a1aa] text-sm">
                <span className="text-white font-semibold">{displayNfts.length}</span>
                {filterCollection ? ` / ${totalCount}` : ` NFTs`}
              </span>
              <span className="text-[#404040] text-sm">{collections.length} collections</span>
              {/* Select All */}
              <button
                onClick={handleSelectAll}
                className="text-xs text-[#a1a1aa] hover:text-white transition-colors underline underline-offset-2"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="flex items-center gap-3">
              {/* Collection filter */}
              <select
                value={filterCollection}
                onChange={e => setFilterCollection(e.target.value)}
                className="rounded-[6px] px-3 py-1.5 text-sm focus:outline-none focus:border-[#beff00]"
                style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: 'var(--wr-text)' }}
              >
                <option value="">All collections</option>
                {collections.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {/* Sort */}
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="rounded-[6px] px-3 py-1.5 text-sm focus:outline-none focus:border-[#beff00]"
                style={{ backgroundColor: 'var(--wr-surface)', border: '1px solid var(--wr-border)', color: 'var(--wr-text)' }}
              >
                <option value="collection">Sort: Collection</option>
                <option value="floor_price">Sort: Floor Price ↓</option>
                <option value="name">Sort: Name</option>
              </select>
              {/* View toggle */}
              <div className="flex border border-[#1a1a1a] rounded-[6px] overflow-hidden">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-3 py-1.5 text-sm transition-colors ${viewMode === 'grid' ? 'bg-[#1a1a1a] text-white' : 'text-[#6e6e6e] hover:text-white'}`}
                >
                  Grid
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm transition-colors ${viewMode === 'list' ? 'bg-[#1a1a1a] text-white' : 'text-[#6e6e6e] hover:text-white'}`}
                >
                  List
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Grid view */}
        {viewMode === 'grid' && displayNfts.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {displayNfts.map((nft, i) => {
              const key = getNftKey(nft);
              return (
                <NftCard
                  key={`${key}-${i}`}
                  nft={nft}
                  selected={selectedIds.has(key)}
                  onSelect={handleSelect}
                />
              );
            })}
          </div>
        )}

        {/* List view */}
        {viewMode === 'list' && displayNfts.length > 0 && (
          <div className="bg-[#111111] rounded-[8px] border border-[#1a1a1a] overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 text-xs text-[#6e6e6e] uppercase tracking-wider border-b border-[#1a1a1a]">
              <div className="col-span-1"></div>
              <div className="col-span-1"></div>
              <div className="col-span-3">Name</div>
              <div className="col-span-3">Collection</div>
              <div className="col-span-2">Token ID</div>
              <div className="col-span-2 text-right">Floor</div>
            </div>
            {displayNfts.map((nft, i) => {
              const key = getNftKey(nft);
              return (
                <NftListRow
                  key={`${key}-${i}`}
                  nft={nft}
                  selected={selectedIds.has(key)}
                  onSelect={handleSelect}
                />
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="text-center py-24 text-[#404040]">
            <p className="text-sm">Loading NFTs...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && nfts.length === 0 && (
          <div className="text-center py-24 text-[#404040]">
            <p className="text-4xl mb-4">🖼</p>
            <p className="text-sm">Enter a wallet address to load your NFT gallery.</p>
          </div>
        )}
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          onAction={action => setPendingAction(action)}
          onClear={handleClearSelection}
        />
      )}

      {/* Action Modal */}
      {pendingAction && (
        <ActionModal
          action={pendingAction}
          count={selectedIds.size}
          onConfirm={() => handleBulkAction(pendingAction, selectedIds)}
          onCancel={() => setPendingAction(null)}
        />
      )}

      {/* Toast */}
      {toastMessage && (
        <Toast message={toastMessage} onDismiss={dismissToast} />
      )}
    </main>
  );
}

// ─── NftCard ─────────────────────────────────────────────────────────────────

interface NftCardProps {
  nft: OwnedNft;
  selected: boolean;
  onSelect: (key: string) => void;
}

function NftCard({ nft, selected, onSelect }: NftCardProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = nft.image?.thumbnail_url || nft.image?.cached_url || nft.image?.original_url;
  const collectionName = nft.contract.opensea_collection_name || nft.contract.name || 'Unknown';
  const floorPrice = nft.contract.opensea_floor_price;
  const nftKey = `${nft.contract.address}-${nft.token_id}`;

  return (
    <div
      className={`bg-[#111111] rounded-[8px] border overflow-hidden hover:border-[#2a2a2a] transition-colors group relative ${
        selected ? 'border-[#beff00]' : 'border-[#1a1a1a]'
      }`}
    >
      {/* Checkbox */}
      <button
        onClick={() => onSelect(nftKey)}
        aria-label={selected ? 'Deselect NFT' : 'Select NFT'}
        className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border flex items-center justify-center transition-all ${
          selected
            ? 'opacity-100 bg-[#beff00] border-[#beff00]'
            : 'opacity-0 group-hover:opacity-100 bg-black/60 border-gray-400'
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-black" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
          </svg>
        )}
      </button>

      {/* Image */}
      <div className="aspect-square bg-[#1a1a1a] relative overflow-hidden">
        {imageUrl && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={nft.name || `#${nft.token_id}`}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[#404040] text-3xl">
            🖼
          </div>
        )}
        {/* Token type badge */}
        {nft.contract.token_type && (
          <span className="absolute top-2 right-2 text-xs bg-black/60 text-[#a1a1aa] px-1.5 py-0.5 rounded">
            {nft.contract.token_type}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <p className="text-xs text-[#6e6e6e] truncate">{collectionName}</p>
        <p className="text-sm font-medium truncate mt-0.5">
          {nft.name || `#${nft.token_id}`}
        </p>
        {floorPrice != null && (
          <p className="text-xs text-[#34d399] mt-1">{floorPrice} ETH floor</p>
        )}
      </div>
    </div>
  );
}

// ─── NftListRow ───────────────────────────────────────────────────────────────

interface NftListRowProps {
  nft: OwnedNft;
  selected: boolean;
  onSelect: (key: string) => void;
}

function NftListRow({ nft, selected, onSelect }: NftListRowProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = nft.image?.thumbnail_url || nft.image?.cached_url;
  const collectionName = nft.contract.opensea_collection_name || nft.contract.name || '—';
  const floorPrice = nft.contract.opensea_floor_price;
  const nftKey = `${nft.contract.address}-${nft.token_id}`;

  return (
    <div
      className={`grid grid-cols-12 px-4 py-3 items-center hover:bg-[#1a1a1a]/50 transition-colors border-b border-[#1a1a1a]/50 last:border-0 ${
        selected ? 'bg-[#beff00]/5' : ''
      }`}
    >
      {/* Checkbox column */}
      <div className="col-span-1 flex items-center">
        <button
          onClick={() => onSelect(nftKey)}
          aria-label={selected ? 'Deselect NFT' : 'Select NFT'}
          className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
            selected
              ? 'bg-[#beff00] border-[#beff00]'
              : 'bg-transparent border-[#2a2a2a] hover:border-gray-400'
          }`}
        >
          {selected && (
            <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2 6l3 3 5-5" />
            </svg>
          )}
        </button>
      </div>
      {/* Thumbnail column */}
      <div className="col-span-1">
        <div className="w-8 h-8 rounded bg-[#1a1a1a] overflow-hidden">
          {imageUrl && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[#404040] text-xs">🖼</div>
          )}
        </div>
      </div>
      <div className="col-span-3 text-sm truncate pr-2">{nft.name || `#${nft.token_id}`}</div>
      <div className="col-span-3 text-sm text-[#a1a1aa] truncate pr-2">{collectionName}</div>
      <div className="col-span-2 text-xs text-[#6e6e6e] font-mono truncate">#{nft.token_id}</div>
      <div className="col-span-2 text-right text-sm">
        {floorPrice != null ? (
          <span className="text-[#34d399]">{floorPrice} ETH</span>
        ) : (
          <span className="text-[#404040]">—</span>
        )}
      </div>
    </div>
  );
}
