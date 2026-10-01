-- Eddie on WhatsApp (Meta's Cloud API): which phone belongs to which user,
-- the short-lived codes used to link them, message de-duplication (Meta
-- retries slow webhooks) and the confirmations waiting for a button press.
--
-- Same access model as 0001: only our backend touches these tables, and
-- every query filters by the user (or by the phone that user linked).

create table if not exists whatsapp_links (
  user_id uuid primary key references users(id) on delete cascade,
  -- The sender's WhatsApp id: their phone number, digits only (e.g. 18095551234).
  wa_id text unique not null,
  timezone text not null default 'UTC',
  voice_replies boolean not null default false,
  -- The last few messages of the WhatsApp conversation, so Eddie keeps the thread.
  history jsonb not null default '[]'::jsonb,
  history_at timestamptz,
  episode_saved boolean not null default true,
  linked_at timestamptz not null default now()
);

-- "VINCULAR CODE" sent to Eddie's number links that phone to the user who made CODE in the app.
create table if not exists whatsapp_link_codes (
  code text primary key,
  user_id uuid not null references users(id) on delete cascade,
  timezone text not null default 'UTC',
  expires_at timestamptz not null
);

create table if not exists whatsapp_messages (
  id text primary key,
  received_at timestamptz not null default now()
);

-- A sensitive action Eddie proposed, waiting for the Confirmar / Cancelar buttons.
create table if not exists whatsapp_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  wa_id text not null,
  tool text not null,
  args jsonb not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_pending_wa_idx on whatsapp_pending(wa_id);
