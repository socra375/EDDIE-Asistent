-- Construction 3D: the 3D brain. Each row is one 3D project (a binary glTF,
-- .glb); the file itself lives in a private Neon Object Storage bucket under
-- `glb_key` (see api/_lib/construction3d/), so a model can be tens of MB without
-- touching Postgres. `ready` stays false until the browser's direct upload is
-- confirmed (size and "glTF" header checked). `source` says where it came from:
-- uploaded by hand today, made by Blender through EDDIE Prime later. Same
-- access model as 0001: only our backend touches this table and every query
-- filters by the user.

create table if not exists construction_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  status text not null default 'en_proceso' check (status in ('en_proceso', 'terminado')),
  notes text not null default '',
  glb_key text not null,
  glb_bytes bigint not null default 0,
  ready boolean not null default false,
  source text not null default 'subido' check (source in ('subido', 'blender')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists construction_projects_user_idx on construction_projects(user_id, updated_at desc);
