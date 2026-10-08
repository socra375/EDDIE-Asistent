// Database side of the connected Drive folders (db/migrations/0020_drive_folders.sql).
import { getDb } from '../db.js';

export const PURPOSES = ['negocio', 'clientes', 'otro'];
export const MAX_FOLDERS = 10;

const shape = (row) => ({ id: row.id, folderId: row.folder_id, name: row.name, purpose: row.purpose });

export async function listFolders(userId) {
  const sql = getDb();
  const rows = await sql`select id, folder_id, name, purpose from drive_folders where user_id = ${userId} order by created_at`;
  return rows.map(shape);
}

// Connecting a folder again updates its name and purpose. → the folder, or null when the limit is reached.
export async function saveFolder(userId, { folderId, name, purpose }) {
  const sql = getDb();
  const existing = await sql`select 1 from drive_folders where user_id = ${userId} and folder_id = ${folderId}`;
  if (!existing.length) {
    const count = await sql`select count(*)::int as n from drive_folders where user_id = ${userId}`;
    if (Number(count[0]?.n) >= MAX_FOLDERS) return null;
  }
  const rows = await sql`
    insert into drive_folders (user_id, folder_id, name, purpose) values (${userId}, ${folderId}, ${name}, ${purpose})
    on conflict (user_id, folder_id) do update set name = excluded.name, purpose = excluded.purpose
    returning id, folder_id, name, purpose
  `;
  return shape(rows[0]);
}

export async function removeFolder(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from drive_folders where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}
