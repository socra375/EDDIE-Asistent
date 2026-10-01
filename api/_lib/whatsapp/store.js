// Database side of the WhatsApp channel (see db/migrations/0005_whatsapp.sql).
import { randomInt } from 'node:crypto';
import { getDb } from '../db.js';

const LINK_CODE_MINUTES = 10;
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 1500;
// Without I, O, 0, 1: a code read aloud or typed by hand can't be mistaken.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const newLinkCode = () => Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export async function createLinkCode(userId, timezone) {
  const sql = getDb();
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60000).toISOString();
  // One live code per user: asking again replaces the old one.
  await sql`delete from whatsapp_link_codes where user_id = ${userId} or expires_at < now()`;
  await sql`insert into whatsapp_link_codes (code, user_id, timezone, expires_at) values (${code}, ${userId}, ${timezone}, ${expiresAt})`;
  return { code, minutes: LINK_CODE_MINUTES };
}

// Links `waId` to the user who made `code`, consuming the code. Returns the
// user id, or null when the code is unknown, used or expired.
export async function consumeLinkCode(code, waId) {
  const sql = getDb();
  const rows = await sql`delete from whatsapp_link_codes where code = ${code} and expires_at > now() returning user_id, timezone`;
  if (!rows[0]) return null;
  const { user_id: userId, timezone } = rows[0];
  // A phone belongs to one user and a user to one phone; re-linking moves it.
  await sql`delete from whatsapp_links where wa_id = ${waId} and user_id <> ${userId}`;
  await sql`
    insert into whatsapp_links (user_id, wa_id, timezone, history, history_at, episode_saved, linked_at)
    values (${userId}, ${waId}, ${timezone}, '[]', null, true, now())
    on conflict (user_id) do update set wa_id = excluded.wa_id, timezone = excluded.timezone, history = '[]', history_at = null, episode_saved = true, linked_at = now()
  `;
  return userId;
}

function shapeLink(row) {
  return {
    userId: row.user_id,
    waId: String(row.wa_id),
    timezone: row.timezone,
    voiceReplies: Boolean(row.voice_replies),
    history: Array.isArray(row.history) ? row.history : [],
    historyAt: row.history_at ? new Date(row.history_at).toISOString() : null,
    episodeSaved: row.episode_saved === undefined ? undefined : Boolean(row.episode_saved),
    user: { id: row.user_id, email: row.email, name: row.name },
  };
}

export async function getLinkByWa(waId) {
  const sql = getDb();
  const rows = await sql`
    select l.user_id, l.wa_id, l.timezone, l.voice_replies, l.history, l.history_at, l.episode_saved, u.email, u.name
    from whatsapp_links l join users u on u.id = l.user_id
    where l.wa_id = ${waId}
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function getLinkByUser(userId) {
  const sql = getDb();
  const rows = await sql`
    select l.user_id, l.wa_id, l.timezone, l.voice_replies, l.history, l.history_at, l.episode_saved, u.email, u.name
    from whatsapp_links l join users u on u.id = l.user_id
    where l.user_id = ${userId}
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function hasWhatsappLink(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from whatsapp_links where user_id = ${userId}`;
  return rows.length > 0;
}

export async function deleteLink(userId) {
  const sql = getDb();
  await sql`delete from whatsapp_pending where user_id = ${userId}`;
  await sql`delete from whatsapp_links where user_id = ${userId}`;
}

export async function setVoiceReplies(userId, on) {
  const sql = getDb();
  await sql`update whatsapp_links set voice_replies = ${Boolean(on)} where user_id = ${userId}`;
}

export async function saveHistory(userId, history) {
  const sql = getDb();
  const trimmed = history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: String(m.content).slice(0, HISTORY_CHARS) }));
  await sql`update whatsapp_links set history = ${JSON.stringify(trimmed)}, history_at = now(), episode_saved = false where user_id = ${userId}`;
}

export async function markEpisodeSaved(userId) {
  const sql = getDb();
  await sql`update whatsapp_links set episode_saved = true where user_id = ${userId}`;
}

// Meta resends a message when the webhook answers slowly; the first to insert
// its id wins and the duplicate is ignored.
export async function markMessageSeen(messageId) {
  const sql = getDb();
  const rows = await sql`insert into whatsapp_messages (id) values (${messageId}) on conflict do nothing returning id`;
  if (rows.length && Math.random() < 0.02) await sql`delete from whatsapp_messages where received_at < now() - interval '3 days'`;
  return rows.length > 0;
}

export async function addPending(userId, waId, { tool, args, label }) {
  const sql = getDb();
  const rows = await sql`
    insert into whatsapp_pending (user_id, wa_id, tool, args, label)
    values (${userId}, ${waId}, ${tool}, ${JSON.stringify(args)}, ${label || null})
    returning id
  `;
  return rows[0].id;
}

// Takes (and removes) a pending confirmation, only if it belongs to this phone
// and is still fresh (24 hours).
export async function takePending(id, waId) {
  const sql = getDb();
  const rows = await sql`
    delete from whatsapp_pending
    where id = ${id} and wa_id = ${waId} and created_at > now() - interval '24 hours'
    returning id, user_id, tool, args, label
  `;
  return rows[0] || null;
}

export async function latestPending(waId) {
  const sql = getDb();
  const rows = await sql`
    select id from whatsapp_pending
    where wa_id = ${waId} and created_at > now() - interval '24 hours'
    order by created_at desc limit 1
  `;
  return rows[0]?.id || null;
}
