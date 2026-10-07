-- Requests Eddie answered per user, per day and per "tanda" (morning /
-- afternoon), so the daily allowance can be shared across the whole day (see
-- api/_lib/usage/). Same access model as 0001: only our backend touches this
-- table and every query filters by the user.

create table if not exists usage_counters (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  tanda text not null check (tanda in ('am', 'pm')),
  used int not null default 0,
  primary key (user_id, day, tanda)
);
