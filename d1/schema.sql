-- Whisper — D1 (SQLite) Schema
-- Apply with: wrangler d1 execute whisper --remote --file=d1/schema.sql

CREATE TABLE IF NOT EXISTS entities (
  entity_id    TEXT PRIMARY KEY,
  ghost_name   TEXT NOT NULL,
  display_name TEXT,
  photo_url    TEXT,
  sigil_params TEXT,              -- JSON string
  trust_token               TEXT NOT NULL,
  circle_question           TEXT,
  circle_question_expires_at TEXT,
  room_open_until           TEXT,
  expiry                    TEXT NOT NULL DEFAULT '24h',
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
  from_circle  INTEGER NOT NULL DEFAULT 0,
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

-- Trust circle: owner_id = the person who shared the link
-- member_id = entity_id (SHA-256 of email) of the person who joined
-- member_id is a deduplication key only — never exposed
CREATE TABLE IF NOT EXISTS trust_circle (
  owner_id   TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (owner_id, member_id)
);

-- Token ledger: one row per entity
-- balance   = current spendable tokens (max 5)
-- accrued_date = the calendar date tokens were last added (UTC)
-- circle_size_snapshot = circle size at last accrual (for lazy recalc)
CREATE TABLE IF NOT EXISTS token_ledger (
  entity_id             TEXT PRIMARY KEY REFERENCES entities(entity_id) ON DELETE CASCADE,
  balance               INTEGER NOT NULL DEFAULT 0,
  accrued_date          TEXT NOT NULL DEFAULT (date('now')),
  circle_size_snapshot  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_whispers_recipient ON whispers(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_whispers_sender    ON whispers(sender_id);
CREATE INDEX IF NOT EXISTS idx_outbound_sender    ON outbound_log(sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trust_circle_owner  ON trust_circle(owner_id);
CREATE INDEX IF NOT EXISTS idx_trust_circle_member ON trust_circle(member_id);

-- Circle requests: someone found a trust link and asked to join
-- name = what they said their name is (display only, not verified)
-- requester_id = SHA-256 hash of their email (never stored as plaintext)
CREATE TABLE IF NOT EXISTS circle_requests (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  requester_id  TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(owner_id, requester_id)
);
CREATE INDEX IF NOT EXISTS idx_circle_requests_owner ON circle_requests(owner_id, status);

-- One-time invite links: auto-accept on first use, falls back to approval queue on reuse
CREATE TABLE IF NOT EXISTS invite_links (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  used_by    TEXT,
  used_at    TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_links_owner ON invite_links(owner_id);

-- Rate limiting: tracks request counts per IP per key (pruned on access)
CREATE TABLE IF NOT EXISTS rate_limits (
  id           TEXT PRIMARY KEY,  -- '{key}:{ip}'
  count        INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL   -- unix timestamp of first request in window
);
