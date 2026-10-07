// Database side of the gallery (see db/migrations/0016_media.sql). The pictures
// are kept as bytea; they travel to and from Postgres as base64 text.
import { getDb } from '../db.js';

// A notebook, not an archive: past these the user deletes something first (nothing is dropped on its own).
export const MAX_ITEMS = 60;
export const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

const shape = (row) => ({
  id: String(row.id),
  kind: row.kind === 'video' ? 'video' : 'imagen',
  prompt: row.prompt,
  mime: row.mime,
  bytes: Number(row.bytes || 0),
  provider: row.provider,
  parentId: row.parent_id ? String(row.parent_id) : null,
  createdAt: new Date(row.created_at).toISOString(),
});

export async function addMedia(userId, { kind = 'imagen', prompt, mime, buffer, provider = 'gemini', parentId = null }) {
  const sql = getDb();
  const rows = await sql`
    insert into media_items (user_id, kind, prompt, mime, bytes, data, provider, parent_id)
    values (${userId}, ${kind}, ${prompt}, ${mime}, ${buffer.length}, decode(${buffer.toString('base64')}, 'base64'), ${provider}, ${parentId})
    returning id, kind, prompt, mime, bytes, provider, parent_id, created_at
  `;
  return shape(rows[0]);
}

// Newest first, without the pictures themselves.
export async function listMedia(userId, { limit = MAX_ITEMS } = {}) {
  const sql = getDb();
  const rows = await sql`
    select id, kind, prompt, mime, bytes, provider, parent_id, created_at
    from media_items where user_id = ${userId} order by created_at desc limit ${limit}
  `;
  return rows.map(shape);
}

export async function getMedia(userId, id) {
  const sql = getDb();
  const rows = await sql`select id, kind, prompt, mime, bytes, provider, parent_id, created_at from media_items where id = ${id} and user_id = ${userId}`;
  return rows[0] ? shape(rows[0]) : null;
}

export async function getLatestMedia(userId) {
  const sql = getDb();
  const rows = await sql`select id, kind, prompt, mime, bytes, provider, parent_id, created_at from media_items where user_id = ${userId} and kind = 'imagen' order by created_at desc limit 1`;
  return rows[0] ? shape(rows[0]) : null;
}

// → { ...meta, buffer } or null.
export async function getMediaFile(userId, id) {
  const sql = getDb();
  const rows = await sql`
    select id, kind, prompt, mime, bytes, provider, parent_id, created_at, encode(data, 'base64') as b64
    from media_items where id = ${id} and user_id = ${userId}
  `;
  return rows[0] ? { ...shape(rows[0]), buffer: Buffer.from(rows[0].b64, 'base64') } : null;
}

export async function deleteMedia(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from media_items where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

// { count, bytes, last24h }
export async function mediaUsage(userId) {
  const sql = getDb();
  const rows = await sql`
    select count(*)::int as n, coalesce(sum(bytes), 0)::bigint as total,
      count(*) filter (where created_at > now() - interval '24 hours')::int as recent
    from media_items where user_id = ${userId}
  `;
  return { count: Number(rows[0]?.n || 0), bytes: Number(rows[0]?.total || 0), last24h: Number(rows[0]?.recent || 0) };
}
