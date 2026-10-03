-- Camera lock: nobody can switch on (or watch) a camera of the user's devices
-- without the lock's password or fingerprint/face. The lock is created ONCE and
-- its secret is never shown again; it can only be removed with the secret itself
-- or, if it is forgotten, after a 24-hour wait during which the owner is warned.
-- Additive only. Run once.

create table if not exists camera_locks (
  user_id uuid primary key references users(id) on delete cascade,
  -- scrypt$N$r$p$salt$hash. Null when the lock is a passkey (fingerprint/face) only.
  password_hash text,
  created_at timestamptz not null default now(),
  -- Removal asked for without the secret: it happens at delete_at unless cancelled.
  delete_requested_at timestamptz,
  delete_at timestamptz,
  failures int not null default 0,
  locked_until timestamptz
);

-- Fingerprint / face / device PIN credentials (WebAuthn) registered when the lock was made.
create table if not exists camera_passkeys (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  public_key text not null,
  counter bigint not null default 0,
  transports text,
  created_at timestamptz not null default now()
);
create index if not exists camera_passkeys_user_idx on camera_passkeys (user_id);

-- A proof the user just gave (password or biometric), good for one start of a camera for 2 minutes.
-- Only a hash of it is kept.
create table if not exists camera_tokens (
  hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

-- The challenge of an ongoing WebAuthn registration / authentication.
create table if not exists camera_challenges (
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null,
  challenge text not null,
  expires_at timestamptz not null,
  primary key (user_id, purpose)
);

-- A device whose camera was started with the proof: its pictures / video may be read until it expires or is stopped.
create table if not exists camera_grants (
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (user_id, device_id)
);
