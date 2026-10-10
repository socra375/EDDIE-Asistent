-- open_app (computer_action) now asks once per app per computer instead of
-- every time: the first "sí" is remembered here, so the next request for
-- that same app on that same computer skips the confirmation card. Every
-- other action on the computer (kill_process…) still asks every time.
create table if not exists computer_app_grants (
  device_id uuid not null references computer_devices(id) on delete cascade,
  app_key text not null,
  granted_at timestamptz not null default now(),
  primary key (device_id, app_key)
);
