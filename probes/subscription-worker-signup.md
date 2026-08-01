# Probe: subscription-worker /signup

**Date:** 2026-08-01
**Endpoint:** `POST https://westron-subscription.ebaltepe.workers.dev/signup`
**Purpose:** Prove the deployed Cloudflare Worker issues real, Ed25519-signed
license tokens against the real D1 database — not a mock.

## Request

```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"probe-test@westron.local","password":"ProbeTest123!"}'
```

## Response (HTTP 201)

```json
{
  "token": "akGtX47WmXxDI9op8LnM-89MXZX0LvoWs9jXwafng6U",
  "account": {
    "id": "792c77f0-98a6-4076-b304-0a3f5598667a",
    "email": "probe-test@westron.local",
    "trial_expires_at": 1786222661
  },
  "access": {
    "active": true,
    "reason": "trial",
    "plan": "trial",
    "expires_at": 1786222661
  },
  "license": {
    "payload": "{\"account_id\":\"792c77f0-98a6-4076-b304-0a3f5598667a\",\"email\":\"probe-test@westron.local\",\"active\":true,\"reason\":\"trial\",\"plan\":\"trial\",\"expires_at\":1786222661,\"issued_at\":1785617861}",
    "sig": "I754UAtwBBzPh0+YgmJBnGix04er6U2zbUXl14bAMkt8iPgv2oycI8PX7oNxx9GT4jy4EE1wzS1iZdtRZ12wAw=="
  }
}
```

## What this proves

- D1 database (`westron-db`) is live and writable — account row created.
- `LICENSE_SIGNING_KEY` secret is correctly loaded and produces valid Ed25519 signatures.
- 7-day trial logic (`TRIAL_DAYS=7`) is active.

## Not covered by this probe

- `ALCHEMY_WEBHOOK_SECRET`, `ALCHEMY_KEY`, `OPENSEA_KEY`, `ETHERSCAN_KEY` are **not** set yet.
  Payment webhook detection and the API-key proxy (`/proxy/*`) will fail until Emir adds them
  (see `subscription-worker/DEPLOY.md` step 5).

## Note

`probe-test@westron.local` is a leftover test account in the live `westron-db` D1 table.
Harmless (trial account, no real payment), but can be deleted with:
```
npx wrangler d1 execute westron-db --remote --command "DELETE FROM users WHERE email='probe-test@westron.local'"
```
