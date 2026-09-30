import { getDb } from './db.js';
import { requireUser } from './session.js';

export async function getMemory(cookies) {
  const user = await requireUser(cookies);
  const sql = getDb();
  const rows = await sql`select data from memory where user_id = ${user.id}`;
  return { status: 200, json: { memory: rows[0]?.data ?? {} } };
}

// Memory is a small JSON document (see src/services/memory.js, capped per
// category on the client); this is the backstop against anything bigger.
const MAX_MEMORY_BYTES = 200000;

export async function putMemory(cookies, body) {
  const user = await requireUser(cookies);
  const data = JSON.stringify(body || {});
  if (data.length > MAX_MEMORY_BYTES) return { status: 413, json: { error: 'La memoria es demasiado grande.' } };
  const sql = getDb();
  await sql`
    insert into memory (user_id, data, updated_at) values (${user.id}, ${data}, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()
  `;
  return { status: 200, json: { ok: true } };
}
