CREATE TABLE IF NOT EXISTS players (
  discord_id TEXT PRIMARY KEY,
  minecraft_username TEXT NOT NULL,
  discord_avatar_url TEXT,
  verified_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS test_results (
  id BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL REFERENCES players(discord_id) ON DELETE CASCADE,
  tester_discord_id TEXT NOT NULL,
  minecraft_username TEXT NOT NULL,
  discord_avatar_url TEXT,
  region TEXT NOT NULL,
  mode_id TEXT NOT NULL,
  mode_name TEXT NOT NULL,
  previous_tier TEXT,
  earned_tier TEXT NOT NULL,
  requested_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ NOT NULL,
  ticket_channel_id TEXT,
  skin_render_url TEXT NOT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_test_results_closed_at
  ON test_results (closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_results_mode_closed_at
  ON test_results (mode_id, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_test_results_player_mode_closed_at
  ON test_results (discord_id, mode_id, closed_at DESC);

CREATE TABLE IF NOT EXISTS waitlist_snapshots (
  mode_id TEXT PRIMARY KEY,
  mode_name TEXT NOT NULL,
  open BOOLEAN NOT NULL,
  queue JSONB NOT NULL DEFAULT '[]'::jsonb,
  waitlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_testers JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_tests JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
