// Database side of routines (see db/migrations/0026_routines.sql).
import { getDb } from '../db.js';

export const MAX_ROUTINES = 30;

function shapeRoutine(row) {
  return {
    id: String(row.id),
    name: row.name,
    triggerType: row.trigger_type,
    time: row.time || null,
    eventType: row.event_type || null,
    deviceId: row.device_id || null,
    actions: Array.isArray(row.actions) ? row.actions : [],
    enabled: Boolean(row.enabled),
    state: row.state && typeof row.state === 'object' ? row.state : {},
  };
}

export async function createRoutine(userId, { name, triggerType, time = null, eventType = null, deviceId = null, actions }) {
  const sql = getDb();
  const rows = await sql`
    insert into routines (user_id, name, trigger_type, time, event_type, device_id, actions)
    values (${userId}, ${name}, ${triggerType}, ${time}, ${eventType}, ${deviceId}, ${JSON.stringify(actions)})
    returning id, name, trigger_type, time, event_type, device_id, actions, enabled, state
  `;
  return shapeRoutine(rows[0]);
}

export async function listRoutines(userId, limit = MAX_ROUTINES) {
  const sql = getDb();
  const rows = await sql`
    select id, name, trigger_type, time, event_type, device_id, actions, enabled, state
    from routines where user_id = ${userId} order by created_at desc limit ${limit}
  `;
  return rows.map(shapeRoutine);
}

// Deletes the one routine matching `name` (case/accent-insensitive substring)
// among the user's own; null if none or more than one match (caller asks
// which, same pattern as pickDevice in computer/run.js).
export async function deleteRoutineByName(userId, name) {
  const sql = getDb();
  const rows = await sql`select id, name from routines where user_id = ${userId}`;
  const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const needle = plain(name);
  const found = rows.filter((r) => plain(r.name).includes(needle) || needle.includes(plain(r.name)));
  if (found.length === 0) return { count: 0, names: rows.map((r) => r.name) };
  if (found.length > 1) return { count: found.length, names: found.map((r) => r.name) };
  await sql`delete from routines where id = ${found[0].id} and user_id = ${userId}`;
  return { count: 1, name: found[0].name };
}

// Routines due for a scheduled run: enabled, trigger_type='schedule', with
// somewhere to deliver (same restriction as reminders/briefings).
export async function dueScheduleRoutines() {
  const sql = getDb();
  const rows = await sql`
    select r.id, r.user_id, r.name, r.time, r.actions, r.last_run_on, l.chat_id, coalesce(l.timezone, 'UTC') as timezone, u.email, u.name as user_name
    from routines r
    left join telegram_links l on l.user_id = r.user_id
    join users u on u.id = r.user_id
    where r.enabled and r.trigger_type = 'schedule'
      and (l.user_id is not null or exists (select 1 from push_subscriptions ps where ps.user_id = r.user_id))
  `;
  return rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id,
    name: r.name,
    time: r.time,
    actions: Array.isArray(r.actions) ? r.actions : [],
    lastRunOn: r.last_run_on ? String(r.last_run_on).slice(0, 10) : null,
    chatId: r.chat_id == null ? null : Number(r.chat_id),
    timezone: r.timezone,
    user: { id: r.user_id, email: r.email, name: r.user_name },
  }));
}

// One run per local day: true for the run that wins the day.
export async function claimRoutineDay(id, date) {
  const sql = getDb();
  const rows = await sql`
    update routines set last_run_on = ${date} where id = ${id} and (last_run_on is null or last_run_on <> ${date}) returning id
  `;
  return rows.length > 0;
}

export async function releaseRoutineDay(id, date) {
  const sql = getDb();
  await sql`update routines set last_run_on = null where id = ${id} and last_run_on = ${date}`;
}

// Event routines due for a check: enabled, trigger_type='event', with a
// computer to watch and somewhere to deliver.
export async function dueEventRoutines() {
  const sql = getDb();
  const rows = await sql`
    select r.id, r.user_id, r.name, r.event_type, r.device_id, r.actions, r.state, l.chat_id, coalesce(l.timezone, 'UTC') as timezone, u.email, u.name as user_name
    from routines r
    left join telegram_links l on l.user_id = r.user_id
    join users u on u.id = r.user_id
    where r.enabled and r.trigger_type = 'event' and r.device_id is not null
      and (l.user_id is not null or exists (select 1 from push_subscriptions ps where ps.user_id = r.user_id))
  `;
  return rows.map((r) => ({
    id: String(r.id),
    userId: r.user_id,
    name: r.name,
    eventType: r.event_type,
    deviceId: r.device_id,
    actions: Array.isArray(r.actions) ? r.actions : [],
    state: r.state && typeof r.state === 'object' ? r.state : {},
    chatId: r.chat_id == null ? null : Number(r.chat_id),
    timezone: r.timezone,
    user: { id: r.user_id, email: r.email, name: r.user_name },
  }));
}

export async function setRoutineState(id, state) {
  const sql = getDb();
  await sql`update routines set state = ${JSON.stringify(state)} where id = ${id}`;
}
