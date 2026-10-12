-- Contactos: the address book Eddie reads when he needs a client's number, writes a
-- message for someone or has to call the user. One row is the user's own number
-- (`is_self`), at most one per user. Same access model as 0001: only our backend
-- touches this table and every query filters by the user.

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  phone text not null default '',
  instagram text not null default '',
  email text not null default '',
  notes text not null default '',
  is_self boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_user_idx on contacts(user_id, name);
create unique index if not exists contacts_self_idx on contacts(user_id) where is_self;
