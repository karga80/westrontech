# Westron API reference

This document describes the APIs implemented in this repository as of 2026-08-10.
It separates the public Cloudflare Worker, external-provider integrations, the
local Tauri control API, Tauri IPC commands, and the MCP shim.  There is no
single public Westron API: most application capabilities are local-only.

## Live test summary

Tests used the deployed Worker at
`https://westron-subscription.ebaltepe.workers.dev`. A disposable trial account
was created solely to test authenticated, read-only proxy requests. Its local
token was deleted after the run. No transaction, listing, bid, cancellation,
payment, or wallet-registration request was sent.

| Surface | Result | Evidence from the response |
| --- | --- | --- |
| Worker health | PASS | `GET /health` returned `200 {"ok":true}`. |
| Billing quote | PASS | `GET /billing/quote` returned a payment wallet and monthly/annual ETH amounts. |
| Account routes | PASS | Signup returned `201`; `/me`, `/subscription/status`, and `/license` returned `200` with active trial access and a signed license. |
| Authentication gate | PASS | Unauthenticated account, license, and proxy requests returned `401 {"error":"unauthorized"}`. |
| Alchemy JSON-RPC proxy | PASS | `eth_chainId` returned `0x1`, proving a real Ethereum-mainnet response. |
| OpenSea proxy | PASS | The BAYC collection request returned `200` and `name: "Bored Ape Yacht Club"`. |
| Etherscan proxy | PASS | ETH-supply request returned `200`, `status: "1"`, and a result. |
| Alchemy NFT proxy | FAIL | `getContractMetadata` returned `401` upstream. |
| Alchemy Prices proxy | FAIL | `tokens/by-symbol?symbols=ETH` returned `404`. |
| Alchemy Portfolio Data proxy | FAIL | `assets/tokens/by-address` returned `400` (`EAPIs not enabled on specified network: [NETWORK_AGNOSTIC]`). |
| MCP shim smoke test | FAIL | The test child closed its MCP stdio connection before tool discovery. See [Known integration gaps](#known-integration-gaps). |

The three Alchemy failures are not evidence that Alchemy itself is unavailable:
the Worker rewrites those routes differently from the direct desktop Alchemy
client. The direct client requires a user-supplied Alchemy key and was not
live-tested in this workspace.

## 1. Subscription Worker HTTP API

Base URL: `https://westron-subscription.ebaltepe.workers.dev`

All JSON responses include CORS headers allowing `Content-Type` and
`Authorization`. Protected routes require `Authorization: Bearer <session-token>`.
Accounts receive an active seven-day trial by default; actual expiry is supplied
by the API, not assumed by the client.

| Method and path | Auth | Purpose | Side effect | Live status |
| --- | --- | --- | --- | --- |
| `GET /health` | No | Service health probe. | None | PASS |
| `GET /billing/quote` | No | Return payment wallet and ETH subscription prices. | None | PASS |
| `POST /signup` | No | Create account and a session; returns `token`, `account`, `access`, `license`. Body: `email`, `password` (minimum 8 chars). | Creates user, subscription row, and session. | PASS |
| `POST /login` | No | Authenticate with `email` and `password`; returns the same account/session payload as signup. | Creates session. | Not live-tested |
| `POST /logout` | Optional bearer | Delete the current session; always returns `{ok:true}`. | Deletes session. | Not live-tested |
| `GET /me` | Yes | Account, effective access, and registered payer wallets. | None | PASS |
| `GET /subscription/status` | Yes | Effective `{active,reason,plan,expires_at}`. | None | PASS |
| `POST /license` | Yes | Issue a fresh Ed25519 account license: `{access,license:{payload,sig}}`. | None | PASS |
| `POST /billing/register-wallet` | Yes | Associate an ETH payer wallet with the account. Body: `{wallet}`. | Writes payer-wallet mapping. | Not live-tested |
| `POST /webhook/alchemy` | HMAC signature | Accept Alchemy `ADDRESS_ACTIVITY` payment events. | May activate/extend a paid subscription. | Not live-tested |
| `OPTIONS *` | No | CORS preflight. | None | Not live-tested |

### License contract

`license.payload` is an exact JSON string signed with the Worker's Ed25519
private key; `license.sig` is base64. Current payload fields are:

```json
{
  "account_id": "uuid",
  "email": "account@example.com",
  "active": true,
  "reason": "trial",
  "plan": "trial",
  "expires_at": 0,
  "issued_at": 0
}
```

## 2. Worker data-proxy API

The proxy is intended to keep the Worker secrets `ALCHEMY_KEY`, `OPENSEA_KEY`,
and `ETHERSCAN_KEY` out of clients. Every route below requires an active
session; inactive subscriptions receive `402`.

| Route family | Upstream mapping in the Worker | Intended data | Live status |
| --- | --- | --- | --- |
| `POST /proxy/alchemy/rpc` | `https://eth-mainnet.g.alchemy.com/v2/{ALCHEMY_KEY}` | Ethereum JSON-RPC and Alchemy enhanced RPC. | PASS (`eth_chainId → 0x1`) |
| `GET /proxy/alchemy/nft/{path}` | `https://eth-mainnet.g.alchemy.com/nft/{ALCHEMY_KEY}/{path}` | NFT API requests. | FAIL (`401`) |
| `GET|POST /proxy/alchemy/prices/{path}` | `https://api.g.alchemy.com/prices/{path}` with Bearer key | Token prices. | FAIL (`404`) |
| `GET|POST /proxy/alchemy/data/{path}` | `https://api.g.alchemy.com/data/{path}` with Bearer key | Portfolio Data API. | FAIL (`400`) |
| `GET|POST /proxy/opensea/{path}` | `https://api.opensea.io/{path}` with `X-API-KEY` | OpenSea API v2. | PASS (collection metadata) |
| `GET /proxy/etherscan/{path}` | `https://api.etherscan.io/v2/{path}` with appended `apikey` | Etherscan v2. | PASS (ETH supply) |

The proxy forwards the request query string. It must never accept an upstream
key from the caller.

## 3. External provider operations used by the desktop app

The desktop app currently stores API keys locally and calls these providers
directly. It does **not** currently call the Worker proxy from its Rust data
clients.

### Alchemy (Ethereum mainnet)

| API | Operations used | Data returned |
| --- | --- | --- |
| JSON-RPC v2 | `eth_getBalance`, `eth_estimateGas`, `eth_getTransactionCount`, `eth_sendRawTransaction` | Native balances and transaction execution primitives. |
| Alchemy enhanced RPC | `alchemy_getTokenBalances`, `alchemy_getTokenMetadata`, `alchemy_getAssetTransfers`, `alchemy_getOwnersForContract` | ERC-20 balances/metadata, transfers, and NFT owners. |
| NFT API v3 | `getNFTsForOwner`, `getFloorPrice`, `getContractMetadata`, `getNFTSales` | Owned NFTs, floors, collection metadata, and sales. |
| Portfolio Data API | `POST assets/tokens/by-address` | Native/ERC-20 balances plus metadata and USD prices. |
| Prices API v1 | `GET tokens/by-symbol`, `POST tokens/by-address` | USD price quotes and update timestamps. |
| WebSocket | Mined transactions, collection transfers, and new heads subscriptions. | Realtime wallet/collection/block events. |

The direct endpoint formats are implemented in
[`src-tauri/src/data/alchemy/client.rs`](src-tauri/src/data/alchemy/client.rs):

```text
RPC:       https://eth-mainnet.g.alchemy.com/v2/{key}
NFT v3:    https://eth-mainnet.g.alchemy.com/nft/v3/{key}
Data v1:   https://api.g.alchemy.com/data/v1/{key}
Prices v1: https://api.g.alchemy.com/prices/v1   (Authorization: Bearer {key})
WebSocket: wss://eth-mainnet.g.alchemy.com/v2/{key}
```

### OpenSea API v2

Read operations include collection lookup by contract, collection metadata and
stats, NFTs, events, offers, traits, listings, and NFT detail. Write operations
are listing submission, collection offer submission, and off-chain order
cancellation. They require local signing and must be treated as financial
operations; they were deliberately not live-tested.

### Etherscan API v2

The Sister Wallet Finder uses `GET /v2/api` with `chainid=1`, `module=account`,
`action=txlist`, address, pagination, sorting, and a local Etherscan key. The
Worker proxy test used the safe `module=stats&action=ethsupply` call instead of
reading an account's transaction history.

### OpenSea Stream and IPFS

The app also has an OpenSea Stream client requiring `OPENSEA_API_KEY`, plus
HTTP metadata/image fetches that normalize `ipfs://` URLs to `https://ipfs.io/ipfs/...`.
Neither is proxied by the Worker or live-tested here.

## 4. Local Westron control HTTP API

This API binds to loopback (`127.0.0.1:7777` by default), requires the local
control token, and is used by `tools/westron-mcp`. It is not exposed publicly.

| Method and path | Function |
| --- | --- |
| `GET /status` | App version, key/envelope/kill-switch/scheduler state. |
| `GET /portfolio/{address}` | Wallet portfolio snapshot. |
| `GET /floor/{contract}` | NFT floor quote by contract address. |
| `GET|POST /rules` | List or create simulated snipe rules. |
| `DELETE /rules/{id}` | Delete a snipe rule. |
| `POST /rules/{id}/active` | Pause/resume a snipe rule. |
| `GET|DELETE /alerts/{wallet_or_id}` | List wallet alerts or delete alert by id. |
| `POST /alerts` | Create a notification alert. |
| `POST|DELETE /envelope` | Create/revoke local spend envelope. |
| `POST /kill-switch` | Engage/release kill switch. |
| `POST /preview-transaction` | Evaluate an unsigned transaction against the envelope. |
| `POST /snipe-check` | Run a simulated one-off snipe pass. |
| `POST /scheduler` | Read/configure the local scheduler. |

Details, input types, and error handling live in
[`src-tauri/src/control/routes.rs`](src-tauri/src/control/routes.rs) and the
route table is in [`src-tauri/src/control/mod.rs`](src-tauri/src/control/mod.rs).

## 5. Tauri IPC API

The Next.js frontend calls these commands with `invoke()` through
[`src/lib/tauri.ts`](src/lib/tauri.ts). They are available only inside the
desktop application; the browser preview intentionally cannot perform native
operations.

| Group | Commands |
| --- | --- |
| App/envelope | `get_app_version`, `create_envelope`, `get_envelope_status`, `revoke_envelope`, `check_transaction`, `activate_kill_switch`, `deactivate_kill_switch` |
| Wallet and keys | `import_wallet`, `get_private_key`, `save_*_key`, `load_*_key`, `delete_*_key_cmd` for Alchemy, OpenSea, and Etherscan |
| Alchemy reads | `get_eth_balance`, `get_token_balances`, `get_asset_transfers`, `get_token_metadata`, `get_eth_price_usd`, `get_token_prices_by_symbol`, `get_token_prices_by_address`, `get_wallet_portfolio`, `get_wallet_tokens`, `get_collection_metadata`, `get_nft_sales`, `get_nfts_for_owner`, `get_floor_price`, `fetch_nft_detail` |
| Realtime | `realtime_init`, `realtime_set_watch_set`, `start_stream`, `stop_stream`, `get_stream_status`, `start_background_polling` |
| Alerts | `create_alert`, `list_alerts`, `delete_alert`, `set_alert_active`, `check_alerts_now` |
| Signing and transfers | `send_eth`, `transfer_nft`, `estimate_gas` |
| NFT PnL | `backfill_nft_cost_basis`, `get_nft_pnl`, `set_nft_cost_basis` |
| Etherscan analysis | `find_sister_wallets` |
| Sniping | `create_snipe_rule`, `list_snipe_rules`, `delete_snipe_rule`, `set_snipe_rule_active`, `run_snipe_check` |
| Analytics | `get_portfolio_snapshot`, `get_pnl_summary`, `get_trade_history` |
| Marketplace | `marketplace_list_nft`, `marketplace_place_bid`, `marketplace_cancel_order`, `fetch_collection_nfts`, `fetch_collection_by_contract`, `fetch_collection_stats`, `fetch_collection_events`, `fetch_collection_holders`, `fetch_collection_offers`, `fetch_collection_traits` |
| Subscription/browser | `check_subscription`, `open_external_url` |

`send_eth`, `transfer_nft`, marketplace submissions, cancellations, and key
import/deletion are state-changing or irreversible. They require an explicit
user action and are out of scope for an automated live probe.

## 6. MCP API

`tools/westron-mcp/index.js` exposes the loopback control API as 15 MCP tools:

```text
westron_status                 westron_portfolio
westron_floor_price            westron_list_rules
westron_create_rule            westron_cancel_rule
westron_set_rule_active        westron_snipe_check_now
westron_create_envelope        westron_revoke_envelope
westron_kill_switch            westron_list_alerts
westron_create_alert            westron_delete_alert
westron_scheduler
```

All prices in this API are ETH; collection inputs are Ethereum contract
addresses, not OpenSea slugs. See
[`tools/westron-mcp/README.md`](tools/westron-mcp/README.md) for tool input
schemas and guardrails.

## Known integration gaps

1. **Worker and desktop subscription protocols are incompatible.** The Worker
   requires bearer authentication and signs an account-based payload. The Rust
   subscription client still posts `{wallet}` to `/license` without a bearer
   token and expects top-level `payload` and `sig` fields containing a wallet
   payload. It will receive `401` from the deployed Worker and fall back to an
   old cache. Align both clients to the account/token license contract before
   using subscriptions in production.

2. **The Alchemy REST proxy rewrites do not match the desktop client's valid
   endpoint formats.** Prices omits `/v1` (live `404`); NFT puts the API key
   before `v3`; Portfolio Data omits `/v1/{key}`. Update the proxy's route
   construction and add integration tests per family.

3. **The MCP smoke test cannot start its child shim from this path.**
   `index.js` compares `process.argv[1]` to `new URL(import.meta.url).pathname`.
   Any path component needing percent-encoding (a space becomes `%20`) makes the
   direct-run comparison false and the child exits immediately. This was observed
   under the old `Cowork Projects` path; the project now lives at
   `/Users/byronic/Developer/westron`, which has no spaces, so the symptom is
   masked — but the comparison is still wrong and must be fixed. Use
   `fileURLToPath(import.meta.url)` for the comparison, then rerun
   `node tools/westron-mcp/smoke.mjs`.

4. **The live proxy test is representative, not complete endpoint coverage.**
   It verified one safe read from each source family. WebSockets, account
   transaction history, authenticated NFT/price/data reads after the proxy fix,
   and every financial mutation still need a staging environment with
   non-production API keys and dedicated test wallets.

## Recommended regression checks

Run these after the integration gaps are addressed:

1. Worker: health, quote, signup/login/me/status/license/logout, expired-token
   rejection, and an invalid HMAC webhook request.
2. Proxy: one JSON-RPC, NFT v3, Prices v1 GET and POST, Portfolio Data v1 POST,
   OpenSea collection/stats/events/offers/traits, and Etherscan `txlist` call.
3. Desktop: execute the Tauri command tests with sandboxed API keys and a
   watch-only test address.
4. MCP: `node tools/westron-mcp/smoke.mjs` must pass all 15 tools and its Rust
   route-table cross-check.

## Author recommendations

1. **Treat the Worker protocol as the contract of record and migrate the
   desktop client to it.** Replace the wallet-based subscription flow with a
   token-backed account session, decode `license.payload` only after verifying
   its signature, and remove the obsolete wallet-payload expectation. This is
   the highest-priority correctness issue because a valid live subscription
   cannot currently be refreshed by the desktop client.

2. **Make Alchemy proxy routing explicit instead of generic.** Use separate
   handlers for RPC, NFT v3, Prices v1, and Data v1 so the version and API-key
   placement are unambiguous. Add a test for each handler using one harmless
   known-address request. Do not ship the proxy as an alternative client path
   until NFT, Prices, and Data all pass live checks.

3. **Choose one API-key architecture.** The repository currently supports
   both locally stored provider keys and a subscription-gated Worker proxy.
   Decide which is the supported production path, document the privacy and
   quota implications, and remove or complete the other path. Keeping both
   half-integrated makes failures difficult to diagnose and increases the
   security review surface.

4. **Add a non-production integration environment.** Create provider keys,
   test wallets, a Worker D1 database, and an account-cleanup mechanism that
   are dedicated to automated tests. This enables coverage of login/logout,
   license refresh, WebSocket subscriptions, account-history reads, and
   signed-order workflows without leaving probe accounts in production or
   risking real assets.

5. **Fix and gate the MCP smoke test in CI.** Normalize the ESM module path
   with `fileURLToPath`, then run `node tools/westron-mcp/smoke.mjs` on every
   change to the shim or control routes. The test already validates every MCP
   route against the Rust router, so it is a strong compatibility guard once it
   starts successfully.

6. **Publish a machine-readable HTTP contract.** Keep this guide for humans,
   but add an OpenAPI document for the Worker and loopback control APIs.
   Generate request/response examples from tests and label every mutating or
   financial endpoint explicitly. This will make future desktop, MCP, and
   external integrations less likely to drift apart.
