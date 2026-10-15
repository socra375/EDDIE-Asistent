-- Páginas de confianza: sitios que el usuario le dijo a Eddie que abra y use SIN pedir confirmación cada vez
-- (abrirlos y, en ellos, hacer clics y escribir con browser_task). Solo se añaden desde una tarjeta que el
-- usuario confirma en el chat (herramienta trust_site) y se quitan desde el chat o desde Conectores → Tu
-- navegador; ninguna página ni documento puede añadir una por su cuenta. `domain` es un dominio público
-- (p. ej. canva.com): cubre también sus subdominios. Máximo 20 por usuario (api/_lib/browser/trusted.js).
create table if not exists browser_trusted_sites (
  user_id uuid not null references users(id) on delete cascade,
  domain text not null check (length(domain) between 4 and 120),
  created_at timestamptz not null default now(),
  primary key (user_id, domain)
);
