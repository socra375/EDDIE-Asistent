-- Carpetas de Drive conectadas: the folders the user chose to hand to Eddie
-- ("Negocio", "Servicio al cliente"…). Only the folder's id, name and what it is
-- for are kept here: Eddie reads what is inside from Google when it needs it,
-- with the user's own permission (drive.metadata.readonly for names, the
-- Docs/Sheets permissions for the text).
create table if not exists drive_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  folder_id text not null,
  name text not null,
  -- 'negocio' (businesses, context, plans), 'clientes' (how he talks, clients) or 'otro'.
  purpose text not null default 'otro' check (purpose in ('negocio', 'clientes', 'otro')),
  created_at timestamptz not null default now(),
  unique (user_id, folder_id)
);

create index if not exists drive_folders_user_idx on drive_folders(user_id);
