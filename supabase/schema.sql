-- Whisper — Supabase Schema
-- Run in the Supabase SQL editor (Dashboard → SQL Editor → New query)

-- ── Extensions ────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists entities (
  entity_id     text        primary key,           -- SHA-256 of email
  ghost_name    text        not null,              -- e.g. "Velvet Heron"
  display_name  text,                              -- user's chosen name
  photo_url     text,                              -- base64 or CDN URL
  sigil_params  jsonb,                             -- designer params
  trust_token   text        not null,              -- 16-char hex
  expiry        text        not null default '24h'
                              check (expiry in ('1h','24h','7d')),
  note_count    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table entities is
  'One row per Whisper user. Identified only by SHA-256 hash of email — no PII stored.';

-- ──

create table if not exists whispers (
  id            uuid        primary key default gen_random_uuid(),
  recipient_id  text        not null references entities(entity_id) on delete cascade,
  sender_id     text        not null,
  sender_ghost  text        not null,
  text          text        not null check (char_length(text) <= 280),
  admire        text,
  appreciate    text,
  wish          text,
  status        text        not null default 'antechamber'
                              check (status in ('antechamber','integrated','released','void')),
  created_at    timestamptz not null default now()
);

comment on table whispers is
  'Each whisper sent to a recipient. Status tracks its lifecycle in the owner''s quiet room.';

-- ──

create table if not exists outbound_log (
  id              uuid        primary key default gen_random_uuid(),
  sender_id       text        not null,
  recipient_id    text        not null,
  recipient_ghost text        not null,
  text            text        not null check (char_length(text) <= 280),
  status          text        not null default 'sent'
                                check (status in ('sent','void')),
  created_at      timestamptz not null default now()
);

comment on table outbound_log is
  'Private sender log — visible only to the sender.';

-- ──

create table if not exists rate_limits (
  sender_id text        not null,
  sent_at   timestamptz not null default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists whispers_recipient_status
  on whispers (recipient_id, status);

create index if not exists whispers_sender
  on whispers (sender_id);

create index if not exists outbound_sender
  on outbound_log (sender_id, created_at desc);

create index if not exists rate_limits_sender_sent
  on rate_limits (sender_id, sent_at desc);

-- ── updated_at trigger ────────────────────────────────────────────────────────

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger entities_updated_at
  before update on entities
  for each row execute function set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Strategy: anon key + entity_id passed as a custom claim via set_config().
-- The app calls: select set_config('app.eid', '<entity_id>', true)
-- before any write. Reads are open where needed for public room pages.

alter table entities     enable row level security;
alter table whispers     enable row level security;
alter table outbound_log enable row level security;
alter table rate_limits  enable row level security;

-- Entities: anyone can read (public room pages need ghost_name + sigil)
create policy "entities_read_all"    on entities for select using (true);
create policy "entities_insert_open" on entities for insert with check (true);
create policy "entities_update_own"  on entities for update
  using (entity_id = current_setting('app.eid', true));

-- Whispers: public can read integrated (room page); recipient reads their inboard
create policy "whispers_read"  on whispers for select
  using (
    status = 'integrated'
    or recipient_id = current_setting('app.eid', true)
  );
create policy "whispers_insert" on whispers for insert with check (char_length(text) <= 280);
create policy "whispers_update" on whispers for update
  using (recipient_id = current_setting('app.eid', true));

-- Outbound: sender reads only their own log
create policy "outbound_read"   on outbound_log for select
  using (sender_id = current_setting('app.eid', true));
create policy "outbound_insert" on outbound_log for insert with check (true);

-- Rate limits: open (logic enforced in app)
create policy "rate_limits_all" on rate_limits for all using (true) with check (true);

-- ── Helper functions ──────────────────────────────────────────────────────────

create or replace function get_active_note_count(p_entity_id text)
returns integer language sql stable as $$
  select count(*)::integer
  from whispers
  where recipient_id = p_entity_id
    and status in ('antechamber', 'integrated');
$$;

create or replace function check_rate_limit(p_sender_id text)
returns boolean language sql stable as $$
  select count(*) >= 3
  from rate_limits
  where sender_id = p_sender_id
    and sent_at > now() - interval '30 days';
$$;
