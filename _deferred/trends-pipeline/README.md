# @westron/trends-pipeline

Real-time crypto/NFT trend detection pipeline. Polls X and TikTok on 1-minute cycles, extracts signals, enriches with on-chain data, and delivers alerts via WebSocket and Telegram.

## Setup

```bash
# 1. Install dependencies
bun install

# 2. Copy env and fill in API keys
cp .env.example .env

# 3. Start infrastructure
docker compose -f docker/docker-compose.yml up -d postgres redis

# 4. Run migrations
bun run migrate up

# 5. Start pipeline (dry run by default)
bun run dev
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X_BEARER_TOKEN` | Yes | X API Basic tier Bearer Token |
| `X_OAUTH_CONSUMER_KEY` | No | For OAuth2 user context |
| `X_OAUTH_CONSUMER_SECRET` | No | For OAuth2 user context |
| `SCRAPECREATORS_API_KEY` | Yes | TikTok ingestion via ScrapeCreators |
| `RESERVOIR_API_KEY` | Yes | NFT floor/volume data |
| `OPENSEA_API_KEY` | No | Reuse from Westron main app |
| `ANTHROPIC_API_KEY` | Yes | Claude Haiku signal extraction |
| `TELEGRAM_BOT_TOKEN` | Yes | Mobile alert fallback |
| `TELEGRAM_USER_ID` | Yes | Your Telegram numeric ID |
| `POSTGRES_URL` | Yes | TimescaleDB connection string |
| `REDIS_URL` | Yes | Redis connection string |
| `XMCP_URL` | No | xmcp MCP server for agent queries |
| `DRY_RUN` | No | `true` = no WS/Telegram push (default: true) |

## Architecture

```
X API (1-min polling) ──┐
                         ├── Signal Extraction ── Enrichment ── Velocity Scoring ── Alerts
TikTok (1-min polling) ──┘                                            │
                                                                       ├── WebSocket → Westron UI
PFP Tracker (30-min) ──────────────────────────────────────────────────└── Telegram → Mobile
```

See `/docs/trends-architecture.md` in the root for full diagram.

## Agent MCP Config

To use xmcp for ad-hoc agent queries, add to `.mcp.json`:

```json
{
  "mcpServers": {
    "xmcp": {
      "url": "http://localhost:8001/mcp"
    }
  }
}
```

Then start xmcp: `docker compose -f docker/docker-compose.yml up xmcp`

## Monthly Cost Baseline

| Service | Cost |
|---------|------|
| X API Basic | $200 |
| ScrapeCreators | $30-50 |
| Anthropic (Haiku) | $20-40 |
| Reservoir | $0 (free tier) |
| Dexscreener | $0 (public) |
| VPS (4-8GB) | $20-30 |
| **Total** | **~$270-320** |
