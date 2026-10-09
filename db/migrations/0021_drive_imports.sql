-- Importing the connected Drive folders into the third brain (Negocios): one row per
-- Doc or Sheet found in a folder, so a long import can run in short batches and be
-- resumed, a file that did not change is not read again, and the whole import of a
-- folder can be undone (`touched` lists the things in the brain that file made or
-- added notes to). Only names and what was done are kept here — not the file's text.
create table if not exists drive_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  folder_id uuid not null references drive_folders(id) on delete cascade,
  file_id text not null,
  name text not null,
  kind text not null check (kind in ('documento', 'hoja')),
  path text not null default '',
  modified_time timestamptz,
  -- pending → done (things were saved), empty (nothing useful in it) or failed (see error)
  status text not null default 'pending' check (status in ('pending', 'done', 'empty', 'failed')),
  error text,
  -- [{ id, created }]: the brain items this file created or added notes to.
  touched jsonb not null default '[]'::jsonb,
  imported_at timestamptz,
  unique (folder_id, file_id)
);

create index if not exists drive_imports_folder_idx on drive_imports(folder_id, status);
