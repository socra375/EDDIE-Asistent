-- Eddie's conversation memory: a short summary of each conversation segment,
-- stored with an embedding so Eddie can find what is relevant to a new
-- message ("what did we decide about the project?") by meaning, not by
-- keywords. Needs the pgvector extension (Neon: available on every plan).
--
-- Same access model as 0001: only our backend touches these tables, and
-- every query filters by the user.

create extension if not exists vector;

create table if not exists episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Where it came from: "web" (the app) or "telegram".
  source text not null default 'web',
  -- The app's conversation id, so a long chat can leave several episodes.
  conversation_id text,
  summary text not null,
  message_count int not null default 0,
  -- Gemini embedding (gemini-embedding-001, 768 dimensions).
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);

create index if not exists episodes_user_idx on episodes(user_id, created_at desc);

-- Telegram keeps its own thread in telegram_links.history; these two let the
-- bot close a conversation that went cold (and only once).
alter table telegram_links add column if not exists history_at timestamptz;
alter table telegram_links add column if not exists episode_saved boolean not null default true;
