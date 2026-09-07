-- Eddie account system: Google login + per-user tasks/settings/memory,
-- plus stored Google OAuth credentials for the Calendar/Drive integrations.
--
-- Access model: the frontend never connects to this database directly —
-- only our backend (api/_lib/db.js), holding DATABASE_URL as a server-only
-- secret, does. Every query filters by the user id from the caller's own
-- session, so one user can never read or write another's rows.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  google_sub text unique not null,
  email text,
  name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Opaque server-side sessions (the cookie holds only the random id below).
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions(user_id);

-- One row per user with their Google OAuth tokens, used server-side only
-- to call the Calendar/Drive APIs on the user's behalf.
create table if not exists google_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text not null,
  updated_at timestamptz not null default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  due_date date,
  priority text not null default 'media' check (priority in ('alta', 'media', 'baja')),
  done boolean not null default false,
  google_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_id_idx on tasks(user_id);

create table if not exists settings (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists memory (
  user_id uuid primary key references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
