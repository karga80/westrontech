// Typed empty defaults used when real data is unavailable (e.g. running in a
// plain browser during development, or a data call that failed). Westron shows
// ONLY real on-chain data — these render clean empty states instead of the
// fabricated numbers the old mock fixtures produced. Never put fake values here.

import type {
  PortfolioSnapshot,
  PnlSummary,
  NftsForOwnerResponse,
  AssetTransfer,
  TradeRecord,
  AlertRule,
  SnipeRule,
} from './tauri';

export const EMPTY_SNAPSHOT: PortfolioSnapshot = {
  eth_balance: 0,
  eth_price_usd: 0,
  portfolio_value_usd: 0,
  token_count: 0,
  nft_count: 0,
};

export const EMPTY_PNL: PnlSummary = {
  wallet_address: '',
  realized_pnl_eth: 0,
  unrealized_pnl_eth: 0,
  total_buy_volume_eth: 0,
  total_sell_volume_eth: 0,
  gas_spent_eth: 0,
  trade_count: 0,
  win_count: 0,
  loss_count: 0,
};

export const EMPTY_NFTS_RESPONSE: NftsForOwnerResponse = {
  owned_nfts: [],
  total_count: 0,
};

export const EMPTY_TRANSFERS: AssetTransfer[] = [];
export const EMPTY_TRADES: TradeRecord[] = [];
export const EMPTY_ALERTS: AlertRule[] = [];
export const EMPTY_SNIPE_RULES: SnipeRule[] = [];
