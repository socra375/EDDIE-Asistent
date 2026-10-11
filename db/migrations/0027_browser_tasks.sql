-- Browser tasks: Eddie gets one tab, a short goal ("crea un diseño en Canva
-- con...") and a screenshot loop — look at the tab, decide ONE click/type/key/
-- scroll, act, look again — until it says it's done, hits a safety limit, or
-- the user stops it. Always one confirmed task at a time, browser-only: it
-- never touches anything outside that one tab (see api/_lib/browser/tasks.js
-- and api/_lib/browser/agentStep.js).
create table if not exists browser_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  goal text not null,
  start_url text not null,
  status text not null default 'running' check (status in ('running', 'done', 'stopped', 'blocked', 'error')),
  action_count integer not null default 0,
  max_actions integer not null default 25,
  stop_requested boolean not null default false,
  result text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists browser_tasks_user_idx on browser_tasks(user_id, started_at desc);
