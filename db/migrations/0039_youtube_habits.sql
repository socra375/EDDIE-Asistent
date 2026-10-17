-- What the user watches and listens to on YouTube («youtube_history»: one row per user with up to 300 videos and when
-- each was opened, sent by the Chrome extension with the user's permission) and the music Eddie offered
-- («music_offers»: so he does not insist, and learns from the yes and the no).
create table if not exists youtube_history (
  user_id uuid primary key references users(id) on delete cascade,
  items jsonb not null default '[]'::jsonb,
  synced_at timestamptz not null default now()
);
create table if not exists music_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  video_id text not null,
  title text not null,
  offered_at timestamptz not null default now(),
  outcome text, -- accepted | declined | null (unanswered)
  answered_at timestamptz
);
create index if not exists music_offers_user_idx on music_offers (user_id, offered_at desc);
