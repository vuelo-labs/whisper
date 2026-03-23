-- Whisper — Supabase Schema
-- Run this in the Supabase SQL editor when upgrading from localStorage.
-- Replace storage.js with the Supabase client once this is set up.

-- ── Extensions ──────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Tables ──────────────────────────────────────────────────────────────────

-- Entities: each person's anonymous identity
create table if not exists entities (
  entity_id     text primary key,           -- SHA-256 of email
  ghost_name    text not null,              -- e.g. "Velvet Heron"
  trust_token   text not null,              -- 16-char hex
  expiry        text not null default '24h' check (expiry in ('1h','24h','7d')),
  note_count    integer not null default 0,
  created_at    timestamptz not null default now()
);

comment on table entities is
  'One row per Whisper user. Identified only by the SHA-256 hash of their email — no PII stored.';

-- Whispers: individual messages
create table if not exists whispers (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  text not null references entities(entity_id) on delete cascade,
  sender_id     text not null,              -- hashed sender, may not have own entity row
  sender_ghost  text not null,
  text          text not null check (char_length(text) <= 280),
  admire        text,
  appreciate    text,
  wish          text,
  status        text not null default 'antechamber'
                  check (status in ('antechamber','integrated','released','void')),
  created_at    timestamptz not null default now()
);

comment on table whispers is
  'Each whisper sent to a recipient. Status tracks its lifecycle in the owner''s quiet room.';

-- Outbound log: sender''s private record
create table if not exists outbound_log (
  id             uuid primary key default gen_random_uuid(),
  sender_id      text not null,
  recipient_id   text not null,
  recipient_ghost text not null,
  text           text not null check (char_length(text) <= 280),
  status         text not null default 'sent' check (status in ('sent','void')),
  created_at     timestamptz not null default now()
);

comment on table outbound_log is
  'Private sender log. Visible only to the sender (via their entity_id).';

-- Rate limiting: track send counts per sender per 30-day window
create table if not exists rate_limits (
  sender_id   text not null,
  sent_at     timestamptz not null default now()
);

create index if not exists rate_limits_sender_sent
  on rate_limits (sender_id, sent_at desc);

comment on table rate_limits is
  'Rolling rate-limit log. App checks last 30 days: max 3 whispers per sender.';

-- ── Indexes ──────────────────────────────────────────────────────────────────

create index if not exists whispers_recipient_status
  on whispers (recipient_id, status);

create index if not exists whispers_sender
  on whispers (sender_id);

create index if not exists outbound_sender
  on outbound_log (sender_id, created_at desc);

-- ── Row Level Security ───────────────────────────────────────────────────────
-- These policies assume you pass the entity_id (hash) as a JWT claim or
-- application-level parameter. Adjust to your auth strategy.

alter table entities    enable row level security;
alter table whispers    enable row level security;
alter table outbound_log enable row level security;
alter table rate_limits  enable row level security;

-- Entities: anyone can read (needed to render public room pages)
create policy "entities_read_all"
  on entities for select
  using (true);

-- Entities: only the owner can update their own row
create policy "entities_update_own"
  on entities for update
  using (entity_id = current_setting('app.current_entity_id', true));

-- Entities: insert is open (registration)
create policy "entities_insert_open"
  on entities for insert
  with check (true);

-- Whispers: recipient can read their own inboard
create policy "whispers_read_recipient"
  on whispers for select
  using (
    recipient_id = current_setting('app.current_entity_id', true)
    or status = 'integrated'   -- public boards see integrated whispers
  );

-- Whispers: anyone can insert (sending a whisper)
create policy "whispers_insert_open"
  on whispers for insert
  with check (char_length(text) <= 280);

-- Whispers: recipient can update status on their own inboard
create policy "whispers_update_recipient"
  on whispers for update
  using (recipient_id = current_setting('app.current_entity_id', true));

-- Outbound: sender can only see their own outbound log
create policy "outbound_read_own"
  on outbound_log for select
  using (sender_id = current_setting('app.current_entity_id', true));

create policy "outbound_insert_open"
  on outbound_log for insert
  with check (true);

-- Rate limits: open read/write (app enforces logic)
create policy "rate_limits_all"
  on rate_limits for all
  using (true)
  with check (true);

-- ── Helper functions ─────────────────────────────────────────────────────────

-- Get active whisper count for an entity (antechamber + integrated)
create or replace function get_active_note_count(p_entity_id text)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from whispers
  where recipient_id = p_entity_id
    and status in ('antechamber', 'integrated');
$$;

-- Check if a sender has exceeded rate limit in the last 30 days
create or replace function check_rate_limit(p_sender_id text)
returns boolean
language sql
stable
as $$
  select count(*) >= 3
  from rate_limits
  where sender_id = p_sender_id
    and sent_at > now() - interval '30 days';
$$;

-- ── Sample data (remove before production) ──────────────────────────────────

-- insert into entities (entity_id, ghost_name, trust_token)
-- values ('abc123...', 'Velvet Heron', 'f3a1b2c3d4e5f6a7');
