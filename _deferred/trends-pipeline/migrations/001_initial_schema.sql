CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Watchlist (user-managed)
CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('ticker','contract','collection','handle')),
  item_value TEXT NOT NULL,
  threshold_tier TEXT NOT NULL DEFAULT 'orange',
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, item_type, item_value)
);

-- Alerts log (hypertable)
CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL,
  emitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alert_type TEXT NOT NULL CHECK (alert_type IN ('memecoin','nft','pfp_cluster')),
  tier TEXT NOT NULL CHECK (tier IN ('yellow','orange','red')),
  identifier TEXT NOT NULL,
  chain TEXT,
  score NUMERIC(10,2) NOT NULL,
  velocity_score NUMERIC(10,2),
  authority_score NUMERIC(10,2),
  onchain_score NUMERIC(10,2),
  confluence_count INT,
  enrichment_data JSONB,
  source_tweets TEXT[],
  PRIMARY KEY (id, emitted_at)
);
SELECT create_hypertable('alerts', 'emitted_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_alerts_identifier ON alerts (identifier, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_tier ON alerts (tier, emitted_at DESC);

-- Mention timeseries (hypertable)
CREATE TABLE IF NOT EXISTS mentions (
  ts TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('x','tiktok')),
  identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('ticker','contract','collection','handle','keyword')),
  author_handle TEXT,
  author_weight NUMERIC(5,2),
  engagement INT,
  post_id TEXT,
  PRIMARY KEY (ts, source, identifier, post_id)
);
SELECT create_hypertable('mentions', 'ts', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_mentions_identifier ON mentions (identifier, ts DESC);

-- Alert outcomes (for backtesting)
CREATE TABLE IF NOT EXISTS alert_outcomes (
  alert_id BIGINT NOT NULL,
  alert_emitted_at TIMESTAMPTZ NOT NULL,
  checkpoint TEXT NOT NULL CHECK (checkpoint IN ('5m','15m','1h','6h','24h')),
  measured_at TIMESTAMPTZ NOT NULL,
  price_or_floor_change_pct NUMERIC(10,2),
  volume_change_pct NUMERIC(10,2),
  classified_outcome TEXT CHECK (classified_outcome IN ('runner','flat','rug','dump')),
  PRIMARY KEY (alert_id, alert_emitted_at, checkpoint),
  FOREIGN KEY (alert_id, alert_emitted_at) REFERENCES alerts(id, emitted_at)
);

-- Influencer weight history
CREATE TABLE IF NOT EXISTS influencer_history (
  handle TEXT NOT NULL,
  effective_date DATE NOT NULL,
  weight NUMERIC(5,2) NOT NULL,
  tier TEXT,
  reason TEXT,
  PRIMARY KEY (handle, effective_date)
);

-- PFP changes log
CREATE TABLE IF NOT EXISTS pfp_changes (
  id BIGSERIAL PRIMARY KEY,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handle TEXT NOT NULL,
  old_image_url TEXT,
  new_image_url TEXT,
  old_collection TEXT,
  new_collection TEXT,
  resolution_confidence NUMERIC(3,2)
);
CREATE INDEX IF NOT EXISTS idx_pfp_changes_handle ON pfp_changes (handle, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pfp_changes_collection ON pfp_changes (new_collection, detected_at DESC)
  WHERE new_collection IS NOT NULL;

-- User preferences (Telegram + WebSocket)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY,
  telegram_chat_id BIGINT,
  default_threshold TEXT DEFAULT 'orange',
  muted_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Daily briefs
CREATE TABLE IF NOT EXISTS daily_briefs (
  id SERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL,
  window_label TEXT NOT NULL,
  payload JSONB NOT NULL,
  stats JSONB
);
CREATE INDEX IF NOT EXISTS idx_daily_briefs_generated_at ON daily_briefs (generated_at DESC);

-- Continuous aggregate: mentions per hour
CREATE MATERIALIZED VIEW IF NOT EXISTS mentions_per_hour
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', ts) AS bucket,
  identifier,
  identifier_type,
  source,
  COUNT(*) AS mention_count,
  SUM(engagement) AS total_engagement
FROM mentions
GROUP BY bucket, identifier, identifier_type, source
WITH NO DATA;

SELECT add_continuous_aggregate_policy('mentions_per_hour',
  start_offset => INTERVAL '1 day',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE);

-- Retention policies
SELECT add_retention_policy('mentions', INTERVAL '90 days', if_not_exists => TRUE);
SELECT add_retention_policy('alerts', INTERVAL '180 days', if_not_exists => TRUE);
