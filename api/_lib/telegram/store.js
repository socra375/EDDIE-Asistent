// Database side of the Telegram bot (see db/migrations/0002_telegram.sql).
import { randomInt } from 'node:crypto';
import { getDb } from '../db.js';

const LINK_CODE_MINUTES = 10;
const HISTORY_MESSAGES = 12;
const HISTORY_CHARS = 1500;
// Without I, O, 0, 1: a code read aloud or typed by hand can't be mistaken.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newLinkCode() {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

export async function createLinkCode(userId, timezone) {
  const sql = getDb();
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_MINUTES * 60000).toISOString();
  // One live code per user: asking again replaces the old one.
  await sql`delete from telegram_link_codes where user_id = ${userId} or expires_at < now()`;
  await sql`insert into telegram_link_codes (code, user_id, timezone, expires_at) values (${code}, ${userId}, ${timezone}, ${expiresAt})`;
  return { code, minutes: LINK_CODE_MINUTES };
}

// Links `chatId` to the user who made `code`, consuming the code. Returns the
// user id, or null when the code is unknown, used or expired.
export async function consumeLinkCode(code, chatId) {
  const sql = getDb();
  const rows = await sql`delete from telegram_link_codes where code = ${code} and expires_at > now() returning user_id, timezone`;
  if (!rows[0]) return null;
  const { user_id: userId, timezone } = rows[0];
  // A chat belongs to one user and a user to one chat; re-linking moves it.
  await sql`delete from telegram_links where chat_id = ${chatId} and user_id <> ${userId}`;
  await sql`
    insert into telegram_links (user_id, chat_id, timezone, history, linked_at)
    values (${userId}, ${chatId}, ${timezone}, '[]', now())
    on conflict (user_id) do update set chat_id = excluded.chat_id, timezone = excluded.timezone, history = '[]', linked_at = now()
  `;
  return userId;
}

export async function getLinkByChat(chatId) {
  const sql = getDb();
  const rows = await sql`
    select l.user_id, l.chat_id, l.timezone, l.voice_replies, l.history, l.history_at, l.episode_saved, u.email, u.name
    from telegram_links l join users u on u.id = l.user_id
    where l.chat_id = ${chatId}
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

export async function getLinkByUser(userId) {
  const sql = getDb();
  const rows = await sql`
    select l.user_id, l.chat_id, l.timezone, l.voice_replies, l.history, l.history_at, l.episode_saved, u.email, u.name
    from telegram_links l join users u on u.id = l.user_id
    where l.user_id = ${userId}
  `;
  return rows[0] ? shapeLink(rows[0]) : null;
}

function shapeLink(row) {
  return {
    userId: row.user_id,
    chatId: Number(row.chat_id),
    timezone: row.timezone,
    voiceReplies: Boolean(row.voice_replies),
    history: Array.isArray(row.history) ? row.history : [],
    // When the thread last moved, and whether its notes were already kept
    // (conversation memory): undefined when the columns aren't there yet.
    historyAt: row.history_at ? new Date(row.history_at).toISOString() : null,
    episodeSaved: row.episode_saved === undefined ? undefined : Boolean(row.episode_saved),
    user: { id: row.user_id, email: row.email, name: row.name },
  };
}

export async function hasTelegramLink(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from telegram_links where user_id = ${userId}`;
  return rows.length > 0;
}

export async function deleteLink(userId) {
  const sql = getDb();
  await sql`delete from telegram_pending where user_id = ${userId}`;
  await sql`delete from telegram_links where user_id = ${userId}`;
}

export async function setVoiceReplies(userId, on) {
  const sql = getDb();
  await sql`update telegram_links set voice_replies = ${Boolean(on)} where user_id = ${userId}`;
}

// The conversation's notes were kept (or there was nothing to keep).
export async function markEpisodeSaved(userId) {
  const sql = getDb();
  await sql`update telegram_links set episode_saved = true where user_id = ${userId}`;
}

export async function saveHistory(userId, history) {
  const sql = getDb();
  const trimmed = history.slice(-HISTORY_MESSAGES).map((m) => ({ role: m.role, content: String(m.content).slice(0, HISTORY_CHARS) }));
  await sql`update telegram_links set history = ${JSON.stringify(trimmed)}, history_at = now(), episode_saved = false where user_id = ${userId}`;
}

// Telegram resends an update when the webhook answers slowly; the first to
// insert its id wins and the duplicate is ignored.
export async function markUpdateSeen(updateId) {
  const sql = getDb();
  const rows = await sql`insert into telegram_updates (update_id) values (${updateId}) on conflict do nothing returning update_id`;
  if (rows.length && Number(updateId) % 50 === 0) await sql`delete from telegram_updates where received_at < now() - interval '2 days'`;
  return rows.length > 0;
}

export async function addPending(userId, chatId, { tool, args, label }) {
  const sql = getDb();
  const rows = await sql`
    insert into telegram_pending (user_id, chat_id, tool, args, label)
    values (${userId}, ${chatId}, ${tool}, ${JSON.stringify(args)}, ${label || null})
    returning id
  `;
  return rows[0].id;
}

// Takes (and removes) a pending confirmation, only if it belongs to this chat
// and is still fresh (24 hours) — a button from an old message can't fire days later.
export async function takePending(id, chatId) {
  const sql = getDb();
  const rows = await sql`
    delete from telegram_pending
    where id = ${id} and chat_id = ${chatId} and created_at > now() - interval '24 hours'
    returning id, user_id, tool, args, label
  `;
  return rows[0] || null;
}

export async function latestPending(chatId) {
  const sql = getDb();
  const rows = await sql`
    select id from telegram_pending
    where chat_id = ${chatId} and created_at > now() - interval '24 hours'
    order by created_at desc limit 1
  `;
  return rows[0]?.id || null;
}
