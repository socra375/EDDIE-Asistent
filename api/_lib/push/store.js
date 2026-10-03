// Database side of Web Push (see db/migrations/0009_push.sql).
import { getDb } from '../db.js';

export const MAX_SUBSCRIPTIONS = 10;

const shape = (r) => ({ id: r.id, userId: r.user_id, clientId: r.client_id || null, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, platform: r.platform || '' });

export async function readKeys() {
  const sql = getDb();
  const rows = await sql`select public_key, private_key from push_keys where id = 1`;
  return rows[0] ? { publicKey: rows[0].public_key, privateKey: rows[0].private_key } : null;
}

// The first writer wins; whoever lost reads the winner's keys back.
export async function saveKeys(publicKey, privateKey) {
  const sql = getDb();
  await sql`insert into push_keys (id, public_key, private_key) values (1, ${publicKey}, ${privateKey}) on conflict (id) do nothing`;
  return readKeys();
}

export async function subscriptionsOf(userId) {
  const sql = getDb();
  const rows = await sql`select id, user_id, client_id, endpoint, p256dh, auth, platform from push_subscriptions where user_id = ${userId} order by created_at desc`;
  return rows.map(shape);
}

export async function hasSubscription(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from push_subscriptions where user_id = ${userId} limit 1`;
  return rows.length > 0;
}

export async function saveSubscription(userId, { clientId, endpoint, p256dh, auth, platform }) {
  const sql = getDb();
  await sql`
    insert into push_subscriptions (user_id, client_id, endpoint, p256dh, auth, platform)
    values (${userId}, ${clientId}, ${endpoint}, ${p256dh}, ${auth}, ${platform})
    on conflict (endpoint) do update
      set user_id = excluded.user_id, client_id = excluded.client_id, p256dh = excluded.p256dh, auth = excluded.auth,
          platform = excluded.platform, failures = 0
  `;
}

export async function removeSubscription(userId, endpoint) {
  const sql = getDb();
  const rows = await sql`delete from push_subscriptions where user_id = ${userId} and endpoint = ${endpoint} returning id`;
  return rows.length > 0;
}

export async function hasEndpoint(userId, endpoint) {
  const sql = getDb();
  const rows = await sql`select 1 from push_subscriptions where user_id = ${userId} and endpoint = ${endpoint}`;
  return rows.length > 0;
}

// The push service says this browser is gone (404/410): forget it.
export async function dropEndpoint(endpoint) {
  const sql = getDb();
  await sql`delete from push_subscriptions where endpoint = ${endpoint}`;
}

export async function markResult(endpoint, ok) {
  const sql = getDb();
  if (ok) await sql`update push_subscriptions set failures = 0, last_ok_at = now() where endpoint = ${endpoint}`;
  else await sql`update push_subscriptions set failures = failures + 1 where endpoint = ${endpoint}`;
}

// A subscription that keeps failing for something other than "gone" is dropped after a while.
export async function purgeFailing(max = 8) {
  const sql = getDb();
  await sql`delete from push_subscriptions where failures >= ${max}`;
}
