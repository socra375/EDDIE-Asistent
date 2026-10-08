// Database side of "Eddie en tu navegador" (see db/migrations/0019_browser.sql).
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db.js';
import { newLinkCode } from '../telegram/store.js';

const PAIR_MINUTES = 10;
// A page nobody came for in this long is stale: the user has moved on.
export const QUEUE_SECONDS = 120;
const TAKE_LIMIT = 5;

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

export async function createPairCode(userId) {
  const sql = getDb();
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + PAIR_MINUTES * 60000).toISOString();
  await sql`delete from browser_pair_codes where user_id = ${userId} or expires_at < now()`;
  await sql`insert into browser_pair_codes (code, user_id, expires_at) values (${code}, ${userId}, ${expiresAt})`;
  return { code, minutes: PAIR_MINUTES };
}

// The user who made `code` (consuming it), or null when unknown/used/expired.
export async function consumePairCode(code) {
  const sql = getDb();
  const rows = await sql`delete from browser_pair_codes where code = ${code} and expires_at > now() returning user_id`;
  return rows[0]?.user_id || null;
}

function shapeLink(row) {
  return {
    userId: row.user_id,
    name: row.name,
    version: row.version || null,
    lastSeen: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
    prefs: { autoMeetings: row.auto_meetings !== false, leadMinutes: Number(row.lead_minutes ?? 1), openCreated: row.open_created !== false },
  };
}

// Links a browser to the user, replacing any earlier one and keeping what the
// user chose. The token is returned once, to the extension; only its hash is kept.
export async function createLink(userId, { name, version }) {
  const sql = getDb();
  const token = randomBytes(32).toString('base64url');
  const rows = await sql`
    insert into browser_links (user_id, token_hash, name, version, last_seen_at)
    values (${userId}, ${hashToken(token)}, ${name}, ${version}, now())
    on conflict (user_id) do update set token_hash = excluded.token_hash, name = excluded.name,
      version = excluded.version, last_seen_at = now(), created_at = now()
    returning user_id, name, version, last_seen_at, auto_meetings, lead_minutes, open_created
  `;
  return { token, link: shapeLink(rows[0]) };
}

// The link behind a bearer token (and a fresh "last seen"), or null.
export async function linkByToken(token) {
  if (!token || token.length > 100) return null;
  const sql = getDb();
  const rows = await sql`
    update browser_links set last_seen_at = now() where token_hash = ${hashToken(token)}
    returning user_id, name, version, last_seen_at, auto_meetings, lead_minutes, open_created
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function linkByUser(userId) {
  const sql = getDb();
  const rows = await sql`select user_id, name, version, last_seen_at, auto_meetings, lead_minutes, open_created from browser_links where user_id = ${userId}`;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function hasLink(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from browser_links where user_id = ${userId}`;
  return rows.length > 0;
}

export async function updateHello(userId, { name, version }) {
  const sql = getDb();
  await sql`update browser_links set name = coalesce(${name}, name), version = coalesce(${version}, version) where user_id = ${userId}`;
}

// Only the fields given change.
export async function updatePrefs(userId, { autoMeetings = null, leadMinutes = null, openCreated = null }) {
  const sql = getDb();
  const rows = await sql`
    update browser_links set auto_meetings = coalesce(${autoMeetings}, auto_meetings),
      lead_minutes = coalesce(${leadMinutes}, lead_minutes), open_created = coalesce(${openCreated}, open_created)
    where user_id = ${userId}
    returning user_id, name, version, last_seen_at, auto_meetings, lead_minutes, open_created
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function deleteLink(userId) {
  const sql = getDb();
  await sql`delete from browser_links where user_id = ${userId}`;
  await sql`delete from browser_commands where user_id = ${userId}`;
}

export async function enqueue(userId, { url, label }) {
  const sql = getDb();
  const rows = await sql`insert into browser_commands (user_id, url, label) values (${userId}, ${url}, ${label || null}) returning id`;
  if (Math.random() < 0.05) await sql`delete from browser_commands where created_at < now() - interval '1 day'`;
  return rows[0].id;
}

// The fresh pages waiting for this user's browser, marked as taken (oldest first).
export async function takeCommands(userId) {
  const sql = getDb();
  const rows = await sql`
    update browser_commands set taken_at = now()
    where id in (
      select id from browser_commands
      where user_id = ${userId} and taken_at is null and created_at > now() - make_interval(secs => ${QUEUE_SECONDS})
      order by created_at limit ${TAKE_LIMIT}
      for update skip locked
    )
    returning id, url, label, created_at
  `;
  return rows
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((r) => ({ id: r.id, url: r.url, label: r.label || '' }));
}

export async function wasTaken(commandId) {
  const sql = getDb();
  const rows = await sql`select taken_at from browser_commands where id = ${commandId}`;
  return Boolean(rows[0]?.taken_at);
}
