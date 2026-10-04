-- Eddie's second brain: what Eddie learned by researching the web when asked
-- "investiga y aprende X". One row per topic (a short summary) and one per
-- essential note, each note with an embedding so Eddie finds what applies to
-- a new message by meaning. Same access model as 0001/0004: only our backend
-- touches these tables and every query filters by the user. Needs the
-- pgvector extension (already enabled by 0004).

create extension if not exists vector;

create table if not exists knowledge_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  summary text not null,
  -- "tema" (something to know) or "habilidad" (something to be able to do).
  kind text not null default 'tema',
  source_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists knowledge_topics_user_title_idx on knowledge_topics(user_id, lower(title));
create index if not exists knowledge_topics_user_idx on knowledge_topics(user_id, updated_at desc);

create table if not exists knowledge_notes (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references knowledge_topics(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  source_url text,
  source_title text,
  -- Gemini embedding (768 dimensions); null when it could not be made.
  embedding vector(768),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_notes_topic_idx on knowledge_notes(topic_id);
create index if not exists knowledge_notes_user_idx on knowledge_notes(user_id);
