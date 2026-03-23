-- Whisper — D1 (SQLite) Schema
-- Apply with: wrangler d1 execute whisper --file=d1/schema.sql
-- For local dev: wrangler d1 execute whisper --local --file=d1/schema.sql

CREATE TABLE IF NOT EXISTS entities (
  entity_id    TEXT PRIMARY KEY,
  ghost_name   TEXT NOT NULL,
  display_name TEXT,
  photo_url    TEXT,
  sigil_params TEXT,              -- JSON string
  trust_token  TEXT NOT NULL,
  expiry       TEXT NOT NULL DEFAULT '24h',
  note_count   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS whispers (
  id           TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  sender_id    TEXT NOT NULL,
  sender_ghost TEXT NOT NULL,
  text         TEXT NOT NULL,
  admire       TEXT,
  appreciate   TEXT,
  wish         TEXT,
  status       TEXT NOT NULL DEFAULT 'antechamber',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outbound_log (
  id              TEXT PRIMARY KEY,
  sender_id       TEXT NOT NULL,
  recipient_id    TEXT NOT NULL,
  recipient_ghost TEXT NOT NULL,
  text            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'sent',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limits (
  sender_id TEXT NOT NULL,
  sent_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_whispers_recipient ON whispers(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_whispers_sender    ON whispers(sender_id);
CREATE INDEX IF NOT EXISTS idx_outbound_sender    ON outbound_log(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_sender        ON rate_limits(sender_id, sent_at DESC);
