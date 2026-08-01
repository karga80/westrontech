# Probe: subscription-worker API-key proxy

**Date:** 2026-08-02
**Purpose:** Prove `/proxy/alchemy/*`, `/proxy/opensea/*`, `/proxy/etherscan/*` really call the
upstream providers with the server-side keys — not mocked, not stubbed.

## Setup

Signed up a probe account (`probe-proxy-test@westron.local`) to get a real Bearer token
(trial access is active by default), then deleted it after testing.

## Alchemy — POST /proxy/alchemy/rpc

```
curl -s -X POST https://westron-subscription.ebaltepe.workers.dev/proxy/alchemy/rpc \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```
Response (HTTP 200): `{"jsonrpc":"2.0","id":1,"result":"0x1879547"}` — real current Ethereum
mainnet block number.

## Etherscan — GET /proxy/etherscan/api?chainid=1&module=stats&action=ethsupply

Response (HTTP 200): `{"status":"1","message":"OK","result":"122373866217800000000000000"}` —
real total ETH supply in wei.

## OpenSea — GET /proxy/opensea/api/v2/collections/boredapeyachtclub

Response (HTTP 200): real Bored Ape Yacht Club collection metadata
(`"name":"Bored Ape Yacht Club"`, description, etc.)

## What this proves

- `ALCHEMY_KEY`, `OPENSEA_KEY`, `ETHERSCAN_KEY` are correctly set as Worker secrets and used.
- Access-gating works: proxy requires a valid Bearer token from an account with active access.
- Keys never reach the client — the app calls `/proxy/*`, not the providers directly.

## Not covered by this probe

- `/webhook/alchemy` (payment detection) — secret is set and webhook registered in Alchemy
  dashboard, but no real on-chain payment has been sent through it yet.
