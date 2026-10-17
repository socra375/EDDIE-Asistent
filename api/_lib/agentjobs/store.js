// Database side of the background jobs (db/migrations/0038_agent_jobs.sql): a request Eddie works on while the chat
// goes on. queued → running (claimed by one runner) → done | error; the app shows each finished one once (seen_at).
import { getDb } from '../db.js';

export const MAX_ACTIVE = 3; // at once: each one is a full agent loop
export const MAX_PER_HOUR = 20;
export const STALE_SECONDS = 150; // a run is capped at ~60 s: older than this and the function died
const KEEP = 30;

const iso = (v) => (v ? new Date(v).toISOString() : null);
const parse = (v, fallback) => {
  if (Array.isArray(v)) return v;
  try {
    const out = JSON.parse(v);
    return Array.isArray(out) ? out : fallback;
  } catch {
    return fallback;
  }
};

export function shapeJob(row) {
  return {
    id: row.id,
    label: row.label,
    task: row.task,
    status: row.status,
    result: row.result || null,
    error: row.error || null,
    steps: parse(row.steps, []),
    confirmations: parse(row.confirmations, []),
    actions: parse(row.actions, []),
    createdAt: iso(row.created_at),
    finishedAt: iso(row.finished_at),
    seen: Boolean(row.seen_at),
  };
}

// A run whose function died would stay «running» for ever: it becomes an error the user can read.
export async function expireStale(userId) {
  const sql = getDb();
  await sql`
    update agent_jobs set status = 'error', error = 'Se interrumpió antes de terminar.', finished_at = now()
    where user_id = ${userId} and status in ('queued', 'running') and created_at < now() - make_interval(secs => ${STALE_SECONDS})
  `;
}

// → { job } or { error } when the user already has too many going on.
export async function createJob(userId, { label, task, timezone }) {
  const sql = getDb();
  await expireStale(userId);
  const counts = await sql`
    select count(*) filter (where status in ('queued', 'running')) as active,
           count(*) filter (where created_at > now() - interval '1 hour') as recent
    from agent_jobs where user_id = ${userId}
  `;
  if (Number(counts[0]?.active) >= MAX_ACTIVE) return { error: `Ya hay ${MAX_ACTIVE} tareas en segundo plano trabajando; espera a que termine alguna.` };
  if (Number(counts[0]?.recent) >= MAX_PER_HOUR) return { error: 'Llegué al tope de tareas en segundo plano por hora; inténtalo más tarde.' };
  const rows = await sql`
    insert into agent_jobs (user_id, label, task, timezone) values (${userId}, ${label}, ${task}, ${timezone || null}) returning *
  `;
  return { job: shapeJob(rows[0]) };
}

// Only one runner gets a queued job: the update is the claim.
export async function claimJob(userId, id) {
  const sql = getDb();
  const rows = await sql`
    update agent_jobs set status = 'running', started_at = now()
    where id = ${id} and user_id = ${userId} and status = 'queued' returning *
  `;
  return rows[0] ? { ...shapeJob(rows[0]), timezone: rows[0].timezone || null } : null;
}

export async function finishJob(userId, id, { result, steps, confirmations, actions }) {
  const sql = getDb();
  await sql`
    update agent_jobs set status = 'done', result = ${result}, steps = ${JSON.stringify(steps)}, confirmations = ${JSON.stringify(confirmations)},
      actions = ${JSON.stringify(actions)}, finished_at = now()
    where id = ${id} and user_id = ${userId} and status = 'running'
  `;
}

export async function failJob(userId, id, error) {
  const sql = getDb();
  await sql`
    update agent_jobs set status = 'error', error = ${String(error).slice(0, 300)}, finished_at = now()
    where id = ${id} and user_id = ${userId} and status in ('queued', 'running')
  `;
}

// The ones that matter now: still going, or finished and not shown yet; plus the latest few finished for the history.
export async function listJobs(userId) {
  const sql = getDb();
  await expireStale(userId);
  const rows = await sql`select * from agent_jobs where user_id = ${userId} order by created_at desc limit ${KEEP}`;
  return rows.map(shapeJob);
}

export async function markSeen(userId, ids) {
  const sql = getDb();
  const done = await Promise.all(ids.slice(0, KEEP).map((id) => sql`update agent_jobs set seen_at = now() where user_id = ${userId} and id = ${id} and seen_at is null returning id`));
  return done.reduce((n, rows) => n + rows.length, 0);
}

export async function cleanOld(userId) {
  const sql = getDb();
  await sql`delete from agent_jobs where user_id = ${userId} and created_at < now() - interval '14 days'`;
}
