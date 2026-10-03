// Database side of reminders and the morning summary
// (see db/migrations/0003_reminders.sql).
import { getDb } from '../db.js';

export const MAX_PENDING_REMINDERS = 50;
const MAX_ATTEMPTS = 5;

export async function addReminder(userId, text, dueAt, timezone = null) {
  const sql = getDb();
  const rows = await sql`
    insert into reminders (user_id, text, due_at, timezone) values (${userId}, ${text}, ${dueAt}, ${timezone})
    returning id, text, due_at
  `;
  return shapeReminder(rows[0]);
}

export async function getReminder(userId, id) {
  const sql = getDb();
  const rows = await sql`select id, text, due_at, sent_at from reminders where id = ${id} and user_id = ${userId}`;
  return rows[0] ? { ...shapeReminder(rows[0]), sent: Boolean(rows[0].sent_at) } : null;
}

export async function listPendingReminders(userId, limit = MAX_PENDING_REMINDERS) {
  const sql = getDb();
  const rows = await sql`
    select id, text, due_at from reminders
    where user_id = ${userId} and sent_at is null
    order by due_at asc limit ${limit}
  `;
  return rows.map(shapeReminder);
}

export async function deleteReminder(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from reminders where id = ${id} and user_id = ${userId} and sent_at is null returning id`;
  return rows.length > 0;
}

function shapeReminder(row) {
  return { id: String(row.id), text: row.text, dueAt: new Date(row.due_at).toISOString() };
}

// Reminders whose time has come, with the chat to tell (null if Telegram is
// not linked). Only users with somewhere to deliver them: Telegram or a device
// with notifications on.
export async function dueReminders(limit = 40) {
  const sql = getDb();
  const rows = await sql`
    select r.id, r.text, r.due_at, r.user_id, l.chat_id, coalesce(r.timezone, l.timezone, 'UTC') as timezone
    from reminders r left join telegram_links l on l.user_id = r.user_id
    where r.sent_at is null and r.due_at <= now()
      and (l.user_id is not null or exists (select 1 from push_subscriptions ps where ps.user_id = r.user_id))
    order by r.due_at asc limit ${limit}
  `;
  return rows.map((r) => ({ ...shapeReminder(r), userId: r.user_id, chatId: r.chat_id == null ? null : Number(r.chat_id), timezone: r.timezone }));
}

// Takes a reminder for sending; false if another run already did.
export async function claimReminder(id) {
  const sql = getDb();
  const rows = await sql`update reminders set sent_at = now() where id = ${id} and sent_at is null returning id`;
  return rows.length > 0;
}

// Telegram refused the message: give it back for the next run, up to a few
// attempts, then let it go so one broken reminder can't loop forever.
export async function releaseReminder(id) {
  const sql = getDb();
  await sql`
    update reminders set attempts = attempts + 1,
      sent_at = case when attempts + 1 >= ${MAX_ATTEMPTS} then now() else null end
    where id = ${id}
  `;
}

// Sent reminders older than a week are just clutter.
export async function purgeOldReminders() {
  const sql = getDb();
  await sql`delete from reminders where sent_at is not null and sent_at < now() - interval '7 days'`;
}

export async function getBriefing(userId) {
  const sql = getDb();
  const rows = await sql`select enabled, send_time from briefing_settings where user_id = ${userId}`;
  return rows[0] ? { enabled: Boolean(rows[0].enabled), time: rows[0].send_time } : { enabled: false, time: '07:00' };
}

export async function setBriefing(userId, { enabled, time, timezone = null }) {
  const sql = getDb();
  await sql`
    insert into briefing_settings (user_id, enabled, send_time, timezone) values (${userId}, ${Boolean(enabled)}, ${time}, ${timezone})
    on conflict (user_id) do update set enabled = excluded.enabled, send_time = excluded.send_time, timezone = coalesce(excluded.timezone, briefing_settings.timezone),
      last_sent_on = case when excluded.enabled and (not briefing_settings.enabled or briefing_settings.send_time <> excluded.send_time) then null else briefing_settings.last_sent_on end
  `;
}

// Everyone with the summary on and somewhere to receive it (Telegram linked or a device with notifications on).
export async function enabledBriefings() {
  const sql = getDb();
  const rows = await sql`
    select b.user_id, b.send_time, b.last_sent_on, l.chat_id, coalesce(b.timezone, l.timezone, 'UTC') as timezone, u.email, u.name
    from briefing_settings b
    left join telegram_links l on l.user_id = b.user_id
    join users u on u.id = b.user_id
    where b.enabled and (l.user_id is not null or exists (select 1 from push_subscriptions ps where ps.user_id = b.user_id))
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    time: r.send_time,
    lastSentOn: r.last_sent_on ? String(r.last_sent_on).slice(0, 10) : null,
    chatId: r.chat_id == null ? null : Number(r.chat_id),
    timezone: r.timezone,
    user: { id: r.user_id, email: r.email, name: r.name },
  }));
}

// One summary per local day: true for the run that wins the day.
export async function claimBriefingDay(userId, date) {
  const sql = getDb();
  const rows = await sql`
    update briefing_settings set last_sent_on = ${date}
    where user_id = ${userId} and (last_sent_on is null or last_sent_on <> ${date})
    returning user_id
  `;
  return rows.length > 0;
}

// The summary couldn't be sent: free the day so the next run tries again.
export async function releaseBriefingDay(userId, date) {
  const sql = getDb();
  await sql`update briefing_settings set last_sent_on = null where user_id = ${userId} and last_sent_on = ${date}`;
}
