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
