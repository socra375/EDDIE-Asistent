// The chat tools for Tareas and Memoria don't write anything: they emit
// actions that "the app" applies (see applyTaskActions / applyMemoryActions).
// From Telegram there is no browser, so this applies the same actions to the
// user's rows in the database — the very rows the web app syncs with.
import { getDb } from '../db.js';
import { applyActions, normalizeMemory, memoryForContext } from '../../../src/services/memory.js';

const TASK_CONTEXT_LIMIT = 50;

// The user's tasks, in the shape the chat tools expect (context.tasks) and
// the extra fields the system prompt shows (priority, due date).
export async function loadTasks(userId) {
  const sql = getDb();
  const rows = await sql`select id, title, done, priority, due_date from tasks where user_id = ${userId} order by created_at asc limit ${TASK_CONTEXT_LIMIT}`;
  const due = (d) => (d ? (typeof d === 'string' ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10)) : null);
  return rows.map((t) => ({ id: String(t.id), title: t.title, done: Boolean(t.done), priority: t.priority, dueDate: due(t.due_date) }));
}

export async function loadMemory(userId) {
  const sql = getDb();
  const rows = await sql`select data from memory where user_id = ${userId}`;
  return normalizeMemory(rows[0]?.data);
}

export async function loadSettings(userId) {
  const sql = getDb();
  const rows = await sql`select data from settings where user_id = ${userId}`;
  return rows[0]?.data && typeof rows[0].data === 'object' ? rows[0].data : {};
}

export async function loadUserContext(userId) {
  const [tasks, memory, settings] = await Promise.all([loadTasks(userId), loadMemory(userId), loadSettings(userId)]);
  const memoryOn = settings.memoryEnabled !== false;
  return {
    tasks,
    toolTasks: tasks.map(({ id, title, done }) => ({ id, title, done })),
    memory,
    settings,
    memoryOn,
    memoryForTools: memoryOn ? memoryForContext(memory) : [],
  };
}

async function applyTaskAction(sql, userId, action) {
  if (action.type === 'create_task' && action.task?.title) {
    const { title, dueDate, priority } = action.task;
    const p = ['alta', 'media', 'baja'].includes(priority) ? priority : 'media';
    await sql`insert into tasks (user_id, title, due_date, priority) values (${userId}, ${title}, ${dueDate || null}, ${p})`;
    return `Tarea creada: ${title}`;
  }
  if (action.type === 'complete_task' && action.id) {
    const rows = await sql`update tasks set done = true, updated_at = now() where id = ${action.id} and user_id = ${userId} returning id`;
    return rows.length ? `Tarea hecha: ${action.title}` : null;
  }
  if (action.type === 'delete_task' && action.id) {
    const rows = await sql`delete from tasks where id = ${action.id} and user_id = ${userId} returning id`;
    return rows.length ? `Tarea borrada: ${action.title}` : null;
  }
  return null;
}

// Returns the one-line labels of what changed ("Tarea creada: …", "Recordé: …").
export async function applyActionsForUser(userId, actions, { memoryEnabled = true } = {}) {
  if (!Array.isArray(actions) || !actions.length) return [];
  const sql = getDb();
  const labels = [];
  for (const action of actions) {
    try {
      const label = await applyTaskAction(sql, userId, action);
      if (label) labels.push(label);
    } catch (err) {
      console.error('[telegram] task action failed:', err.message);
    }
  }
  const memoryActions = actions.filter((a) => String(a?.type || '').startsWith('memory_'));
  if (memoryActions.length && memoryEnabled) {
    try {
      const { memory, applied } = applyActions(await loadMemory(userId), memoryActions);
      if (applied.length) {
        await sql`
          insert into memory (user_id, data, updated_at) values (${userId}, ${JSON.stringify(memory)}, now())
          on conflict (user_id) do update set data = excluded.data, updated_at = now()
        `;
        labels.push(...applied);
      }
    } catch (err) {
      console.error('[telegram] memory action failed:', err.message);
    }
  }
  return labels;
}
