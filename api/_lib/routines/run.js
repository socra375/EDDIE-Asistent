// Runs due routines: the schedule ones (once a day, like the morning
// briefing) and the event ones (checked every cron tick against a linked
// computer — see api/_lib/connectors/computer/). Called from the same cron
// as reminders and briefings (api/_lib/reminders/cron.js).
import { deliver, telegramSend } from '../reminders/run.js';
import { sendPush } from '../push/send.js';
import { localParts } from '../connectors/dates.js';
import { runsOn } from '../../../src/services/weekdays.js';
import { devicesByUser } from '../computer/store.js';
import { runOnDevice } from '../computer/run.js';
import { mapLimit } from '../pool.js';
import { BOOT_ACTIONS } from './boot.js';
import { runRoutineActions } from './actions.js';
import { claimBootPending, claimRoutineDay, disableRoutine, dueEventRoutines, dueScheduleRoutines, releaseRoutineDay, setRoutineState } from './store.js';
import { TAB_ACTION_TYPES } from './tabs.js';

// A routine this long after its hour isn't run (same reasoning as the
// morning briefing: nobody wants "a las 8" showing up at 3pm).
const SCHEDULE_WINDOW_MINUTES = 180;
// Tab orders (close this, open that) only make sense at their hour: cron-late by more than this, they are let go.
const TAB_WINDOW_MINUTES = 15;

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

function routinePush(routine, text) {
  const first = String(text || '').split('\n').find((l) => l.trim()) || routine.name;
  return { title: `Rutina: ${routine.name}`, body: first.slice(0, 120), url: '/', tag: `routine-${routine.id}` };
}

async function runSchedule(routine, now, helpers) {
  let local;
  try {
    local = localParts(now.toISOString(), routine.timezone);
  } catch {
    return false;
  }
  if (routine.lastRunOn === local.date) return false;
  // Only on its days («de lunes a viernes»): the rest of the week it simply waits, and nothing is claimed.
  if (!runsOn(routine.days, local.date)) return false;
  const late = toMinutes(local.time) - toMinutes(routine.time);
  if (late < 0 || late > SCHEDULE_WINDOW_MINUTES) return false;
  if (!(await claimRoutineDay(routine.id, local.date))) return false;
  try {
    // The browser extension keeps the tab orders on its own clock, to the minute (routines/plans.js); when it already did them
    // today, or this run is too late for them to still make sense, only the rest of the routine is done here.
    const skip = routine.state?.tabsDoneOn === local.date || late > TAB_WINDOW_MINUTES ? TAB_ACTION_TYPES : [];
    const body = await runRoutineActions(routine.actions, { user: routine.user, timezone: routine.timezone, skip, tabKey: `${routine.id}@${local.date}` });
    // A «once» routine is done after its first run, and a routine that only had tab orders the extension already did says nothing.
    if (routine.state?.once) await disableRoutine(routine.id);
    if (!body.trim()) return true;
    const text = `🔁 ${routine.name}\n\n${body}`;
    const delivered = await deliver(routine, text, routinePush(routine, text), helpers);
    if (!delivered) throw new Error('ni Telegram ni las notificaciones lo aceptaron');
    return true;
  } catch (err) {
    console.error('[routines] schedule failed:', err.message);
    await releaseRoutineDay(routine.id, local.date).catch(() => {});
    return false;
  }
}

// Whether a linked computer currently reports a download in progress, or
// null if it can't tell right now (offline, agent too old…) — a null never
// counts as a state change, so a flaky check can't fire the routine by accident.
async function isDownloading(userId, deviceId) {
  const devices = await devicesByUser(userId);
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return null;
  const tool = device.tools.find((t) => t.name === 'check_downloads' && t.risk === 'read');
  if (!tool) return null;
  const outcome = await runOnDevice(device, tool, {});
  return outcome.error ? null : Boolean(outcome.result?.descargando);
}

// The rest of a start-up routine (what the computer didn't do itself), once, after the agent flagged it (routines/boot.js).
async function runBoot(routine, helpers) {
  if (routine.state.pending !== true || !(await claimBootPending(routine.id))) return false;
  try {
    const text = `💻 ${routine.name}\n\n${await runRoutineActions(routine.actions, { user: routine.user, timezone: routine.timezone, skip: routine.state.written ? BOOT_ACTIONS.filter((a) => a !== 'morning') : BOOT_ACTIONS })}`;
    return await deliver(routine, text, routinePush(routine, text), helpers);
  } catch (err) {
    console.error('[routines] boot failed:', err.message);
    return false;
  }
}

// Today's date where the user is, or null when their time zone is not usable.
function localDate(routine, at) {
  try {
    return localParts(at.toISOString(), routine.timezone).date;
  } catch {
    return null;
  }
}

async function runEvent(routine, helpers, at = new Date()) {
  if (routine.eventType === 'device_boot') return runBoot(routine, helpers);
  if (routine.eventType !== 'download_complete') return false;
  const now = await isDownloading(routine.userId, routine.deviceId);
  const was = routine.state.downloading;
  // Only a true -> false transition we actually observed counts as "finished".
  const finished = was === true && now === false;
  if (now !== null && now !== was) await setRoutineState(routine.id, { downloading: now });
  if (!finished) return false;
  // A download that ends on a day the routine does not run on is seen and let go (the state above is already updated).
  const date = localDate(routine, at);
  if (date && !runsOn(routine.days, date)) return false;
  try {
    const text = `✅ ${routine.name}\n\n${await runRoutineActions(routine.actions, { user: routine.user, timezone: routine.timezone })}`;
    return await deliver(routine, text, routinePush(routine, text), helpers);
  } catch (err) {
    console.error('[routines] event failed:', err.message);
    return false;
  }
}

// Routines due at the same time (an AI task can take half a minute) run side by side, a few at a time.
const PARALLEL = 3;

export async function runRoutines({ now = new Date(), send = telegramSend, push = sendPush, deadline = Infinity } = {}) {
  const helpers = { send, push };
  const result = { scheduled: 0, events: 0, postponed: 0 };

  result.postponed += await mapLimit(
    await dueScheduleRoutines(),
    PARALLEL,
    async (routine) => {
      if (await runSchedule(routine, now, helpers)) result.scheduled += 1;
    },
    { deadline },
  );
  result.postponed += await mapLimit(
    await dueEventRoutines(),
    PARALLEL,
    async (routine) => {
      if (await runEvent(routine, helpers, now)) result.events += 1;
    },
    { deadline },
  );
  return result;
}
