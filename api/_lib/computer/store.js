// Database side of EDDIE Prime (see db/migrations/0006_computer.sql).
import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db.js';
import { newLinkCode } from '../telegram/store.js';

const PAIR_MINUTES = 10;
// A job nobody picked up for this long is stale: the user has moved on.
const QUEUE_SECONDS = 60;

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');

// `minutes`: how long the code lasts (the one-click installer's lasts longer: it is downloaded, then run).
export async function createPairCode(userId, minutes = PAIR_MINUTES) {
  const sql = getDb();
  const code = newLinkCode();
  const expiresAt = new Date(Date.now() + minutes * 60000).toISOString();
  await sql`delete from computer_pair_codes where user_id = ${userId} or expires_at < now()`;
  await sql`insert into computer_pair_codes (code, user_id, expires_at) values (${code}, ${userId}, ${expiresAt})`;
  return { code, minutes };
}

// The user who made `code` (consuming it), or null when unknown/used/expired.
export async function consumePairCode(code) {
  const sql = getDb();
  const rows = await sql`delete from computer_pair_codes where code = ${code} and expires_at > now() returning user_id`;
  return rows[0]?.user_id || null;
}

// Links a computer to the user: the same computer again (same name) replaces its earlier link, another one is added. The token is
// returned once, to the agent; only its hash is kept.
export async function createDevice(userId, { name, version, tools, platform = null }) {
  const sql = getDb();
  const token = randomBytes(32).toString('base64url');
  const topic = `eddie-${randomBytes(18).toString('base64url')}`;
  await sql`
    insert into computer_devices (user_id, name, token_hash, topic, tools, agent_version, platform, last_seen_at)
    values (${userId}, ${name}, ${hashToken(token)}, ${topic}, ${JSON.stringify(tools)}, ${version}, ${platform}, now())
    on conflict (user_id, name) do update set token_hash = excluded.token_hash, topic = excluded.topic,
      tools = excluded.tools, agent_version = excluded.agent_version, platform = excluded.platform, last_seen_at = now(), created_at = now()
  `;
  return { token, topic };
}

function shapeDevice(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    topic: row.topic,
    tools: Array.isArray(row.tools) ? row.tools : [],
    version: row.agent_version || null,
    platform: row.platform || null,
    lastSeen: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
  };
}

// The agent behind a bearer token (and a fresh "last seen"), or null.
export async function deviceByToken(token) {
  if (!token || token.length > 100) return null;
  const sql = getDb();
  const rows = await sql`
    update computer_devices set last_seen_at = now() where token_hash = ${hashToken(token)}
    returning id, user_id, name, topic, tools, agent_version, platform, last_seen_at
  `;
  return rows[0] ? shapeDevice(rows[0]) : null;
}

// Every computer of the user, the one heard from most recently first.
export async function devicesByUser(userId) {
  const sql = getDb();
  const rows = await sql`select id, user_id, name, topic, tools, agent_version, platform, last_seen_at from computer_devices where user_id = ${userId} order by last_seen_at desc nulls last, name`;
  return rows.map(shapeDevice);
}

// The most recently seen computer (for the places that show just one).
export async function deviceByUser(userId) {
  return (await devicesByUser(userId))[0] || null;
}

export async function hasDevice(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from computer_devices where user_id = ${userId}`;
  return rows.length > 0;
}

export async function updateCatalog(deviceId, { version, tools, platform = null }) {
  const sql = getDb();
  await sql`update computer_devices set tools = ${JSON.stringify(tools)}, agent_version = ${version}, platform = coalesce(${platform}, platform) where id = ${deviceId}`;
}

// One computer (by id), or all of the user's when no id is given.
export async function deleteDevice(userId, id = null) {
  const sql = getDb();
  if (id) await sql`delete from computer_devices where user_id = ${userId} and id = ${id}`;
  else await sql`delete from computer_devices where user_id = ${userId}`;
}

export async function createJob(deviceId, tool, args) {
  const sql = getDb();
  const rows = await sql`insert into computer_jobs (device_id, tool, args) values (${deviceId}, ${tool}, ${JSON.stringify(args)}) returning id`;
  if (Math.random() < 0.05) await sql`delete from computer_jobs where created_at < now() - interval '2 days'`;
  return rows[0].id;
}

// The oldest fresh job for this computer, marked as running — or null.
export async function takeJob(deviceId) {
  const sql = getDb();
  const rows = await sql`
    update computer_jobs set status = 'running', taken_at = now()
    where id = (
      select id from computer_jobs
      where device_id = ${deviceId} and status = 'queued' and created_at > now() - make_interval(secs => ${QUEUE_SECONDS})
      order by created_at limit 1
      for update skip locked
    )
    returning id, tool, args
  `;
  return rows[0] ? { id: rows[0].id, tool: rows[0].tool, args: rows[0].args || {} } : null;
}

// Only the computer that took the job can finish it, once.
export async function finishJob(deviceId, jobId, { ok, result, error }) {
  const sql = getDb();
  const rows = await sql`
    update computer_jobs set status = ${ok ? 'done' : 'error'}, result = ${ok ? JSON.stringify(result ?? null) : null},
      error = ${ok ? null : error}, finished_at = now()
    where id = ${jobId} and device_id = ${deviceId} and status = 'running'
    returning id
  `;
  return rows.length > 0;
}

export async function jobState(jobId) {
  const sql = getDb();
  const rows = await sql`select status, result, error from computer_jobs where id = ${jobId}`;
  return rows[0] || null;
}

// Gives up on a job still waiting in the queue; false if the computer took it meanwhile.
export async function expireJob(jobId) {
  const sql = getDb();
  const rows = await sql`update computer_jobs set status = 'expired', finished_at = now() where id = ${jobId} and status = 'queued' returning id`;
  return rows.length > 0;
}

export async function abandonJob(jobId) {
  const sql = getDb();
  await sql`update computer_jobs set status = 'expired', finished_at = now() where id = ${jobId} and status in ('queued', 'running')`;
}

// open_app asks once per app per computer: these two back that (see
// computer_action in api/_lib/connectors/computer/index.js).
export async function isAppGranted(deviceId, appKey) {
  const sql = getDb();
  const rows = await sql`select 1 from computer_app_grants where device_id = ${deviceId} and app_key = ${appKey}`;
  return rows.length > 0;
}

export async function grantApp(deviceId, appKey) {
  const sql = getDb();
  await sql`insert into computer_app_grants (device_id, app_key) values (${deviceId}, ${appKey}) on conflict do nothing`;
}
