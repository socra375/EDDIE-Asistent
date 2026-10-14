// Database side of Recepción (see db/migrations/0033_reception.sql).
import { getDb } from '../db.js';
import { MAX_MESSAGES, cleanHours } from '../../../src/services/reception.js';

const DEFAULT_SLOT = 30;

const shapeMessage = (row) => ({
  id: String(row.id),
  from: row.from_name,
  phone: row.phone || '',
  message: row.message,
  urgent: Boolean(row.urgent),
  handled: Boolean(row.handled),
  createdAt: new Date(row.created_at).toISOString(),
});

export async function getSettings(userId) {
  const sql = getDb();
  const rows = await sql`select hours, slot_minutes from reception_settings where user_id = ${userId}`;
  if (!rows[0]) return { hours: {}, slotMinutes: DEFAULT_SLOT };
  const raw = typeof rows[0].hours === 'string' ? JSON.parse(rows[0].hours) : rows[0].hours;
  return { hours: cleanHours(raw), slotMinutes: Number(rows[0].slot_minutes) || DEFAULT_SLOT };
}

export async function saveSettings(userId, { hours, slotMinutes }) {
  const sql = getDb();
  await sql`
    insert into reception_settings (user_id, hours, slot_minutes)
    values (${userId}, ${JSON.stringify(cleanHours(hours))}::jsonb, ${slotMinutes})
    on conflict (user_id) do update set hours = excluded.hours, slot_minutes = excluded.slot_minutes, updated_at = now()
  `;
}

export async function addMessage(userId, { from, phone, message, urgent }) {
  const sql = getDb();
  const rows = await sql`
    insert into reception_messages (user_id, from_name, phone, message, urgent)
    values (${userId}, ${from}, ${phone}, ${message}, ${urgent})
    returning id, from_name, phone, message, urgent, handled, created_at
  `;
  return shapeMessage(rows[0]);
}

// Newest first, urgent ones on top. `handled`: false = open, true = done, null = all.
export async function listMessages(userId, { handled = false, limit = MAX_MESSAGES } = {}) {
  const sql = getDb();
  const rows = await sql`
    select id, from_name, phone, message, urgent, handled, created_at
    from reception_messages
    where user_id = ${userId} and (${handled}::boolean is null or handled = ${handled}::boolean)
    order by urgent desc, created_at desc limit ${limit}
  `;
  return rows.map(shapeMessage);
}

export async function markHandled(userId, id) {
  const sql = getDb();
  const rows = await sql`
    update reception_messages set handled = true, handled_at = now()
    where id = ${id} and user_id = ${userId}
    returning id, from_name, phone, message, urgent, handled, created_at
  `;
  return rows[0] ? shapeMessage(rows[0]) : null;
}
