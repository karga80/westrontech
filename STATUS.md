# Westron — STATUS

Live truth. Disk and git win over this file if they disagree — fix this file, not your assumptions.
Full feature/architecture overview: `README.md`. This file tracks what's proven vs mock vs blocked.

## Subscription backend (Cloudflare Worker) — this session, verified

- **Deployed and live:** `https://westron-subscription.ebaltepe.workers.dev`
- **D1 database (`westron-db`) is real and confirmed:** 4 tables present (`users`,
  `subscriptions`, `payer_wallets`, `sessions`) — verified with
  `wrangler d1 execute ... SELECT name FROM sqlite_master`.
- **Account signup + Ed25519 license issuance is real, not mocked.** Proven with a live
  `POST /signup` call, real HTTP 201, real signed license. See `probes/subscription-worker-signup.md`.
- **`WORKER_URL` in `src-tauri/src/subscription/mod.rs` now points at the deployed worker**
  (was a `YOUR_SUBDOMAIN` placeholder). `cargo check` passes after the change.
- Not yet verified end-to-end: full app flow (Tauri UI → worker → license stored/used).
  This session only proved the worker itself via curl, not the app calling it.

## Update (2026-08-02): all 5 secrets set, proxy verified live

All Worker secrets are now set (`LICENSE_SIGNING_KEY`, `ALCHEMY_WEBHOOK_SECRET`, `ALCHEMY_KEY`,
`OPENSEA_KEY`, `ETHERSCAN_KEY`) and the Alchemy address-activity webhook is registered.
API-key proxy verified live for all 3 providers — see `probes/subscription-worker-proxy.md`.

One mid-session error caught and fixed: the Etherscan key was first entered as the *secret name*
instead of its value (`npx wrangler secret put <the-key-itself>` instead of
`npx wrangler secret put ETHERSCAN_KEY`), which briefly exposed it in `wrangler secret list`
output. Deleted the bad entry and rotated the Etherscan key before re-entering it correctly.

## Blocked — Emir'in yapması gerekenler

1. App'i yeniden derleyip (`npm run dev:tauri` veya release build) yeni `WORKER_URL` ile gerçek bir signup/login denemesi yap.
2. Ödeme webhook'u henüz gerçek bir ödemeyle test edilmedi — ilk gerçek (veya testnet) ödeme geçtiğinde `/webhook/alchemy`'nin hesabı doğru aktif ettiğini doğrula.

## Everything else (sniping, portfolio, marketplace, etc.)

Not touched or re-verified this session. Per `README.md` and prior `MEMORY.md` notes: sniping
executes in simulation by design (explicitly gated, not claimed as done), key storage uses
local files + a Keychain module (`src-tauri/src/wallet/keychain.rs` exists, not re-audited here).
Treat those notes as **not re-verified** until a session actually checks them again.

## Update (2026-08-02, later): dashboard mock-data cleanup

Emir: "dashboard is full of mock / wrong datas." Confirmed and fixed — 11 files across the app
had hardcoded fixture data (fake wallets, balances, transactions, collection stats, PnL) that
displayed as if real whenever live data was empty. All replaced with `'—'` / honest empty states.
`npx tsc --noEmit` passes clean. **Changes are NOT committed** — review then ask to commit.
Full list and 2 flagged-but-not-fixed items (Monitor Wallet's PnL/Trades/Related-Wallets tabs
have no real backend at all; `WalletDetailClient`'s transfer confirm fakes a tx hash — financial,
needs explicit approval) are in `MOCKS.md`.

Recommended verification for Emir: run the app (`npm run dev:tauri`), open the dashboard with a
wallet that has zero transactions — it should show "No transactions yet." instead of 15 fake rows.

## Update (2026-08-03): two real bugs fixed — wallet refresh + transaction history

Both fixed, both compile clean, **neither committed** — review then ask to commit.

**1. Dashboard didn't show a newly added wallet until reload** (`src/app/page.tsx`)
The dashboard's own `AddWalletModal` wrote the wallet to `localStorage` but never told the
dashboard to re-read it, so the new card only appeared after a page reload. `/wallets` already
did this correctly via an `onAdded` callback — applied the same pattern to the dashboard.

**2. Wallet detail showed stale/incomplete transaction history**
(`src-tauri/src/rpc/client.rs`, `get_asset_transfers` — feeds both the dashboard tx table and
the wallet-detail Transactions tab). Two defects in the Alchemy call:
- Only `toAddress` was queried, so **sent transactions never appeared** — incoming only.
- No `order` param with `fromBlock: 0x0` + `maxCount: 100`. Alchemy defaults to *ascending*,
  so any wallet with >100 transfers got its **oldest 100 transfers since genesis**, never recent
  activity. That is the "not up to date" symptom.

Fix: queries incoming + outgoing in parallel with `"order": "desc"`, merges, dedupes by tx hash
(self-transfers appear in both), sorts by block descending, keeps the 100 most recent.
`cargo check` passes — no new warnings.

**Not verified in the running app yet.** Emir should open a wallet with real history →
Transactions tab → confirm recent activity appears, including sent txs, not just received.

## NEXT SESSION STARTS HERE — price poller is broken

The Tauri log shows this failing continuously, every run, for both providers' symbols:

```
[app_lib::data::realtime::price_poller][WARN] price_poller: transport error:
error sending request for url (https://api.g.alchemy.com/prices/v1/tokens/by-symbol?symbols=USDC&...)
```

That URL has **no API key segment** — Alchemy's prices endpoint is
`https://api.g.alchemy.com/prices/v1/{apiKey}/tokens/by-symbol`. Strong hypothesis, **not yet
probed**: ETH/USDC/USDT/WETH prices never load, which would make portfolio USD values wrong
or zero app-wide.

Per the operating manual, do this before touching app code: **probe the endpoint with curl
first** (real key, real response, saved to `probes/`), confirm the correct URL shape, then fix
`src-tauri/src/data/realtime/price_poller.rs`. Do not assume the docs — call it once for real.

## Housekeeping done this session

- Fixed `.gitignore`: `/node_modules` was root-anchored only, so `subscription-worker/node_modules`
  wasn't ignored. Added `**/node_modules`.
- Deleted the probe test account (`probe-test@westron.local`) from the live D1 `users` table after
  verifying the signup flow.
- `_arch.tar.gz`, `_faz1.tar.gz` (leftover pre-refactor backup archives, fully superseded by
  committed work, no unique content) — confirmed with Emir and deleted.
- `subscription-worker/schema.sql` and `package-lock.json` are untracked in git — should be
  committed (schema.sql is required to reproduce the D1 tables; package-lock.json pins deps).
  Not committed automatically per workflow rules — do this in the next commit.
