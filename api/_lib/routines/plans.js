// The browser extension keeps the user's tab orders on its own clock: «a las 3 cierra YouTube» happens at 3:00 and not at the
// next cron tick (GitHub's can be minutes late, and a closed browser cannot be reached at all). Every ten minutes the
// extension asks for the orders of the next day and a half (agent/agenda → `plans`), sets an alarm for each, runs them when
// it rings and says so (agent/plan-done) so that the cron does not do them again. If the extension could not (browser closed
// at the time), the cron still sends the order, with a quarter of an hour of patience (routines/tabsRun.js).
import { addDays, localParts, zonedEpoch } from '../connectors/dates.js';
import { runsOn } from '../../../src/services/weekdays.js';
import { disableRoutine, markTabsDone, scheduleRoutinesOf } from './store.js';
import { hasTabActions, stepsOf, TAB_ACTION_TYPES } from './tabs.js';

export const PLAN_AHEAD_MS = 36 * 3600_000;
export const PLAN_LATE_MS = 15 * 60_000;
const MAX_PLANS = 20;
const KEY_RE = /^([0-9a-f-]{36})@(\d{4}-\d{2}-\d{2})$/i;

export const validTimezone = (value) => {
  if (typeof value !== 'string' || value.length > 60) return null;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return null;
  }
};

// → [{ key, at, name, steps }]  `at` is when to run it (ms since 1970); oldest first.
export async function upcomingPlans(userId, { timezone, now = new Date() }, deps = {}) {
  const tz = validTimezone(timezone) || 'UTC';
  const routines = await (deps.scheduleRoutinesOf || scheduleRoutinesOf)(userId);
  const today = localParts(now.toISOString(), tz).date;
  const dates = [addDays(today, -1), today, addDays(today, 1), addDays(today, 2)];
  const plans = [];
  for (const routine of routines) {
    if (!hasTabActions(routine.actions) || !/^\d{2}:\d{2}$/.test(routine.time || '')) continue;
    const steps = stepsOf(routine.actions.filter((a) => TAB_ACTION_TYPES.includes(a.type)));
    let taken = 0;
    for (const date of dates) {
      if (!runsOn(routine.days, date) || routine.state?.tabsDoneOn === date) continue;
      const at = zonedEpoch(date, routine.time, tz);
      if (at < now.getTime() - PLAN_LATE_MS || at > now.getTime() + PLAN_AHEAD_MS) continue;
      plans.push({ key: `${routine.id}@${date}`, at, name: routine.name, steps });
      taken += 1;
      if (routine.state?.once || taken >= 2) break; // a «once» routine is one occurrence, not every day from now on
    }
  }
  return plans.sort((a, b) => a.at - b.at).slice(0, MAX_PLANS);
}

// The extension did the plan `key`. → { ok } | { error }
export async function completePlan(userId, key, deps = {}) {
  const m = KEY_RE.exec(String(key || ''));
  if (!m) return { error: 'Esa clave no es de un plan.' };
  const state = await (deps.markTabsDone || markTabsDone)(userId, m[1], m[2]);
  if (!state) return { error: 'Esa rutina no es tuya o ya no existe.' };
  if (state.once) await (deps.disableRoutine || disableRoutine)(m[1]);
  return { ok: true };
}
