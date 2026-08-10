import { invoke } from '@tauri-apps/api/core';

// App
export async function getAppVersion(): Promise<string> {
  return invoke<string>('get_app_version');
}

// Envelope
export interface EnvelopeCreateResult {
  envelope_id: string;
  expires_at: number;
}

export interface EnvelopeStatus {
  active: boolean;
  kill_switch: boolean;
  spent_wei: string; // u128 JSON olarak string gelir
  hard_cap_wei: string;
  expires_at: number;
}

export interface TxCheckResult {
  authorized: boolean;
  reject_reason?: string;
}

export async function createEnvelope(params: {
  per_tx_ceiling_eth: number;
  hard_cap_eth: number;
  scope_addresses: string[];
  ttl_hours: number;
}): Promise<EnvelopeCreateResult> {
  return invoke<EnvelopeCreateResult>('create_envelope', {
    perTxCeilingEth: params.per_tx_ceiling_eth,
    hardCapEth: params.hard_cap_eth,
    scopeAddresses: params.scope_addresses,
    ttlHours: params.ttl_hours,
  });
}

export async function getEnvelopeStatus(): Promise<EnvelopeStatus | null> {
  return invoke<EnvelopeStatus | null>('get_envelope_status');
}

export async function revokeEnvelope(): Promise<boolean> {
  return invoke<boolean>('revoke_envelope');
}

export async function checkTransaction(params: {
  to: string;
  value_eth: number;
  calldata: string;
}): Promise<TxCheckResult> {
  return invoke<TxCheckResult>('check_transaction', {
    to: params.to,
    valueEth: params.value_eth,
    calldata: params.calldata,
  });
}

export async function activateKillSwitch(): Promise<boolean> {
  return invoke<boolean>('activate_kill_switch');
}

export async function deactivateKillSwitch(): Promise<boolean> {
  return invoke<boolean>('deactivate_kill_switch');
}

/**
 * Stores a private key in the macOS Keychain and returns the address the
 * backend derived from that key. `address`, if supplied, is only an assertion:
 * the backend rejects the import when it does not match the derived address.
 * Always use the returned address as the wallet identity.
 */
export async function importWallet(params: {
  address?: string;
  private_key_hex: string;
}): Promise<string> {
  return invoke<string>('import_wallet', {
    address: params.address ?? null,
    privateKeyHex: params.private_key_hex,
  });
}

// RPC
export interface EthBalance {
  address: string;
  wei: string;
  eth: number;
}

export interface TokenBalance {
  contract_address: string;
  token_balance: string;
  error?: string;
}

export interface AssetTransfer {
  hash: string;
  from: string;
  to?: string;
  value?: number;
  asset?: string;
  category: string;
  block_num: string;
  token_id?: string;
  metadata?: { block_timestamp?: string };
  rawContract?: { address?: string };
}

export interface NftDetail {
  rarity_rank?: number;
  listing_price_eth?: number;
  top_offer_eth?: number;
}

export async function getEthBalance(address: string, apiKey: string): Promise<EthBalance> {
  return invoke<EthBalance>('get_eth_balance', { address, apiKey });
}

export async function getTokenBalances(address: string, apiKey: string): Promise<TokenBalance[]> {
  return invoke<TokenBalance[]>('get_token_balances', { address, apiKey });
}

export async function getAssetTransfers(
  address: string,
  apiKey: string,
  fromBlock: string = '0x0'
): Promise<AssetTransfer[]> {
  return invoke<AssetTransfer[]>('get_asset_transfers', { address, apiKey, fromBlock });
}

export interface TokenMetadata {
  contract_address: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  logo?: string;
}

export async function getTokenMetadata(contractAddress: string, apiKey: string): Promise<TokenMetadata> {
  return invoke<TokenMetadata>('get_token_metadata', { contractAddress, apiKey });
}

export async function getEthPriceUsd(apiKey: string): Promise<number> {
  // Sourced from Alchemy Prices API (CoinGecko removed).
  return invoke<number>('get_eth_price_usd', { apiKey });
}

// ── New unified data layer (Alchemy Prices + Portfolio + NFT v3) ────────────

export interface TokenPrice {
  symbol: string;
  address?: string | null;
  network?: string | null;
  usd?: number | null;
  lastUpdatedAt?: string | null;
}

export interface WalletToken {
  address: string;
  network: string;
  tokenAddress?: string | null;
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  logo?: string | null;
  balanceRaw?: string | null;
  balance?: number | null;
  usdValue?: number | null;
  usdPrice?: number | null;
  priceLastUpdatedAt?: string | null;
  isNative: boolean;
}

export interface WalletPortfolio {
  wallet: string;
  ethBalance: number;
  ethPriceUsd?: number | null;
  totalUsd: number;
  tokens: WalletToken[];
}

export interface NftCollectionMeta {
  address: string;
  name?: string | null;
  symbol?: string | null;
  totalSupply?: string | null;
  tokenType?: string | null;
  deployedBlockNumber?: number | null;
  deployer?: string | null;
  openseaFloorPriceEth?: number | null;
  openseaCollectionName?: string | null;
  openseaImageUrl?: string | null;
  openseaBannerUrl?: string | null;
  openseaSafelistStatus?: string | null;
}

export interface NftSale {
  contractAddress: string;
  tokenId: string;
  marketplace?: string | null;
  seller?: string | null;
  buyer?: string | null;
  priceEth?: number | null;
  priceUsd?: number | null;
  blockNumber?: number | null;
  blockTimestamp?: string | null;
  txHash?: string | null;
  quantity?: number | null;
}

export async function getTokenPricesBySymbol(symbols: string[], apiKey: string): Promise<TokenPrice[]> {
  return invoke<TokenPrice[]>('get_token_prices_by_symbol', { symbols, apiKey });
}

export async function getTokenPricesByAddress(addresses: string[], apiKey: string): Promise<TokenPrice[]> {
  return invoke<TokenPrice[]>('get_token_prices_by_address', { addresses, apiKey });
}

export async function getWalletPortfolio(wallet: string, apiKey: string): Promise<WalletPortfolio> {
  return invoke<WalletPortfolio>('get_wallet_portfolio', { wallet, apiKey });
}

export async function getWalletTokens(wallet: string, apiKey: string): Promise<WalletToken[]> {
  return invoke<WalletToken[]>('get_wallet_tokens', { wallet, apiKey });
}

export async function getCollectionMetadata(contract: string, apiKey: string): Promise<NftCollectionMeta> {
  return invoke<NftCollectionMeta>('get_collection_metadata', { contract, apiKey });
}

export async function getNftSales(
  contract: string,
  apiKey: string,
  opts: { tokenId?: string; limit?: number } = {},
): Promise<NftSale[]> {
  return invoke<NftSale[]>('get_nft_sales', {
    contract,
    tokenId: opts.tokenId ?? null,
    limit: opts.limit ?? 50,
    apiKey,
  });
}

// ── Real-time subscription bridge ────────────────────────────────────────────

export interface WatchSet {
  wallets: string[];
  collections: string[];
  priceSymbols: string[];
  subscribeBlocks: boolean;
}

export async function realtimeInit(apiKey: string): Promise<void> {
  return invoke<void>('realtime_init', { apiKey });
}

export async function realtimeSetWatchSet(set: WatchSet): Promise<void> {
  return invoke<void>('realtime_set_watch_set', { set });
}

// NFT
export interface NftContract {
  address: string;
  name?: string;
  symbol?: string;
  token_type?: string;
  opensea_floor_price?: number;
  opensea_collection_name?: string;
}

export interface NftImage {
  cached_url?: string;
  original_url?: string;
  thumbnail_url?: string;
}

export interface NftAttribute {
  trait_type?: string;
  value?: unknown;
}

export interface OwnedNft {
  contract: NftContract;
  token_id: string;
  name?: string;
  description?: string;
  image?: NftImage;
  attributes?: NftAttribute[];
  balance?: string;
}

export interface NftsForOwnerResponse {
  owned_nfts: OwnedNft[];
  total_count: number;
  page_key?: string;
}

export interface NftFloorPrice {
  contract_address: string;
  floor_price?: number;
  price_currency?: string;
  marketplace?: string;
  retrieved_at?: string;
}

export async function getNftsForOwner(
  ownerAddress: string,
  apiKey: string,
  pageKey?: string
): Promise<NftsForOwnerResponse> {
  return invoke<NftsForOwnerResponse>('get_nfts_for_owner', {
    ownerAddress,
    apiKey,
    pageKey: pageKey ?? null,
  });
}

export async function fetchNftDetail(
  contractAddress: string,
  tokenId: string
): Promise<NftDetail> {
  return invoke<NftDetail>('fetch_nft_detail', { contractAddress, tokenId });
}

export async function getFloorPrice(
  contractAddress: string,
  apiKey: string
): Promise<NftFloorPrice> {
  return invoke<NftFloorPrice>('get_floor_price', {
    contractAddress,
    apiKey,
  });
}

// Alerts
export interface AlertRuleInput {
  alert_type: string;
  wallet_address: string;
  collection_slug?: string;
  threshold_eth: number;
  condition: string;
  discord_webhook?: string;
}

export interface AlertRule {
  id: string;
  alert_type: string;
  wallet_address: string;
  collection_slug?: string;
  threshold_eth: number;
  condition: string;
  discord_webhook?: string;
  active: boolean;
  created_at: string;
  last_triggered_at?: string;
}

export async function createAlert(rule: AlertRuleInput): Promise<string> {
  return invoke<string>('create_alert', { rule });
}

export async function listAlerts(walletAddress: string): Promise<AlertRule[]> {
  return invoke<AlertRule[]>('list_alerts', { walletAddress });
}

export async function deleteAlert(id: string): Promise<void> {
  return invoke('delete_alert', { id });
}

export async function setAlertActive(id: string, active: boolean): Promise<void> {
  return invoke('set_alert_active', { id, active });
}

export async function checkAlertsNow(walletAddress: string, apiKey: string): Promise<void> {
  return invoke('check_alerts_now', { walletAddress, apiKey });
}

export async function startBackgroundPolling(walletAddresses: string[], apiKey: string): Promise<boolean> {
  return invoke<boolean>('start_background_polling', { walletAddresses, apiKey });
}

// Signing
export async function getPrivateKey(walletAddress: string): Promise<string> {
  return invoke<string>('get_private_key', { walletAddress });
}

export async function sendEth(
  walletAddress: string,
  to: string,
  valueWei: string,
  apiKey: string
): Promise<string> {
  return invoke<string>('send_eth', {
    walletAddress,
    to,
    valueWei,
    apiKey,
  });
}

/** Matches `nft::TokenStandard`'s `#[serde(rename_all = "UPPERCASE")]` on the
 *  Rust side — the wire value is the bare variant name, no hyphen. */
export type NftTokenStandard = 'ERC721' | 'ERC1155';

/**
 * Direct wallet-to-wallet NFT transfer (`safeTransferFrom`) — not a
 * marketplace sale. Goes through the same spend envelope as `sendEth`,
 * called with `value_wei = 0` and `to` set to the human recipient, not the
 * NFT contract; the envelope's scope/kill-switch/expiry checks apply exactly
 * as they do for an ETH send. `amount` only matters for ERC-1155 (quantity
 * of this token id to move); the backend defaults it to 1 when omitted.
 */
export async function transferNft(
  walletAddress: string,
  contractAddress: string,
  tokenId: string,
  to: string,
  tokenStandard: NftTokenStandard,
  apiKey: string,
  amount?: string
): Promise<string> {
  return invoke<string>('transfer_nft', {
    walletAddress,
    contractAddress,
    tokenId,
    to,
    tokenStandard,
    amount: amount ?? null,
    apiKey,
  });
}

export async function estimateGas(
  to: string,
  valueWei: string,
  data?: string,
  apiKey?: string
): Promise<number> {
  return invoke<number>('estimate_gas', {
    to,
    valueWei,
    data: data ?? null,
    apiKey: apiKey ?? '',
  });
}

export async function saveAlchemyKey(apiKey: string): Promise<void> {
  return invoke('save_alchemy_key', { apiKey });
}

export async function loadAlchemyKey(): Promise<string> {
  return invoke<string>('load_alchemy_key');
}

export async function deleteAlchemyKey(): Promise<void> {
  return invoke('delete_alchemy_key_cmd');
}

export async function saveOpenSeaKey(apiKey: string): Promise<void> {
  return invoke('save_opensea_key', { apiKey });
}

export async function loadOpenSeaKey(): Promise<string> {
  return invoke<string>('load_opensea_key');
}

export async function deleteOpenSeaKey(): Promise<void> {
  return invoke('delete_opensea_key_cmd');
}

// ── NFT PnL (locally-stored cost basis) ──────────────────────────────────────

export interface BackfillResult {
  scanned: number;
  newly_recorded: number;
  with_price: number;
  unknown: number;
}

export interface NftPnlItem {
  contract: string;
  token_id: string;
  collection?: string | null;
  cost_eth?: number | null;
  floor_eth?: number | null;
  unrealized_eth?: number | null;
  source: string; // marketplace_sale | manual | unknown | none
}

export interface NftPnlSummary {
  total_cost_eth: number;
  total_floor_eth: number;
  unrealized_eth: number;
  priced_count: number;
  held_count: number;
  items: NftPnlItem[];
}

/** Record acquisition prices for any held NFTs not yet stored (one-time per token). */
export async function backfillNftCostBasis(wallet: string, apiKey: string): Promise<BackfillResult> {
  return invoke<BackfillResult>('backfill_nft_cost_basis', { wallet, apiKey });
}

/** Unrealized NFT PnL from locally-stored cost basis + current floors. */
export async function getNftPnl(wallet: string, apiKey: string): Promise<NftPnlSummary> {
  return invoke<NftPnlSummary>('get_nft_pnl', { wallet, apiKey });
}

/** Manually set/correct a token's cost basis (mints, gifts). */
export async function setNftCostBasis(wallet: string, contract: string, tokenId: string, priceEth: number): Promise<void> {
  return invoke('set_nft_cost_basis', { wallet, contract, tokenId, priceEth });
}

// ── Sister-wallet finder (Etherscan, ETH mainnet) ────────────────────────────

export type SisterReason = 'common_funder' | 'funded_target' | 'target_funded' | 'round_trip';

export interface SisterCandidate {
  address: string;
  reasons: SisterReason[];
  direct_out: number;
  direct_in: number;
  first_interaction?: number | null;
  last_interaction?: number | null;
  score: number;
}

export interface SisterReport {
  target: string;
  funder?: string | null;
  candidates: SisterCandidate[];
  note?: string | null;
}

export async function findSisterWallets(address: string): Promise<SisterReport> {
  return invoke<SisterReport>('find_sister_wallets', { address });
}

export async function saveEtherscanKey(apiKey: string): Promise<void> {
  return invoke('save_etherscan_key', { apiKey });
}

export async function loadEtherscanKey(): Promise<string> {
  return invoke<string>('load_etherscan_key');
}

export async function deleteEtherscanKey(): Promise<void> {
  return invoke('delete_etherscan_key_cmd');
}

// Sniping
export interface SnipeRuleInput {
  collection_slug: string;
  target_price_eth: number;
  max_quantity: number;
  wallet_address: string;
}

export interface SnipeRule {
  id: string;
  collection_slug: string;
  target_price_eth: number;
  max_quantity: number;
  wallet_address: string;
  active: boolean;
  triggered_count: number;
  created_at: string;
}

export interface SnipeResult {
  rule_id: string;
  collection_slug: string;
  floor_price_eth: number;
  triggered: boolean;
  tx_hash?: string;
  error?: string;
}

export async function createSnipeRule(input: SnipeRuleInput): Promise<string> {
  return invoke<string>('create_snipe_rule', { input });
}

export async function listSnipeRules(walletAddress: string): Promise<SnipeRule[]> {
  return invoke<SnipeRule[]>('list_snipe_rules', { walletAddress });
}

export async function deleteSnipeRule(id: string): Promise<void> {
  return invoke('delete_snipe_rule', { id });
}

export async function setSnipeRuleActive(id: string, active: boolean): Promise<void> {
  return invoke('set_snipe_rule_active', { id, active });
}

export async function runSnipeCheck(apiKey: string): Promise<SnipeResult[]> {
  return invoke<SnipeResult[]>('run_snipe_check', { apiKey });
}

// Analytics & PnL
export interface PortfolioSnapshot {
  eth_balance: number;
  eth_price_usd: number;
  portfolio_value_usd: number;
  token_count: number;
  nft_count: number;
}

export interface PnlSummary {
  wallet_address: string;
  realized_pnl_eth: number;
  unrealized_pnl_eth: number;
  total_buy_volume_eth: number;
  total_sell_volume_eth: number;
  gas_spent_eth: number;  // always 0.0 — display as "N/A" in UI
  trade_count: number;
  win_count: number;
  loss_count: number;
}

export interface TradeRecord {
  contract_address: string;
  token_id: string;
  buy_price_eth: number;
  sell_price_eth?: number;
  pnl_eth?: number;
  buy_tx_hash: string;
  sell_tx_hash?: string;
  buy_timestamp: string;
  sell_timestamp?: string;
}

export async function getPortfolioSnapshot(
  walletAddress: string,
  apiKey: string
): Promise<PortfolioSnapshot> {
  return invoke<PortfolioSnapshot>('get_portfolio_snapshot', { walletAddress, apiKey });
}

export async function getPnlSummary(
  walletAddress: string,
  apiKey: string
): Promise<PnlSummary> {
  return invoke<PnlSummary>('get_pnl_summary', { walletAddress, apiKey });
}

export async function getTradeHistory(
  walletAddress: string,
  apiKey: string
): Promise<TradeRecord[]> {
  return invoke<TradeRecord[]>('get_trade_history', { walletAddress, apiKey });
}

// Marketplace
export type MarketplaceName = 'opensea' | 'blur';

export interface OrderResult {
  order_hash: string;
  action: string;
  marketplace: string;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  tx_hash?: string;
  error?: string;
}

export async function marketplaceListNft(params: {
  walletAddress: string;
  contractAddress: string;
  tokenId: string;
  priceEth: number;
  marketplace: MarketplaceName;
  expiryHours: number;
  apiKey: string;
}): Promise<OrderResult> {
  return invoke<OrderResult>('marketplace_list_nft', {
    walletAddress: params.walletAddress,
    contractAddress: params.contractAddress,
    tokenId: params.tokenId,
    priceEth: params.priceEth,
    marketplace: params.marketplace,
    expiryHours: params.expiryHours,
    apiKey: params.apiKey,
  });
}

export async function marketplacePlaceBid(params: {
  walletAddress: string;
  contractAddress: string;
  priceEth: number;
  quantity: number;
  marketplace: MarketplaceName;
  expiryHours: number;
  apiKey: string;
}): Promise<OrderResult> {
  return invoke<OrderResult>('marketplace_place_bid', {
    walletAddress: params.walletAddress,
    contractAddress: params.contractAddress,
    priceEth: params.priceEth,
    quantity: params.quantity,
    marketplace: params.marketplace,
    expiryHours: params.expiryHours,
    apiKey: params.apiKey,
  });
}

export async function marketplaceCancelOrder(params: {
  orderHash: string;
  walletAddress: string;
  marketplace: MarketplaceName;
  apiKey: string;
}): Promise<OrderResult> {
  return invoke<OrderResult>('marketplace_cancel_order', {
    orderHash: params.orderHash,
    walletAddress: params.walletAddress,
    marketplace: params.marketplace,
    apiKey: params.apiKey,
  });
}

// NFT collection browsing
export interface NftAsset {
  identifier: string;
  name?: string;
  image_url?: string;
  display_image_url?: string;
  opensea_url?: string;
  price_eth?: number | null;
  last_sale_eth?: number | null;
  order_hash?: string | null;
}

export async function fetchCollectionNfts(collectionSlug: string, limit = 20): Promise<NftAsset[]> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) return [];
  return invoke<NftAsset[]>('fetch_collection_nfts', { collectionSlug, limit });
}

export interface CollectionInfo {
  slug: string;
  name: string;
  contract_address: string;
  symbol?: string;
  total_supply?: number;
  floor_price_eth?: number;
  vol_24h_eth?: number;
  vol_7d_eth?: number;
  sales_7d?: number;
  num_owners?: number;
  image_url?: string;
  description?: string;
}

export async function fetchCollectionByContract(contractAddress: string): Promise<CollectionInfo> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) throw new Error('OpenSea lookup requires the desktop app');
  return invoke<CollectionInfo>('fetch_collection_by_contract', { contractAddress });
}

export interface CollectionStats {
  floor_price_eth: number | null;
  num_owners: number | null;
  total_supply: number | null;
  market_cap_eth: number | null;
  total_volume_eth: number | null;
  vol_1d_eth: number | null;
  vol_1d_change: number | null;
  sales_1d: number | null;
  avg_price_1d_eth: number | null;
  vol_7d_eth: number | null;
  vol_7d_change: number | null;
  sales_7d: number | null;
  vol_30d_eth: number | null;
  vol_30d_change: number | null;
  sales_30d: number | null;
}

export interface CollectionEvent {
  event_type: string;
  token_id: string | null;
  nft_name: string | null;
  nft_image_url: string | null;
  opensea_url: string | null;
  price_eth: number | null;
  payment_symbol: string | null;
  seller: string | null;
  buyer: string | null;
  from_address: string | null;
  to_address: string | null;
  timestamp: number | null;
  transaction: string | null;
}

export interface CollectionHolder {
  owner_address: string;
  token_count: number;
}

export async function fetchCollectionStats(collectionSlug: string): Promise<CollectionStats> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) throw new Error('fetchCollectionStats requires the desktop app');
  return invoke<CollectionStats>('fetch_collection_stats', { collectionSlug });
}

export async function fetchCollectionEvents(collectionSlug: string, eventType = '', limit = 50): Promise<CollectionEvent[]> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) return [];
  return invoke<CollectionEvent[]>('fetch_collection_events', { collectionSlug, eventType, limit });
}

export async function fetchCollectionHolders(contractAddress: string, limit = 50): Promise<CollectionHolder[]> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) return [];
  return invoke<CollectionHolder[]>('fetch_collection_holders', { contractAddress, limit });
}

export interface CollectionOffer {
  price_eth: number;
  payment_symbol: string;
  quantity: number;
  maker_address: string;
  maker_username: string | null;
  maker_image_url: string | null;
  expiration: number | null;
  order_hash: string;
}

export async function fetchCollectionOffers(collectionSlug: string, limit = 50): Promise<CollectionOffer[]> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) return [];
  return invoke<CollectionOffer[]>('fetch_collection_offers', { collectionSlug, limit });
}

export interface TraitValue {
  value: string;
  count: number;
  supply_percent: number;
}

export interface CollectionTrait {
  category: string;
  values: TraitValue[];
}

export async function fetchCollectionTraits(collectionSlug: string, totalSupply = 0): Promise<CollectionTrait[]> {
  const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!inTauri) return [];
  return invoke<CollectionTrait[]>('fetch_collection_traits', { collectionSlug, totalSupply });
}

// Subscription — account + bearer-token protocol (T13). No wallet argument
// anywhere here: identity is the logged-in account (email/password), not a
// wallet address. Call subscriptionSignup/subscriptionLogin first; then
// checkSubscription() refreshes/verifies the license for whoever is logged in.
export interface SubscriptionCheckResult {
  active: boolean;
  plan: string | null;
  expires_at: string | null; // ISO date string
  error?: string;
}

export async function openExternalUrl(url: string): Promise<void> {
  return invoke('open_external_url', { url });
}

/** Refresh/verify the subscription for the currently logged-in account.
 * If no account is logged in, resolves with `active: false` and an `error`
 * explaining that — it does not throw for "not logged in". */
export async function checkSubscription(): Promise<SubscriptionCheckResult> {
  return invoke<SubscriptionCheckResult>('check_subscription');
}

/** Create a new account and log in. Throws with a user-readable message on
 * failure (e.g. email already registered, weak password, network error). */
export async function subscriptionSignup(email: string, password: string): Promise<SubscriptionCheckResult> {
  return invoke<SubscriptionCheckResult>('subscription_signup', { email, password });
}

/** Log in to an existing account. Throws with a user-readable message on
 * failure (e.g. wrong password, network error). */
export async function subscriptionLogin(email: string, password: string): Promise<SubscriptionCheckResult> {
  return invoke<SubscriptionCheckResult>('subscription_login', { email, password });
}

/** Forget the current session and its cached license. */
export async function subscriptionLogout(): Promise<void> {
  return invoke('subscription_logout');
}

/** Email of the currently logged-in account, or null if no session is stored. */
export async function subscriptionCurrentAccount(): Promise<string | null> {
  return invoke<string | null>('subscription_current_account');
}

// Stream API
export interface StreamStatus {
  connected: boolean;
  reconnecting: boolean;
  subscribed_collections: string[];
  error?: string;
}

export interface StreamEvent {
  collection_slug: string;
  event_type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
  received_at: string;
}

export interface SnipeOpportunity {
  rule_id: string;
  collection_slug: string;
  listing_price_eth: number;
  target_price_eth: number;
  order_hash?: string;
  maker?: { address: string };
  item?: {
    token_id?: string;
    permalink?: string;
    metadata?: { name?: string; image_url?: string };
  };
}

export async function startStream(collections: string[]): Promise<void> {
  return invoke('start_stream', { collections });
}

export async function stopStream(): Promise<void> {
  return invoke('stop_stream');
}

export async function getStreamStatus(): Promise<{ running: boolean; subscribed_collections: string[] }> {
  return invoke('get_stream_status');
}
