-- Eddie on Telegram: which chat belongs to which user, the short-lived codes
-- used to link them, update de-duplication (Telegram retries slow webhooks)
-- and the confirmations waiting for a button press.
--
-- Same access model as 0001: only our backend touches these tables, and
-- every query filters by the user (or by the chat that user linked).

create table if not exists telegram_links (
  user_id uuid primary key references users(id) on delete cascade,
  chat_id bigint unique not null,
  timezone text not null default 'UTC',
  voice_replies boolean not null default false,
  -- The last few messages of the Telegram conversation, so Eddie keeps the thread.
  history jsonb not null default '[]'::jsonb,
  linked_at timestamptz not null default now()
);

-- "/start CODE" links a chat to the user who generated CODE in the app.
create table if not exists telegram_link_codes (
  code text primary key,
  user_id uuid not null references users(id) on delete cascade,
  timezone text not null default 'UTC',
  expires_at timestamptz not null
);

create table if not exists telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

-- A sensitive action Eddie proposed, waiting for ✅ / ✖ on its message.
create table if not exists telegram_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  chat_id bigint not null,
  tool text not null,
  args jsonb not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists telegram_pending_chat_idx on telegram_pending(chat_id);
