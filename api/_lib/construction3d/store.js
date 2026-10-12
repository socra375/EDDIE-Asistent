// Database side of Construction 3D (see db/migrations/0028_construction3d.sql).
// Rows only describe a project; the .glb is in the bucket (./s3.js).
import { getDb } from '../db.js';

// A notebook with room, not an archive: past these the user deletes something first.
export const MAX_PROJECTS = 100;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024; // under Neon's 5 GB free plan
export const MAX_MODEL_BYTES = 200 * 1024 * 1024; // a browser has to load it whole
export const STALE_UPLOAD_MINUTES = 60;

export const STATUSES = ['en_proceso', 'terminado'];

const shape = (row) => ({
  id: String(row.id),
  name: row.name,
  status: row.status,
  notes: row.notes || '',
  bytes: Number(row.glb_bytes || 0),
  ready: Boolean(row.ready),
  source: row.source,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function createProject(userId, { name, bytes, key }) {
  const sql = getDb();
  const rows = await sql`
    insert into construction_projects (user_id, name, glb_key, glb_bytes)
    values (${userId}, ${name}, ${key}, ${bytes})
    returning id, name, status, notes, glb_bytes, ready, source, created_at, updated_at
  `;
  return shape(rows[0]);
}

// The user's finished uploads, newest change first.
export async function listProjects(userId) {
  const sql = getDb();
  const rows = await sql`
    select id, name, status, notes, glb_bytes, ready, source, created_at, updated_at
    from construction_projects where user_id = ${userId} and ready = true
    order by updated_at desc limit ${MAX_PROJECTS}
  `;
  return rows.map(shape);
}

// Ready projects and uploads still under way both count: they take room.
export async function projectUsage(userId) {
  const sql = getDb();
  const rows = await sql`
    select count(*)::int as count, coalesce(sum(glb_bytes), 0)::bigint as bytes
    from construction_projects where user_id = ${userId}
  `;
  return { count: Number(rows[0].count), bytes: Number(rows[0].bytes) };
}

// The object key too, for the routes that read or delete the file. Only the owner's.
export async function getProject(userId, id) {
  const sql = getDb();
  const rows = await sql`
    select id, name, status, notes, glb_bytes, ready, source, created_at, updated_at, glb_key
    from construction_projects where user_id = ${userId} and id = ${id}
  `;
  return rows[0] ? { ...shape(rows[0]), key: rows[0].glb_key } : null;
}

export async function markReady(userId, id, bytes) {
  const sql = getDb();
  const rows = await sql`
    update construction_projects set ready = true, glb_bytes = ${bytes}, updated_at = now()
    where user_id = ${userId} and id = ${id}
    returning id, name, status, notes, glb_bytes, ready, source, created_at, updated_at
  `;
  return rows[0] ? shape(rows[0]) : null;
}

export async function updateProject(userId, id, { name, status, notes }) {
  const sql = getDb();
  const rows = await sql`
    update construction_projects set
      name = coalesce(${name ?? null}, name),
      status = coalesce(${status ?? null}, status),
      notes = coalesce(${notes ?? null}, notes),
      updated_at = now()
    where user_id = ${userId} and id = ${id} and ready = true
    returning id, name, status, notes, glb_bytes, ready, source, created_at, updated_at
  `;
  return rows[0] ? shape(rows[0]) : null;
}

// → the object key to delete from the bucket, or null when it was not theirs.
export async function deleteProject(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from construction_projects where user_id = ${userId} and id = ${id} returning glb_key`;
  return rows[0] ? rows[0].glb_key : null;
}

// Uploads that never finished (a closed tab, a lost connection): rows and keys to clean up.
export async function takeStaleUploads(userId) {
  const sql = getDb();
  const rows = await sql`
    delete from construction_projects
    where user_id = ${userId} and ready = false and created_at < now() - make_interval(mins => ${STALE_UPLOAD_MINUTES})
    returning glb_key
  `;
  return rows.map((row) => row.glb_key);
}
