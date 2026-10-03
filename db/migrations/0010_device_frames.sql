-- Remote view: the last camera picture a device shared while another of the
-- user's devices was watching it (see api/_lib/devices/). One row per device,
-- overwritten each time, emptied when the viewer stops, and never served when
-- it is older than a few seconds. Additive only. Run once.

create table if not exists device_frames (
  device_id uuid primary key references devices(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- The JPEG as base64 (small: ~480 px, a few tens of KB) and what the detector found in it.
  frame text,
  meta jsonb,
  updated_at timestamptz,
  -- When the viewer last asked: the device only keeps sending while somebody is watching.
  viewer_seen_at timestamptz
);
