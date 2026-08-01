# Westron — MOCKS registry

Everything currently fake or not-yet-live, and what's needed to make it real.
Empty section = that area is real. Update whenever something moves from mock → real or vice versa.

## Subscription worker

- **Payment webhook (Alchemy address-activity) — not live.** `ALCHEMY_WEBHOOK_SECRET` is not
  set as a Worker secret yet. Requests to `/webhook/alchemy` will fail signature verification.
  Needs: Emir sets the secret + registers the webhook in the Alchemy dashboard.
  See `subscription-worker/DEPLOY.md` step 7.
- **API-key proxy (`/proxy/*` — Alchemy/OpenSea/Etherscan) — not live.** `ALCHEMY_KEY`,
  `OPENSEA_KEY`, `ETHERSCAN_KEY` are not set as Worker secrets yet. Requests will fail (missing
  env value used in upstream URL/header). Needs: Emir sets the 3 secrets.
- Account signup/login/trial/license issuance: **real**, verified this session
  (`probes/subscription-worker-signup.md`).

## Sniping & automation

Per `README.md`: sniping executes in **simulation** by design for this phase — this is
labeled and intentional, not a hidden fake. Real on-chain execution is a later, separately-gated
step. Not re-verified this session; flagged here so it stays visible until it's wired to real
submission.

## Anything not listed here

Not audited this session — do not assume "not listed = real." Cross-check `README.md` and
`STATUS.md` before relying on any specific feature being live.
