-- Eddie's reminders and the morning summary, both delivered on Telegram by
-- the scheduled job (GET /api/connectors/cron, see api/_lib/reminders/).
--
-- Same access model as 0001: only our backend touches these tables, and
-- every query filters by the user.

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  text text not null,
  due_at timestamptz not null,
  -- Set when the job claims the reminder (so two overlapping runs never
  -- send it twice); cleared again if Telegram refused the message.
  sent_at timestamptz,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_idx on reminders(due_at) where sent_at is null;
create index if not exists reminders_user_idx on reminders(user_id, due_at);

-- The morning summary: one row per user who turned it on. send_time is the
-- user's local HH:MM (their time zone is the one saved with the Telegram
-- link); last_sent_on keeps it to one summary per local day.
create table if not exists briefing_settings (
  user_id uuid primary key references users(id) on delete cascade,
  enabled boolean not null default false,
  send_time text not null default '07:00',
  last_sent_on date
);
