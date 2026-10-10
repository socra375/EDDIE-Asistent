-- Rutinas automáticas: una serie de acciones (de una lista fija y segura —
-- nunca una herramienta sensible ni arbitraria) que corren solas, por hora
-- ("a las 8, dame el resumen y pon mi música") o por un evento que EDDIE
-- Prime puede detectar en un equipo vinculado ("cuando termine la
-- descarga, avísame"). Mismo patrón que briefing_settings (0003): una vez
-- por día local para las de hora, revisadas cada 5 minutos (el cron de
-- GitHub Actions) para las de evento.
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  trigger_type text not null check (trigger_type in ('schedule', 'event')),
  time text,                                   -- 'HH:MM' local, solo trigger_type = 'schedule'
  event_type text,                             -- p.ej. 'download_complete', solo trigger_type = 'event'
  device_id uuid references computer_devices(id) on delete cascade,  -- equipo a vigilar, trigger_type = 'event'
  actions jsonb not null default '[]'::jsonb,  -- [{type, ...args}], tipos de ROUTINE_ACTIONS (api/_lib/routines/actions.js)
  enabled boolean not null default true,
  state jsonb not null default '{}'::jsonb,    -- memoria entre revisiones (p.ej. si ya había una descarga en curso)
  last_run_on date,                            -- de-dup diario, trigger_type = 'schedule'
  created_at timestamptz not null default now()
);
create index if not exists routines_user_idx on routines(user_id);
