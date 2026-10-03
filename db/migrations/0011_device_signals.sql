-- Live video between two of the user's devices (WebRTC): the small messages the
-- two browsers hand each other to find a path (offer, answer, network candidates).
-- They are read once and deleted, and never kept more than a minute. The video
-- itself goes straight from device to device and never touches the server.
-- Additive only. Run once.

create table if not exists device_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The device being watched (the one with the camera).
  device_id uuid not null references devices(id) on delete cascade,
  -- Who must read it: the watched device ("target") or the screen that is watching ("viewer").
  to_role text not null,
  kind text not null,
  payload text not null,
  created_at timestamptz not null default now()
);

create index if not exists device_signals_inbox_idx on device_signals (device_id, to_role, created_at);
