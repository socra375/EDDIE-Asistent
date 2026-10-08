-- The third brain: clients, deals, prices, business context, how the user works and how he talks.
-- One row per thing Eddie keeps (a client, a deal, a price, a habit…); its notes are a jsonb list
-- (at most 20, see src/services/business.js) so a conversation adds a line, not a row.
-- Only our backend touches it, and every query filters by the user (same model as 0013/0016).
create table if not exists business_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  area text not null check (area in ('clientes', 'negocios', 'estilo', 'contexto', 'precios', 'trabajo')),
  title text not null check (length(title) between 1 and 80),
  summary text not null default '',
  status text,
  value text check (value is null or value in ('alto', 'medio', 'bajo')),
  amount numeric(14, 2),
  related text not null default '',
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists business_nodes_unique on business_nodes(user_id, area, lower(title));
create index if not exists business_nodes_user_idx on business_nodes(user_id, updated_at desc);
