-- Eddie en tu navegador: the Chrome extension that opens things for the user
-- (their meetings at the right time, the documents Eddie makes, a YouTube
-- search…) and works from the browser they already use.
--
-- The extension never receives a port or a push: it links once with a short
-- code, then asks for its work every half minute with its own token. Only a
-- hash of that token is stored here.

-- One browser per user (linking again replaces it), with what the user chose.
create table if not exists browser_links (
  user_id uuid primary key references users(id) on delete cascade,
  token_hash text unique not null,
  name text not null default 'Mi navegador',
  version text,
  -- Open the meetings in the calendar when they start (lead_minutes before).
  auto_meetings boolean not null default true,
  lead_minutes integer not null default 1 check (lead_minutes between 0 and 10),
  -- Open in a tab the documents, sheets and presentations Eddie creates or edits.
  open_created boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- The code shown in Conectores, handed to the extension.
create table if not exists browser_pair_codes (
  code text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- Pages Eddie wants opened: queued → taken by the extension, or stale when
-- nobody came for them in time (the user has moved on).
create table if not exists browser_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  url text not null,
  label text,
  created_at timestamptz not null default now(),
  taken_at timestamptz
);

create index if not exists browser_commands_queue_idx on browser_commands(user_id, created_at) where taken_at is null;
