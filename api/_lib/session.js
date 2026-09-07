// Opaque server-side sessions: the cookie holds only a random id, looked
// up against the `sessions` table on every request. Simple to revoke
// (delete the row) compared to a self-contained JWT.
import { getDb } from './db.js';

export const SESSION_COOKIE_NAME = 'eddie_session';
const SESSION_TTL_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_TTL_DAYS * 86400;

export async function createSession(userId) {
  const sql = getDb();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  const rows = await sql`
    insert into sessions (user_id, expires_at) values (${userId}, ${expiresAt}) returning id
  `;
  return rows[0].id;
}

export async function getSessionUser(sessionId) {
  if (!sessionId) return null;
  const sql = getDb();
  const rows = await sql`
    select u.id, u.email, u.name, u.avatar_url, s.expires_at
    from sessions s
    join users u on u.id = s.user_id
    where s.id = ${sessionId}
  `;
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await sql`delete from sessions where id = ${sessionId}`;
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatar_url };
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  const sql = getDb();
  await sql`delete from sessions where id = ${sessionId}`;
}

export async function requireUser(cookies) {
  const user = await getSessionUser(cookies[SESSION_COOKIE_NAME]);
  if (!user) {
    const err = new Error('Debes iniciar sesión para hacer esto.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  return user;
}
