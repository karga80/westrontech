# Westron — MOCKS registry

Everything currently fake or not-yet-live, and what's needed to make it real.
Empty section = that area is real. Update whenever something moves from mock → real or vice versa.

## Subscription worker

All 5 secrets are set (`LICENSE_SIGNING_KEY`, `ALCHEMY_WEBHOOK_SECRET`, `ALCHEMY_KEY`,
`OPENSEA_KEY`, `ETHERSCAN_KEY`) and the Alchemy address-activity webhook is registered.

- Account signup/login/trial/license issuance: **real**, verified with a live request
  (`probes/subscription-worker-signup.md`).
- **Desktop client protocol (T13, 2026-08-10): fixed, real end-to-end at the Rust layer.**
  Until this session `src-tauri/src/subscription/mod.rs` still spoke the *old* wallet-based
  protocol (`POST /license {wallet}`, no `Authorization` header, expected top-level
  `{active, payload, sig}`) against a worker that had moved to account/bearer-token auth
  (`POST /signup`/`POST /login` → `{token,...}`, `POST /license` requires
  `Authorization: Bearer <token>`, returns `{access, license:{payload, sig}}`). Every real check
  from the desktop app was getting a `401` and silently falling back to a stale/no cache — **no
  real subscription could ever be confirmed on desktop.** Rewritten to the real protocol: new
  `subscription::signup`/`login`/`logout`/`evaluate` functions, `Payload` now matches the
  worker's account-shaped JSON (no `wallet` field, old shape is structurally rejected — see
  `old_wallet_shaped_payload_is_rejected` test), token stored via new Keychain wrapper
  (`store_subscription_token`). Verified against the **live deployed worker**: real signup, real
  bearer-authenticated `/license` fetch, real 401 on a bad token, real login, and the returned
  signature verified against the embedded public key — see
  `probes/subscription-worker-account-protocol-t13.md`. Test account created and deleted from
  the live D1 database after the probe.
  **Frontend updated (T13, same day):** `src/lib/tauri.ts`'s `checkSubscription` is now a
  zero-arg call matching the Rust command, plus new `subscriptionSignup`/`subscriptionLogin`/
  `subscriptionLogout`/`subscriptionCurrentAccount` wrappers. `src/app/settings/page.tsx`'s
  Billing section has a plain email/password sign-up/log-in/log-out form (unstyled is fine, per
  task scope) and no longer reads a wallet address for the check. `npx tsc --noEmit` is clean.
  **Verified end-to-end by real clicking (10.08.2026, `vera` then `orion`):** Sign Up, Check
  Status, Log Out all confirmed working in the running desktop app against the live worker.
  Log In was initially flaky (real 401 on first attempt, succeeded on manual retry) — traced
  to an untrimmed password field, fixed in `05a8b60`, then re-verified with 4 real Log In
  attempts (2 typed, 2 pasted with injected leading/trailing whitespace and a trailing
  newline, deliberately targeting the suspected defect) — all 4 succeeded, 0 retries needed.
  Test accounts created during verification were deleted from the live D1 database
  afterward. This item is fully done end-to-end, not just typechecked.
- API-key proxy (`/proxy/alchemy/*`, `/proxy/opensea/*`, `/proxy/etherscan/*`): **real**, each
  provider verified with a live authenticated request returning real data (real block number,
  real ETH supply, real BAYC collection data). See `probes/subscription-worker-proxy.md`.
  **T14 (2026-08-10):** the Alchemy NFT/Prices/Portfolio-Data route families were building the
  wrong upstream URL (missing `v3`/`v1` segments, wrong key placement) and failed live with
  401/404/400. Fixed to match `src-tauri/src/data/alchemy/client.rs`'s verified shapes, deployed,
  re-verified live for all three families — see `probes/subscription-worker-alchemy-proxy-routes-t14.md`.
  Desktop app doesn't use this proxy today (talks to Alchemy directly), so this had no live-user
  impact, but it's now correct if the proxy path is adopted later.
- Payment webhook (`/webhook/alchemy`): secret is set and webhook is registered in the Alchemy
  dashboard, but **not yet proven with a real on-chain payment** — no test ETH has been sent
  through it. Treat as configured-but-unverified until a real (or testnet) payment round-trips.

## Sniping & automation

Per `README.md`: sniping executes in **simulation** by design for this phase — this is
labeled and intentional, not a hidden fake. Real on-chain execution is a later, separately-gated
step.

## 2026-08-02: dashboard/UI mock-facade cleanup

Emir reported "dashboard is full of mock / wrong datas." Audit confirmed it — 9 screens had
hardcoded fixture data silently shown as if real whenever live API data was empty/not-yet-loaded
(fake wallets, fake USD balances, fake transaction history, fake collection stats, fake PnL).
Fixed in this session across 11 files (3 renames + 8 files with real fake-data removal):
`src/app/page.tsx`, `bulk/cancel`, `bulk/bulk-bid`, `bulk/list`, `monitor/collection`,
`monitor/wallet`, `wallet/page.tsx`, `wallet/[id]/WalletDetailClient.tsx`, `portfolio/analytics`,
plus cosmetic renames in `gallery/page.tsx` and `wallets/page.tsx`. All fake fallbacks now show
`'—'` / empty-state UI instead. `npx tsc --noEmit` clean. **Not committed yet** — pending review.

### Still fake / not wired to real data (found during this audit, NOT fixed — separate scope)

- **`monitor/wallet/page.tsx`**: the P&L tab (`TOKEN_PNL`, KPI row, chart), Recent Trades tab
  (`RECENT_TRADES`), and Related-Wallets bubble map are entirely fabricated with **no real data
  source wired at all** — not a fallback issue, the feature was never built against a real API.
  Needs real PnL/trade-history/wallet-graph computation as a new work item.
- **`wallet/[id]/WalletDetailClient.tsx` → `TransferModal.confirmTransfer()`**: fabricates a fake
  tx hash via `Math.random()` and marks the transfer "confirmed" with **no real signing or
  broadcast** — this is a financial-action simulation, same category as sniping's
  `0xSIMULATED_...` hash but was previously undisclosed. **Must not be touched without Emir's
  explicit sign-off** per the workspace hard-stop rule (anything that moves funds). Flagged here,
  not fixed.

## Anything not listed here

Not audited this session beyond the above — do not assume "not listed = real." Cross-check
`README.md` and `STATUS.md` before relying on any specific feature being live.

## 2026-08-09: kalan mock'lar kapatıldı

Önceki turda "ayrı kapsam" diye bırakılan iki madde de kapandı.

- **`monitor/wallet`** P&L / Recent Trades / Related-Wallets: artık gerçek —
  `get_trade_history`, `get_pnl_summary`, `get_nft_pnl`, `find_sister_wallets`.
  Bubble map kenarları gerçek transfer SAYISI ("N tx"), uydurma para akışı değil.
- **`wallet/[id]` TransferModal**: sahte `Math.random()` hash'i **kaldırıldı**. Emir'in
  açık onayıyla gerçek `send_eth`'e bağlandı. Zorunlu guard'lar: aktif envelope,
  kill switch kapalı, süresi dolmamış, scope içinde, `preview_transaction` ön kontrolü
  (sıfır yan etkili), tam adres onayı, "SEND" yazma, çift tıklama kilidi.
  Sadece backend'in döndürdüğü GERÇEK hash gösterilir; nihai durum "Broadcast — pending
  on-chain", asla "confirmed" değil. **Çoklu hedef bilerek kapalı** (ayrı onay gerektirir).
- **`bulk/distribute`**: gönderim yolu YOK ve bağlanmadı. Adım 3 artık "Not sent" diyor.
- **`monitor/collection`**: sahte alım/teklif sonuçları silindi, kontroller gerekçeli kapalı.

Hâlâ simüle: sniping (tasarım gereği), marketplace list/bid UI'da bağlanmadı.
