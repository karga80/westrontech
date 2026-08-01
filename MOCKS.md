# Westron — MOCKS registry

Everything currently fake or not-yet-live, and what's needed to make it real.
Empty section = that area is real. Update whenever something moves from mock → real or vice versa.

## Subscription worker

All 5 secrets are set (`LICENSE_SIGNING_KEY`, `ALCHEMY_WEBHOOK_SECRET`, `ALCHEMY_KEY`,
`OPENSEA_KEY`, `ETHERSCAN_KEY`) and the Alchemy address-activity webhook is registered.

- Account signup/login/trial/license issuance: **real**, verified with a live request
  (`probes/subscription-worker-signup.md`).
- API-key proxy (`/proxy/alchemy/*`, `/proxy/opensea/*`, `/proxy/etherscan/*`): **real**, each
  provider verified with a live authenticated request returning real data (real block number,
  real ETH supply, real BAYC collection data). See `probes/subscription-worker-proxy.md`.
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
