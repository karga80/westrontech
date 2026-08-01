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
step. Not re-verified this session; flagged here so it stays visible until it's wired to real
submission.

## Anything not listed here

Not audited this session — do not assume "not listed = real." Cross-check `README.md` and
`STATUS.md` before relying on any specific feature being live.
