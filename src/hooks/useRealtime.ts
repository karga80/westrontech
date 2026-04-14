// React hooks bridging the Tauri real-time event channels (Phase 4) into
// component state. All wallet, NFT, block and price events flow through here.
//
// Usage in a component:
//   const events = useWalletTxStream(wallets);   // []WalletTxEvent
//   const blocks = useNewBlockStream();          // last NewBlock
//   const prices = useRealtimePrices(['ETH', 'USDC']);
//
// Each hook is a thin layer over `@tauri-apps/api/event::listen` with cleanup
// on unmount. The first call also lazily initializes the realtime backend.

'use client';

import { useEffect, useRef, useState } from 'react';

// Channel names — must mirror src-tauri/src/data/realtime/event_router.rs.
const EVENT_WALLET_TX     = 'westron:wallet:tx';
const EVENT_NFT_TRANSFER  = 'westron:nft:transfer';
const EVENT_NEW_BLOCK     = 'westron:block:new';
const EVENT_PRICE_TICK    = 'westron:price:tick';
const EVENT_CONNECTION    = 'westron:realtime:connection';

export interface WalletTxEvent {
  kind: 'wallet_tx';
  wallet: string;
  hash: string;
  from: string;
  to?: string | null;
  value_wei?: string | null;
  block_number: number;
  category: string;
  asset?: string | null;
}

export interface CollectionTransferEvent {
  kind: 'collection_transfer';
  contract: string;
  from: string;
  to: string;
  token_id?: string | null;
  block_number: number;
  tx_hash: string;
}

export interface NewBlockEvent {
  kind: 'new_block';
  block_number: number;
  block_hash: string;
  timestamp: number;
  base_fee_per_gas_wei?: string | null;
  gas_used?: string | null;
  gas_limit?: string | null;
}

export interface PriceTickEvent {
  kind: 'price_tick';
  symbol: string;
  usd: number;
  last_updated_at: string;
}

export interface ConnectionEvent {
  kind: 'connection_state';
  connected: boolean;
  reason?: string | null;
}

const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Subscribe to a Tauri event channel; returns the latest payload.
 * Avoids re-render storms by storing the listener reference and only updating
 * when the payload's identity changes.
 */
function useTauriEvent<T>(channel: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  const ref = useRef<{ unlisten?: () => void }>({});

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<T>(channel, (e) => {
        if (!cancelled) setValue(e.payload);
      });
      ref.current.unlisten = unlisten;
    })();
    return () => {
      cancelled = true;
      ref.current.unlisten?.();
    };
  }, [channel]);

  return value;
}

/** Buffered stream — keeps a rolling history of the last N events. */
function useTauriEventStream<T>(channel: string, capacity = 100): T[] {
  const [events, setEvents] = useState<T[]>([]);
  const ref = useRef<{ unlisten?: () => void }>({});

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<T>(channel, (e) => {
        if (!cancelled) setEvents((prev) => [e.payload, ...prev].slice(0, capacity));
      });
      ref.current.unlisten = unlisten;
    })();
    return () => {
      cancelled = true;
      ref.current.unlisten?.();
    };
  }, [channel, capacity]);

  return events;
}

// ── Public hooks ────────────────────────────────────────────────────────────

export function useWalletTxStream(): WalletTxEvent[] {
  return useTauriEventStream<WalletTxEvent>(EVENT_WALLET_TX, 200);
}

export function useCollectionTransferStream(): CollectionTransferEvent[] {
  return useTauriEventStream<CollectionTransferEvent>(EVENT_NFT_TRANSFER, 200);
}

export function useLatestBlock(): NewBlockEvent | null {
  return useTauriEvent<NewBlockEvent>(EVENT_NEW_BLOCK);
}

export function useConnectionState(): ConnectionEvent | null {
  return useTauriEvent<ConnectionEvent>(EVENT_CONNECTION);
}

/**
 * Subscribe to live price updates for the given symbols. Returns a map of
 * symbol → latest USD price. The price poller runs on the Rust side and only
 * actively re-fetches symbols you've registered (via realtime_set_watch_set).
 */
export function useRealtimePrices(): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<PriceTickEvent>(EVENT_PRICE_TICK, (e) => {
        if (cancelled) return;
        setPrices((prev) => ({ ...prev, [e.payload.symbol.toUpperCase()]: e.payload.usd }));
      });
    })();
    return () => { cancelled = true; unlisten?.(); };
  }, []);
  return prices;
}
