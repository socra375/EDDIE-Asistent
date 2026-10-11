// Database side of browser tasks (see db/migrations/0027_browser_tasks.sql):
// one confirmed goal, one tab, a screenshot-decide-act loop driven by the
// extension (api/_lib/browser/agentStep.js decides each step; the extension
// executes it and asks again).
import { getDb } from '../db.js';

export const MAX_ACTIONS_DEFAULT = 25;
export const TASK_MAX_MINUTES = 4;

function shapeTask(row) {
  return {
    id: row.id,
    userId: row.user_id,
    goal: row.goal,
    startUrl: row.start_url,
    status: row.status,
    actionCount: row.action_count,
    maxActions: row.max_actions,
    stopRequested: row.stop_requested,
    result: row.result || null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

export async function createTask(userId, { goal, startUrl, maxActions = MAX_ACTIONS_DEFAULT }) {
  const sql = getDb();
  const rows = await sql`
    insert into browser_tasks (user_id, goal, start_url, max_actions)
    values (${userId}, ${goal}, ${startUrl}, ${maxActions})
    returning *
  `;
  return shapeTask(rows[0]);
}

export async function getTask(id) {
  const sql = getDb();
  const rows = await sql`select * from browser_tasks where id = ${id}`;
  return rows[0] ? shapeTask(rows[0]) : null;
}

// The one task the extension should start: confirmed but never picked up yet
// (no step has run). Once the extension's first task-step call bumps
// action_count, this stops returning it — self-clearing, no separate flag.
export async function pendingTaskFor(userId) {
  const sql = getDb();
  const rows = await sql`
    select * from browser_tasks
    where user_id = ${userId} and status = 'running' and action_count = 0
    order by started_at desc limit 1
  `;
  return rows[0] ? shapeTask(rows[0]) : null;
}

export async function latestTaskFor(userId) {
  const sql = getDb();
  const rows = await sql`select * from browser_tasks where user_id = ${userId} order by started_at desc limit 1`;
  return rows[0] ? shapeTask(rows[0]) : null;
}

// The user asked to stop (the extension popup, or the browser_task_stop
// tool): checked on the task's very next step. → whether a running task existed.
export async function requestStop(userId) {
  const sql = getDb();
  const rows = await sql`
    update browser_tasks set stop_requested = true, updated_at = now()
    where user_id = ${userId} and status = 'running'
    returning id
  `;
  return rows.length > 0;
}

// One more action happened (bumps the counter), or the task is over (sets
// its final status and, often, a one-line result). Either way, only while it
// was still 'running' — a task already finished never changes again.
export async function recordStep(id, { finish, result } = {}) {
  const sql = getDb();
  const rows = finish
    ? await sql`
        update browser_tasks set status = ${finish}, result = ${result || null}, updated_at = now()
        where id = ${id} and status = 'running'
        returning *
      `
    : await sql`
        update browser_tasks set action_count = action_count + 1, updated_at = now()
        where id = ${id} and status = 'running'
        returning *
      `;
  return rows[0] ? shapeTask(rows[0]) : null;
}
