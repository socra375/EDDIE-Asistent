-- Recepción: what Eddie needs to act as the business's receptionist for the user —
-- the opening hours he books appointments inside (`hours`: {"1": [["09:00","12:00"],
-- ["14:00","18:00"]], …} by weekday, 0 = Sunday, a missing or empty day = closed; `slot_minutes`
-- the default appointment length) and the messages he takes for the user while he is away
-- («recados»: who called, what they want, if it is urgent). Appointments themselves live
-- in Google Calendar, the user's own agenda, not here. Same access model as 0001: only our
-- backend touches these tables and every query filters by the user.

create table if not exists reception_settings (
  user_id uuid primary key references users(id) on delete cascade,
  hours jsonb not null default '{}'::jsonb,
  slot_minutes int not null default 30 check (slot_minutes between 10 and 240),
  updated_at timestamptz not null default now()
);

create table if not exists reception_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  from_name text not null,
  phone text not null default '',
  message text not null,
  urgent boolean not null default false,
  handled boolean not null default false,
  created_at timestamptz not null default now(),
  handled_at timestamptz
);

create index if not exists reception_messages_user_idx on reception_messages(user_id, handled, created_at desc);
