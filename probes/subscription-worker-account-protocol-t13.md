# Probe: T13 — account/bearer-token subscription protocol, end-to-end against the live worker

**Date:** 2026-08-10
**Endpoint:** `https://westron-subscription.ebaltepe.workers.dev`
**Purpose:** Prove the rewritten Rust client (`src-tauri/src/subscription/mod.rs`) talks the
*same* protocol the deployed worker actually speaks — signup → license → bearer-auth →
signature verification against the embedded public key — not the old wallet-based shape.

Test account: `probe-t13-<random hex>@westron.local` (random suffix generated with
`openssl rand -hex 4`, password redacted below). **Deleted from the live D1 database
(`westron-db`) after this probe** — see cleanup section.

## 1. Signup — `POST /signup`

```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"probe-t13-9966636f@westron.local","password":"[REDACTED]"}'
```

Response (HTTP 201):

```json
{
  "token": "[REDACTED]",
  "account": {
    "id": "f0e5506b-1351-4ff7-9a2c-dcd662e5932f",
    "email": "probe-t13-9966636f@westron.local",
    "trial_expires_at": 1786953098
  },
  "access": { "active": true, "reason": "trial", "plan": "trial", "expires_at": 1786953098 },
  "license": {
    "payload": "{\"account_id\":\"f0e5506b-1351-4ff7-9a2c-dcd662e5932f\",\"email\":\"probe-t13-9966636f@westron.local\",\"active\":true,\"reason\":\"trial\",\"plan\":\"trial\",\"expires_at\":1786953098,\"issued_at\":1786348298}",
    "sig": "hdJqhdfVeM3JyM88ywztJ7k2elGRf5FamG7qbZGpyFVlmmu6TkHCIY6hu6GKMFnd7TSwj35PLAjb8ysvm6dsDA=="
  }
}
```

Matches exactly what `AuthResponse` + embedded `Payload` in the new `subscription/mod.rs`
deserialize: `token`, `account.id`, `license.{payload,sig}`, and the JSON string inside
`payload` is `{account_id, email, active, reason, plan, expires_at, issued_at}` — no `wallet`
field anywhere.

## 2. License refresh with bearer token — `POST /license`

```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/license \
  -H "Authorization: Bearer [REDACTED]"
```

Response (HTTP 200):

```json
{
  "access": { "active": true, "reason": "trial", "plan": "trial", "expires_at": 1786953098 },
  "license": {
    "payload": "{\"account_id\":\"f0e5506b-1351-4ff7-9a2c-dcd662e5932f\",\"email\":\"probe-t13-9966636f@westron.local\",\"active\":true,\"reason\":\"trial\",\"plan\":\"trial\",\"expires_at\":1786953098,\"issued_at\":1786348306}",
    "sig": "zpWFpTG67hOGAM8XYhfWvbBqJAAb1INwTmxaP9Ys3bsdejl8r4WY1WT1YkTeuzb6SK3uqV2QgxkO2SiLV9KIBg=="
  }
}
```

Confirms `fetch_license()`'s expected `{access, license}` shape (top-level, not the old
`{active, payload, sig}` shape) and confirms the endpoint requires the `Authorization: Bearer`
header — the client's new request now sends it (the old client never did, which is why the
worker was returning 401 to every real check before this fix).

## 3. Rejected bad token — `POST /license` with a garbage bearer token

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://westron-subscription.ebaltepe.workers.dev/license \
  -H "Authorization: Bearer garbage"
```

Response: `401`

Confirms the `FetchOutcome::Unauthorized` branch in `evaluate()` (clears the stored token and
tells the user to log in again, rather than silently falling back to a stale cache) is reachable
with real worker behavior, not just a hypothetical code path.

## 4. Login — `POST /login`

```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/login \
  -H "Content-Type: application/json" \
  -d '{"email":"probe-t13-9966636f@westron.local","password":"[REDACTED]"}'
```

Response (HTTP 200): same shape as `/signup` (`token`, `account`, `access`, `license`), new
token value, same `account.id`. Confirms `login()` and `signup()` in the Rust client can share
one response-parsing path (`AuthResponse`), which they do.

## 5. Signature verification against the embedded public key

The exact `payload`/`sig` pair from step 2 was fed into the real `verify()` function in
`src-tauri/src/subscription/mod.rs` via a temporary `#[test]` (added, run, then deleted — not
part of the committed code) asserting `verify(&license).is_ok()` and
`payload.account_id == "f0e5506b-…"`. Result:

```
test subscription::live_probe_temp::live_worker_license_verifies_against_embedded_public_key ... ok
```

This proves `LICENSE_PUBLIC_KEY_B64` in `mod.rs` is the correct public counterpart to the
worker's live `LICENSE_SIGNING_KEY` secret — this could only be confirmed by an actual live
signature, not by reading source.

## Cleanup

```
npx wrangler d1 execute westron-db --remote --command "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='probe-t13-9966636f@westron.local')"
npx wrangler d1 execute westron-db --remote --command "DELETE FROM subscriptions WHERE user_id IN (SELECT id FROM users WHERE email='probe-t13-9966636f@westron.local')"
npx wrangler d1 execute westron-db --remote --command "DELETE FROM users WHERE email='probe-t13-9966636f@westron.local'"
```

All three ran successfully (`changed_db: true`, 1 user row + its session/subscription rows
removed). Verified gone with a follow-up `SELECT count(*)` — `rows_read: 0`.

## What this probe does NOT cover

- The Tauri commands (`subscription_signup`, `subscription_login`, `check_subscription`) were
  **not** exercised through the actual running desktop app / webview in this session — only the
  underlying `subscription::signup/login/evaluate` Rust functions were proven correct against
  the live worker via direct HTTP calls mirroring exactly what those functions send. The
  Keychain-backed token storage (`store_subscription_token`/`fetch_subscription_token`) was
  exercised only by unit tests with the file-backed non-macOS fallback (`cargo test`), not by an
  actual macOS Keychain write in a running app — that requires clicking through the real UI,
  which is frontend work tracked separately (see `STATUS.md`).
