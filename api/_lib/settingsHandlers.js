import { getDb } from './db.js';
import { requireUser } from './session.js';

export async function getSettings(cookies) {
  const user = await requireUser(cookies);
  const sql = getDb();
  const rows = await sql`select data from settings where user_id = ${user.id}`;
  return { status: 200, json: { settings: rows[0]?.data ?? null } };
}

export async function putSettings(cookies, body) {
  const user = await requireUser(cookies);
  const sql = getDb();
  await sql`
    insert into settings (user_id, data, updated_at) values (${user.id}, ${JSON.stringify(body || {})}, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()
  `;
  return { status: 200, json: { ok: true } };
}
