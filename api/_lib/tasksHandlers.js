import { getDb } from './db.js';
import { requireUser } from './session.js';

// The driver may hand back a `date` column as either a plain string or a
// parsed JS Date, depending on version/config — normalize to 'YYYY-MM-DD'
// so the frontend (which uses it as an <input type="date"> value) always
// gets the same shape.
function toDateString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

function serializeTask(row) {
  return {
    id: row.id,
    title: row.title,
    dueDate: toDateString(row.due_date),
    priority: row.priority,
    done: row.done,
    googleEventId: row.google_event_id,
  };
}

export async function listTasks(cookies) {
  const user = await requireUser(cookies);
  const sql = getDb();
  const rows = await sql`select * from tasks where user_id = ${user.id} order by created_at asc`;
  return { status: 200, json: { tasks: rows.map(serializeTask) } };
}

export async function createTask(cookies, body) {
  const user = await requireUser(cookies);
  if (!body?.title?.trim()) {
    const err = new Error('El título de la tarea es obligatorio.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const priority = ['alta', 'media', 'baja'].includes(body.priority) ? body.priority : 'media';
  const sql = getDb();
  const rows = await sql`
    insert into tasks (user_id, title, due_date, priority)
    values (${user.id}, ${body.title.trim()}, ${body.dueDate || null}, ${priority})
    returning *
  `;
  return { status: 200, json: { task: serializeTask(rows[0]) } };
}

export async function updateTask(cookies, id, body) {
  const user = await requireUser(cookies);
  const sql = getDb();
  const rows = await sql`
    update tasks set
      title = coalesce(${body.title ?? null}, title),
      due_date = coalesce(${body.dueDate ?? null}, due_date),
      priority = coalesce(${body.priority ?? null}, priority),
      done = coalesce(${typeof body.done === 'boolean' ? body.done : null}, done),
      google_event_id = coalesce(${body.googleEventId ?? null}, google_event_id),
      updated_at = now()
    where id = ${id} and user_id = ${user.id}
    returning *
  `;
  if (!rows[0]) {
    const err = new Error('Tarea no encontrada.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  return { status: 200, json: { task: serializeTask(rows[0]) } };
}

export async function removeTask(cookies, id) {
  const user = await requireUser(cookies);
  const sql = getDb();
  await sql`delete from tasks where id = ${id} and user_id = ${user.id}`;
  return { status: 200, json: { ok: true } };
}
