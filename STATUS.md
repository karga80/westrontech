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

## Blocked — Emir'in yapması gerekenler

1. **4 secret eksik** — bunlar olmadan ödeme tespiti ve API-key proxy çalışmaz (login/signup/trial çalışır, bunlar etkilenmez):
   ```
   npx wrangler secret put ALCHEMY_WEBHOOK_SECRET   # Alchemy dashboard → Webhooks → Address Activity → Signing Key
   npx wrangler secret put ALCHEMY_KEY               # alchemy.com hesabından
   npx wrangler secret put OPENSEA_KEY                # docs.opensea.io üzerinden başvuru
   npx wrangler secret put ETHERSCAN_KEY              # etherscan.io/apis
   ```
   (Detaylı adımlar: `subscription-worker/DEPLOY.md` adım 5 ve 7.)
2. Secret'lar girildikten sonra Alchemy webhook'unu kaydet (adım 7, aynı dosyada) — ödeme algılama bu olmadan çalışmaz.
3. App'i yeniden derleyip (`npm run dev:tauri` veya release build) yeni `WORKER_URL` ile gerçek bir signup/login denemesi yap.

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
- Still untracked / needs a decision: `_arch.tar.gz`, `_faz1.tar.gz` at repo root (leftover backup
  archives, not created this session — left alone, ask Emir before deleting).
- `subscription-worker/schema.sql` and `package-lock.json` are untracked in git — should be
  committed (schema.sql is required to reproduce the D1 tables; package-lock.json pins deps).
  Not committed automatically per workflow rules — do this in the next commit.
