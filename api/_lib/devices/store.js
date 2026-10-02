// Database side of "dispositivos" (see db/migrations/0008_devices.sql).
import { randomBytes } from 'node:crypto';
import { getDb } from '../db.js';
import { COMMAND_TTL_MS } from './logic.js';

const iso = (value) => (value ? new Date(value).toISOString() : null);

function shape(row) {
  return {
    id: row.id,
    userId: row.user_id,
    clientId: row.client_id,
    name: row.name,
    platform: row.platform || '',
    sessionId: row.session_id || null,
    topic: row.topic,
    remoteEnabled: Boolean(row.remote_enabled),
    lastSeen: iso(row.last_seen_at),
    createdAt: iso(row.created_at),
  };
}


// The browser says "I am here" (and its own switch). A new device gets its
// name and secret topic now; a known one keeps its name (only a rename changes it).
export async function touchDevice(userId, { clientId, name, platform, sessionId, remoteEnabled }) {
  const sql = getDb();
  const topic = `eddie-d-${randomBytes(18).toString('base64url')}`;
  const rows = await sql`
    insert into devices (user_id, client_id, name, platform, session_id, topic, remote_enabled, last_seen_at)
    values (${userId}, ${clientId}, ${name}, ${platform}, ${sessionId}, ${topic}, ${remoteEnabled}, now())
    on conflict (user_id, client_id) do update
      set platform = excluded.platform, session_id = excluded.session_id, remote_enabled = excluded.remote_enabled, last_seen_at = now()
    returning id, user_id, client_id, name, platform, session_id, topic, remote_enabled, last_seen_at, created_at
  `;
  return shape(rows[0]);
}

export async function listDevices(userId) {
  const sql = getDb();
  const rows = await sql`select id, user_id, client_id, name, platform, session_id, topic, remote_enabled, last_seen_at, created_at from devices where user_id = ${userId} order by last_seen_at desc`;
  return rows.map(shape);
}

export async function deviceById(userId, id) {
  const sql = getDb();
  const rows = await sql`select id, user_id, client_id, name, platform, session_id, topic, remote_enabled, last_seen_at, created_at from devices where user_id = ${userId} and id = ${id}`;
  return rows[0] ? shape(rows[0]) : null;
}

export async function deviceByClient(userId, clientId) {
  const sql = getDb();
  const rows = await sql`select id, user_id, client_id, name, platform, session_id, topic, remote_enabled, last_seen_at, created_at from devices where user_id = ${userId} and client_id = ${clientId}`;
  return rows[0] ? shape(rows[0]) : null;
}

export async function renameDevice(userId, id, name) {
  const sql = getDb();
  const rows = await sql`update devices set name = ${name} where user_id = ${userId} and id = ${id} returning id`;
  return rows.length > 0;
}

// Deletes the device and returns what it was (so its session can be closed).
export async function removeDevice(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from devices where user_id = ${userId} and id = ${id} returning id, session_id`;
  return rows[0] ? { id: rows[0].id, sessionId: rows[0].session_id || null } : null;
}

export async function createCommand(userId, deviceId, action) {
  const sql = getDb();
  const rows = await sql`insert into device_commands (user_id, device_id, action) values (${userId}, ${deviceId}, ${action}) returning id`;
  if (Math.random() < 0.05) await sql`delete from device_commands where created_at < now() - interval '2 days'`;
  return rows[0].id;
}

// How many fresh commands wait for this device (cheap: rides on the heartbeat).
export async function pendingCount(deviceId) {
  const sql = getDb();
  const rows = await sql`
    select count(*)::int as n from device_commands
    where device_id = ${deviceId} and status = 'pending' and created_at > now() - make_interval(secs => ${COMMAND_TTL_MS / 1000})
  `;
  return rows[0]?.n || 0;
}

// The device takes its fresh commands, oldest first, marking them delivered.
export async function takeCommands(deviceId) {
  const sql = getDb();
  const rows = await sql`
    update device_commands set status = 'delivered'
    where device_id = ${deviceId} and status = 'pending' and created_at > now() - make_interval(secs => ${COMMAND_TTL_MS / 1000})
    returning id, action, created_at
  `;
  return rows.map((r) => ({ id: r.id, action: r.action, createdAt: iso(r.created_at) })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Only the device that took the command answers it, once.
export async function ackCommand(deviceId, id, status, message) {
  const sql = getDb();
  const rows = await sql`
    update device_commands set status = ${status}, message = ${message}, finished_at = now()
    where id = ${id} and device_id = ${deviceId} and status = 'delivered'
    returning id
  `;
  return rows.length > 0;
}

export async function commandState(userId, id) {
  const sql = getDb();
  const rows = await sql`select status, message, action, device_id from device_commands where user_id = ${userId} and id = ${id}`;
  return rows[0] ? { status: rows[0].status, message: rows[0].message || '', action: rows[0].action, deviceId: rows[0].device_id } : null;
}

// The command nobody picked up in time.
export async function expireCommand(id) {
  const sql = getDb();
  const rows = await sql`update device_commands set status = 'expired', finished_at = now() where id = ${id} and status in ('pending', 'delivered') returning id`;
  return rows.length > 0;
}
