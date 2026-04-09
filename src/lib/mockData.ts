// Mock data for browser-mode testing (no Tauri / no API key required)
import type {
  EthBalance,
  AssetTransfer,
  OwnedNft,
  NftsForOwnerResponse,
  PortfolioSnapshot,
  PnlSummary,
  TradeRecord,
  AlertRule,
  EnvelopeStatus,
  SnipeRule,
} from './tauri';

export const MOCK_ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

// ─── Portfolio ────────────────────────────────────────────────────────────────

export const MOCK_ETH_BALANCE: EthBalance = {
  address: MOCK_ADDRESS,
  wei: '45234100000000000000',
  eth: 45.2341,
};

export const MOCK_TRANSFERS: AssetTransfer[] = [
  { hash: '0xabc123def456789012345678901234567890abcd', from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', to: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', value: 5.0, asset: 'ETH', category: 'external', block_num: '0x1312D00' },
  { hash: '0xdef456abc789012345678901234567890abcdef', from: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e', to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 1200.0, asset: 'USDC', category: 'erc20', block_num: '0x1312C80' },
  { hash: '0x111aaa222bbb333ccc444ddd555eee666fff0001', from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', to: '0x00000000006c3852cbef3e08e8df289169ede581', value: 12.5, asset: 'ETH', category: 'erc721', block_num: '0x1312B00' },
  { hash: '0x222bbb333ccc444ddd555eee666fff0001aaa222', from: '0x00000000006c3852cbef3e08e8df289169ede581', to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 1.0, asset: 'ETH', category: 'erc1155', block_num: '0x1312A00' },
  { hash: '0x333ccc444ddd555eee666fff0001aaa222bbb333', from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d', value: 2.3, asset: 'ETH', category: 'external', block_num: '0x1312900' },
  { hash: '0x444ddd555eee666fff0001aaa222bbb333ccc444', from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', to: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', value: 500.0, asset: 'USDC', category: 'erc20', block_num: '0x1312800' },
  { hash: '0x555eee666fff0001aaa222bbb333ccc444ddd555', from: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', to: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', value: 0.0, asset: 'BAYC', category: 'erc721', block_num: '0x1312700' },
  { hash: '0x666fff0001aaa222bbb333ccc444ddd555eee666', from: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', to: '0xdef1c0ded9bec7f1a1670819833240f027b25eff', value: 0.15, asset: 'ETH', category: 'external', block_num: '0x1312600' },
];

// ─── Gallery ──────────────────────────────────────────────────────────────────

export const MOCK_NFTS: OwnedNft[] = [
  {
    contract: { address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', name: 'BoredApeYachtClub', symbol: 'BAYC', token_type: 'ERC721', opensea_floor_price: 14.2, opensea_collection_name: 'Bored Ape Yacht Club' },
    token_id: '3749', name: 'Bored Ape #3749',
    image: { original_url: 'https://ipfs.io/ipfs/QmRRPWG96cmgTn2qSzjwr2qvfNEuhunv6FNeMFGa9bx6mQ', thumbnail_url: 'https://ipfs.io/ipfs/QmRRPWG96cmgTn2qSzjwr2qvfNEuhunv6FNeMFGa9bx6mQ' },
    attributes: [{ trait_type: 'Background', value: 'Orange' }, { trait_type: 'Fur', value: 'Dark Brown' }],
  },
  {
    contract: { address: '0xed5af388653567af2f388e6224dc7c4b3241c544', name: 'Azuki', symbol: 'AZUKI', token_type: 'ERC721', opensea_floor_price: 3.8, opensea_collection_name: 'Azuki' },
    token_id: '1234', name: 'Azuki #1234',
    image: { original_url: 'https://ipfs.io/ipfs/QmYDvPAXtiJg7s8JdRBoDibXtHVdNDsY5VFKQ8zuKGFUv2', thumbnail_url: 'https://ipfs.io/ipfs/QmYDvPAXtiJg7s8JdRBoDibXtHVdNDsY5VFKQ8zuKGFUv2' },
    attributes: [{ trait_type: 'Type', value: 'Human' }, { trait_type: 'Hair', value: 'Pink Flowy' }],
  },
  {
    contract: { address: '0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b', name: 'CloneX', symbol: 'CloneX', token_type: 'ERC721', opensea_floor_price: 1.9, opensea_collection_name: 'CloneX - X TAKASHI MURAKAMI' },
    token_id: '8891', name: 'CloneX #8891',
    image: { original_url: 'https://ipfs.io/ipfs/QmXqSE7aGMFHGNFKNnhA7rdvXTdFcm3eLJwWB6xLadkKHM' },
    attributes: [{ trait_type: 'DNA', value: 'Human' }, { trait_type: 'Eye Color', value: 'Ice Blue' }],
  },
  {
    contract: { address: '0x60e4d786628fea6478f785a6d7e704777c86a7c6', name: 'MutantApeYachtClub', symbol: 'MAYC', token_type: 'ERC721', opensea_floor_price: 2.1, opensea_collection_name: 'Mutant Ape Yacht Club' },
    token_id: '12345', name: 'Mutant Ape #12345',
    image: { original_url: 'https://ipfs.io/ipfs/QmTDcCdt3yb6mZitzWBmQr65AW6Wska295Dg9nbEYpSUDR' },
    attributes: [{ trait_type: 'Background', value: 'M1' }, { trait_type: 'Eyes', value: 'Bored' }],
  },
  {
    contract: { address: '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e', name: 'Doodles', symbol: 'DOODLE', token_type: 'ERC721', opensea_floor_price: 0.9, opensea_collection_name: 'Doodles' },
    token_id: '5021', name: 'Doodle #5021',
    image: { original_url: 'https://ipfs.io/ipfs/QmPMc4tcBsMqLRuCQtPmPe8t1Hq5CkdaLgGTxjPLdj3TBJ' },
    attributes: [{ trait_type: 'Background', value: 'Gradient' }, { trait_type: 'Head', value: 'Mohawk' }],
  },
  {
    contract: { address: '0x34d85c9cdeb23fa97cb08333b511ac86e1c4e258', name: 'Otherdeed', symbol: 'OTHR', token_type: 'ERC721', opensea_floor_price: 0.7, opensea_collection_name: 'Otherdeed for Otherside' },
    token_id: '77341', name: 'Otherdeed #77341',
    image: { original_url: 'https://ipfs.io/ipfs/QmfVMAmNM1kDEBYrC2Te2gaJxfte9yiAtHHHBBpBd1Q73z' },
    attributes: [{ trait_type: 'Sediment', value: 'Cosmic Dream' }],
  },
];

export const MOCK_NFTS_RESPONSE: NftsForOwnerResponse = {
  owned_nfts: MOCK_NFTS,
  total_count: MOCK_NFTS.length,
};

// ─── Analytics ────────────────────────────────────────────────────────────────

export const MOCK_PORTFOLIO_SNAPSHOT: PortfolioSnapshot = {
  eth_balance: 45.2341,
  eth_price_usd: 3412.88,
  portfolio_value_usd: 154382.5,
  token_count: 7,
  nft_count: 6,
};

export const MOCK_PNL_SUMMARY: PnlSummary = {
  wallet_address: MOCK_ADDRESS,
  realized_pnl_eth: 12.445,
  unrealized_pnl_eth: -2.311,
  total_buy_volume_eth: 87.32,
  total_sell_volume_eth: 99.765,
  gas_spent_eth: 0.0,
  trade_count: 34,
  win_count: 22,
  loss_count: 12,
};

export const MOCK_TRADES: TradeRecord[] = [
  { contract_address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', token_id: '3749', buy_price_eth: 10.5, sell_price_eth: undefined, pnl_eth: undefined, buy_tx_hash: '0xabc1', buy_timestamp: '2025-09-12T14:22:00Z' },
  { contract_address: '0xed5af388653567af2f388e6224dc7c4b3241c544', token_id: '812', buy_price_eth: 6.2, sell_price_eth: 9.8, pnl_eth: 3.6, buy_tx_hash: '0xabc2', sell_tx_hash: '0xdef2', buy_timestamp: '2025-07-03T09:10:00Z', sell_timestamp: '2025-08-20T17:45:00Z' },
  { contract_address: '0x60e4d786628fea6478f785a6d7e704777c86a7c6', token_id: '19283', buy_price_eth: 4.1, sell_price_eth: 2.9, pnl_eth: -1.2, buy_tx_hash: '0xabc3', sell_tx_hash: '0xdef3', buy_timestamp: '2025-06-15T11:00:00Z', sell_timestamp: '2025-07-01T08:30:00Z' },
  { contract_address: '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e', token_id: '2211', buy_price_eth: 1.8, sell_price_eth: 3.4, pnl_eth: 1.6, buy_tx_hash: '0xabc4', sell_tx_hash: '0xdef4', buy_timestamp: '2025-05-22T16:15:00Z', sell_timestamp: '2025-06-10T12:00:00Z' },
  { contract_address: '0x49cf6f5d44e70224e2e23fdcdd2c053f30ada28b', token_id: '8891', buy_price_eth: 3.0, sell_price_eth: undefined, pnl_eth: undefined, buy_tx_hash: '0xabc5', buy_timestamp: '2025-10-01T10:00:00Z' },
  { contract_address: '0x34d85c9cdeb23fa97cb08333b511ac86e1c4e258', token_id: '44120', buy_price_eth: 1.2, sell_price_eth: 0.8, pnl_eth: -0.4, buy_tx_hash: '0xabc6', sell_tx_hash: '0xdef6', buy_timestamp: '2025-04-11T07:00:00Z', sell_timestamp: '2025-05-03T14:00:00Z' },
];

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const MOCK_ALERTS: AlertRule[] = [
  {
    id: 'mock-alert-001',
    alert_type: 'portfolio_value',
    wallet_address: MOCK_ADDRESS,
    threshold_eth: 40.0,
    condition: 'below',
    active: true,
    created_at: '2025-11-01T10:00:00Z',
  },
  {
    id: 'mock-alert-002',
    alert_type: 'floor_price',
    wallet_address: MOCK_ADDRESS,
    collection_slug: 'boredapeyachtclub',
    threshold_eth: 10.0,
    condition: 'below',
    discord_webhook: 'https://discord.com/api/webhooks/...',
    active: true,
    created_at: '2025-10-15T09:30:00Z',
    last_triggered_at: '2025-11-20T14:12:00Z',
  },
  {
    id: 'mock-alert-003',
    alert_type: 'wallet_activity',
    wallet_address: MOCK_ADDRESS,
    threshold_eth: 5.0,
    condition: 'above',
    active: false,
    created_at: '2025-09-28T16:00:00Z',
  },
];

// ─── Sniping ──────────────────────────────────────────────────────────────────

export const MOCK_ENVELOPE: EnvelopeStatus = {
  active: true,
  kill_switch: false,
  spent_wei: '2100000000000000000',    // 2.1 ETH spent
  hard_cap_wei: '5000000000000000000', // 5.0 ETH cap
  expires_at: Math.floor(Date.now() / 1000) + 72 * 3600, // 72h from now
};

export const MOCK_SNIPE_RULES: SnipeRule[] = [
  {
    id: 'mock-snipe-001',
    collection_slug: 'azuki',
    target_price_eth: 3.5,
    max_quantity: 2,
    wallet_address: MOCK_ADDRESS,
    active: true,
    triggered_count: 0,
    created_at: '2025-11-10T08:00:00Z',
  },
  {
    id: 'mock-snipe-002',
    collection_slug: 'doodles-official',
    target_price_eth: 0.75,
    max_quantity: 1,
    wallet_address: MOCK_ADDRESS,
    active: false,
    triggered_count: 3,
    created_at: '2025-10-22T11:30:00Z',
  },
];
