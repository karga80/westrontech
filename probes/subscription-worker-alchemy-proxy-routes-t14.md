# Probe: subscription-worker Alchemy proxy route fix (T14)

**Date:** 2026-08-10
**Purpose:** Prove the T14 fix to `handleProxy` in `subscription-worker/src/index.ts` — three
Alchemy route families (NFT, Portfolio Data, Prices) were building the wrong upstream URL and
failing live. Fixed to match the already-verified shapes in
`src-tauri/src/data/alchemy/client.rs`, deployed, and re-tested against the live worker.

## What was wrong

- **NFT:** proxy built `nft/{KEY}/<path>`, missing the `v3` segment. Correct: `nft/v3/{KEY}/<path>`.
- **Prices:** proxy built `prices/<path>` (dropped `v1`). Correct: `prices/v1/<path>` (Bearer auth,
  no key in path).
- **Portfolio Data:** proxy built `data/<path>` with a Bearer header. Correct: `data/v1/{KEY}/<path>`
  — key goes in the URL path, not a Bearer header, for this API family.

## Fix

`subscription-worker/src/index.ts`, `handleProxy()` — each branch now mirrors
`AlchemyHttpClient::nft_v3_base` / `data_v1_base` / `prices_v1_base` exactly. Deployed with
`wrangler deploy` (version `caf9a5b9-75bb-4a62-b78c-50f2d4940f41`).

## Live verification

Signed up a probe account (`probe-t14-test@westron.local`) for a real Bearer token, deleted after.

### NFT — `GET /proxy/alchemy/nft/getContractMetadata?contractAddress=<WETH>`

HTTP 200 — real WETH contract metadata (`"name":"Wrapped Ether"`, `"symbol":"WETH"`, real deploy
block `4719568`).

### Prices — `GET /proxy/alchemy/prices/tokens/by-symbol?symbols=ETH`

HTTP 200 — `{"data":[{"symbol":"ETH","prices":[{"currency":"usd","value":"1905.13", ...}]}]}`, a
real live ETH/USD price.

### Portfolio Data — `POST /proxy/alchemy/data/assets/tokens/by-address` (vitalik.eth address)

HTTP 200 — real token balances and prices for `0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045`
(ETH balance, HOLY, ANON, and other real ERC-20 holdings with live USD prices).

## Note on a transient 404

The very first post-deploy request to the Prices route returned a 404 with a path that looked
like the old (pre-fix) shape. A `wrangler tail`-monitored retry ~10s later returned 200 with the
new shape — this was Cloudflare edge propagation catching up after deploy, not a code defect.
Re-run the same request if you see this immediately after a fresh `wrangler deploy`.

## What this proves

All three previously-broken Alchemy proxy route families now work end-to-end against the live
Alchemy API through the deployed production worker. `npx tsc --noEmit` is also clean.

## Not covered

The desktop app does not call this proxy today (it talks to Alchemy directly with its own key,
see `src-tauri/src/data/alchemy/client.rs`), so this fix has no effect on current live users. It
matters if/when the worker-proxy architecture is adopted (see T15/T16 discussion in
`docs/TASKS.md`).
