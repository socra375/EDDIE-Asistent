-- Spotify: the user's own account, linked from Conectores ("Conectar Spotify")
-- so Eddie can search and control playback by voice. Tokens are stored
-- encrypted (api/_lib/secretBox.js, CONNECTOR_SECRET), like Google's.
create table if not exists spotify_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz not null,
  scope text,
  updated_at timestamptz not null default now()
);
