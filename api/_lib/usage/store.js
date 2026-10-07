// Counting side of the daily allowance (see quota.js and
// db/migrations/0015_usage.sql). Never blocks Eddie because of a failure of
// its own: with no database, no user or a database error, requests go through.
import { getDb } from '../db.js';
import { cleanTimezone, currentTanda, limitMessage, quotaConfig } from './quota.js';

// Takes one request from the current tanda. → { allowed: true, release } or
// { allowed: false, message, usage }. `release()` gives it back when the
// request failed before answering anything.
export async function takeRequest(userId, { timezone, now = new Date(), env = process.env } = {}) {
  const config = quotaConfig(env);
  const open = { allowed: true, release: async () => {} };
  if (!config.enabled || !userId || !env.DATABASE_URL) return open;
  try {
    const sql = getDb();
    const t = currentTanda(now, cleanTimezone(timezone, env), config);
    const rows = await sql`
      insert into usage_counters (user_id, day, tanda, used) values (${userId}, ${t.day}, ${t.tanda}, 1)
      on conflict (user_id, day, tanda) do update set used = usage_counters.used + 1
      where usage_counters.used < ${t.limit}
      returning used
    `;
    if (!rows.length) return { allowed: false, message: limitMessage(t, config), usage: await usageFor(userId, { timezone, now, env }) };
    if (rows[0].used === 1 && Math.random() < 0.02) await sql`delete from usage_counters where day < ${t.day}::date - 14`;
    const release = async () => {
      try {
        await sql`update usage_counters set used = greatest(used - 1, 0) where user_id = ${userId} and day = ${t.day} and tanda = ${t.tanda}`;
      } catch (err) {
        console.error('[usage] release failed:', err.message);
      }
    };
    return { allowed: true, release };
  } catch (err) {
    console.error('[usage] counting failed, letting the request through:', err.message);
    return open;
  }
}

// What has been used today: both tandas, and which one is running.
export async function usageFor(userId, { timezone, now = new Date(), env = process.env } = {}) {
  const config = quotaConfig(env);
  const t = currentTanda(now, cleanTimezone(timezone, env), config);
  const used = { am: 0, pm: 0 };
  if (config.enabled && userId && env.DATABASE_URL) {
    const rows = await getDb()`select tanda, used from usage_counters where user_id = ${userId} and day = ${t.day}`;
    for (const r of rows) if (r.tanda in used) used[r.tanda] = Number(r.used);
  }
  return {
    enabled: config.enabled,
    daily: config.daily,
    day: t.day,
    current: t.tanda,
    name: t.name,
    resetsAt: t.resetsAt,
    minutesLeft: t.minutesLeft,
    tandas: {
      am: { limit: config.am, used: Math.min(used.am, config.am) },
      pm: { limit: config.pm, used: Math.min(used.pm, config.pm) },
    },
  };
}

// Gives the running tanda its whole allowance back.
export async function restoreTanda(userId, { timezone, now = new Date(), env = process.env } = {}) {
  const config = quotaConfig(env);
  const t = currentTanda(now, cleanTimezone(timezone, env), config);
  if (config.enabled && userId) await getDb()`update usage_counters set used = 0 where user_id = ${userId} and day = ${t.day} and tanda = ${t.tanda}`;
  return usageFor(userId, { timezone, now, env });
}

export function usageLine(usage) {
  if (!usage.enabled) return 'No hay límite diario de peticiones.';
  const cur = usage.tandas[usage.current];
  const other = usage.tandas[usage.current === 'am' ? 'pm' : 'am'];
  const otherName = usage.current === 'am' ? 'la tarde' : 'la mañana';
  return `Tanda de ${usage.name}: ${cur.used} de ${cur.limit} usadas. Se restaura a las ${usage.resetsAt}${usage.resetsAt.endsWith('.') ? '' : '.'} En ${otherName}: ${other.used} de ${other.limit}.`;
}
