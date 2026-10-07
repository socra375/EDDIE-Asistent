-- Images (and, later, videos) Eddie created or edited for a user: the gallery.
-- The bytes live here (bytea) so there is no extra service to set up; the app
-- caps how many and how big (api/_lib/media/store.js). `parent_id` links an edit
-- to the image it came from. Same access model as 0001: only our backend
-- touches this table and every query filters by the user.

create table if not exists media_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null default 'imagen' check (kind in ('imagen', 'video')),
  prompt text not null,
  mime text not null,
  bytes int not null,
  data bytea not null,
  provider text not null default 'gemini',
  parent_id uuid references media_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists media_items_user_idx on media_items(user_id, created_at desc);
