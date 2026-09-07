import { getDb } from './db.js';
import { requireUser } from './session.js';

export async function getMemory(cookies) {
  const user = await requireUser(cookies);
  const sql = getDb();
  const rows = await sql`select data from memory where user_id = ${user.id}`;
  return { status: 200, json: { memory: rows[0]?.data ?? {} } };
}

export async function putMemory(cookies, body) {
  const user = await requireUser(cookies);
  const sql = getDb();
  await sql`
    insert into memory (user_id, data, updated_at) values (${user.id}, ${JSON.stringify(body || {})}, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()
  `;
  return { status: 200, json: { ok: true } };
}
