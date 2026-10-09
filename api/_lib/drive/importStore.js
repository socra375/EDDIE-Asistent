// Database side of the Drive → third brain import (db/migrations/0021_drive_imports.sql):
// one row per Doc or Sheet found in a connected folder and what became of it.
import { getDb } from '../db.js';

const json = (value) => JSON.stringify(value);

// Records the files found in a folder. A file that is new, or that changed since it was
// imported (or failed last time) goes back to 'pending'; one that did not change keeps its state.
// Pending files that are no longer in the folder are forgotten.
export async function upsertListing(userId, folderId, files) {
  const sql = getDb();
  const rows = files.map((f) => ({ file_id: f.id, name: f.name, kind: f.kind, path: f.path || '', modified_time: f.modified || null }));
  if (rows.length) {
    await sql`
      insert into drive_imports (user_id, folder_id, file_id, name, kind, path, modified_time)
      select ${userId}::uuid, ${folderId}::uuid, f.file_id, f.name, f.kind, f.path, f.modified_time
      from jsonb_to_recordset(${json(rows)}::jsonb) as f(file_id text, name text, kind text, path text, modified_time timestamptz)
      on conflict (folder_id, file_id) do update set
        name = excluded.name,
        kind = excluded.kind,
        path = excluded.path,
        status = case when drive_imports.modified_time is distinct from excluded.modified_time or drive_imports.status = 'failed' then 'pending' else drive_imports.status end,
        modified_time = excluded.modified_time
    `;
  }
  await sql`
    delete from drive_imports
    where folder_id = ${folderId} and user_id = ${userId} and status = 'pending'
      and file_id not in (select jsonb_array_elements_text(${json(rows.map((r) => r.file_id))}::jsonb))
  `;
}

// The next files to read.
export async function nextPending(userId, folderId, limit) {
  const sql = getDb();
  return sql`
    select id, file_id, name, kind, path, touched from drive_imports
    where folder_id = ${folderId} and user_id = ${userId} and status = 'pending'
    order by name limit ${limit}
  `;
}

// → { pending, done, empty, failed, lastAt, errors: [{ name, error }] } of one folder.
export async function folderCounts(userId, folderId) {
  const sql = getDb();
  const counts = await sql`select status, count(*)::int as n, max(imported_at) as last_at from drive_imports where folder_id = ${folderId} and user_id = ${userId} group by status`;
  const out = { pending: 0, done: 0, empty: 0, failed: 0, lastAt: null, errors: [] };
  for (const r of counts) {
    out[r.status] = Number(r.n);
    if (r.last_at && (!out.lastAt || new Date(r.last_at) > new Date(out.lastAt))) out.lastAt = new Date(r.last_at).toISOString();
  }
  if (out.failed) {
    const failed = await sql`select name, error from drive_imports where folder_id = ${folderId} and user_id = ${userId} and status = 'failed' order by name limit 5`;
    out.errors = failed.map((r) => ({ name: r.name, error: r.error || '' }));
  }
  return out;
}

export async function markFile(userId, id, { status, error = null, touched = [] }) {
  const sql = getDb();
  await sql`
    update drive_imports set status = ${status}, error = ${error}, touched = ${json(touched)}::jsonb, imported_at = now()
    where id = ${id} and user_id = ${userId}
  `;
}

// The files of a folder that put something in the brain: [{ id, fileId, name, touched }].
export async function importedFiles(userId, folderId) {
  const sql = getDb();
  const rows = await sql`select id, file_id, name, touched from drive_imports where folder_id = ${folderId} and user_id = ${userId} and status = 'done'`;
  return rows.map((r) => ({ id: r.id, fileId: r.file_id, name: r.name, touched: Array.isArray(r.touched) ? r.touched : [] }));
}

// Forgets everything about a folder's import (after undoing it) so the next one starts over.
export async function clearFolder(userId, folderId) {
  const sql = getDb();
  await sql`delete from drive_imports where folder_id = ${folderId} and user_id = ${userId}`;
}
