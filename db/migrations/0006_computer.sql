-- EDDIE Prime: the agent on the user's own computer (eddie_agent.py) that
-- runs whitelisted tools for Eddie's cloud brain, so the computer can be
-- reached from Telegram, WhatsApp or the phone (see docs/eddie-prime-agente.md).
--
-- The agent never opens a port: it links once with a short code, then waits
-- for a "doorbell" (an ntfy topic) and comes to ask for its jobs with its own
-- token. Only a hash of that token is stored here.

-- One computer per user (linking again replaces it).
create table if not exists computer_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references users(id) on delete cascade,
  name text not null,
  token_hash text unique not null,
  -- The secret ntfy topic the agent listens on for "there is work".
  topic text not null,
  -- The tools the agent offers: [{ name, label, description, risk, parameters }].
  tools jsonb not null default '[]'::jsonb,
  agent_version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- The code shown in Conectores, typed into `eddie_agent.py pair CODE`.
create table if not exists computer_pair_codes (
  code text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- One tool call for the computer: queued → running → done | error,
-- or expired when the computer didn't pick it up in time.
create table if not exists computer_jobs (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references computer_devices(id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  taken_at timestamptz,
  finished_at timestamptz
);

create index if not exists computer_jobs_queue_idx on computer_jobs(device_id, status, created_at);
