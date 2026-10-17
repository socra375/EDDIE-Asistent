-- Background jobs: a request Eddie works on by himself while the conversation goes on («agent_jobs»). The user says
-- «hazme X», Eddie answers at once and a second agent does it; when it ends, the result (and the cards that need an OK)
-- waits here until the app shows it (`seen_at`).
create table if not exists agent_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null,
  task text not null,
  status text not null default 'queued', -- queued | running | done | error
  result text,
  error text,
  steps jsonb not null default '[]'::jsonb,
  confirmations jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  timezone text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  seen_at timestamptz
);
create index if not exists agent_jobs_user_idx on agent_jobs (user_id, created_at desc);
