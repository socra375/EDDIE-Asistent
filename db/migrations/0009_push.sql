-- Web Push: notifications that reach a device even when Eddie is closed
-- (reminders, the morning summary). Run once, in the Neon SQL editor or with psql.
-- Additive only: nothing existing is changed or dropped.

-- The server's VAPID key pair, made on first use (private half encrypted with
-- CONNECTOR_SECRET). A single row. VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in
-- Vercel take over if set.
create table if not exists push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now()
);

-- One row per browser/app that accepted notifications. The endpoint is the
-- push service's address for that browser (unique: the same browser signing
-- in to another account moves its row).
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  client_id text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  platform text,
  failures int not null default 0,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);

create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

-- Reminders and the summary no longer depend on Telegram, so they carry their own time zone.
alter table reminders add column if not exists timezone text;
alter table briefing_settings add column if not exists timezone text;
