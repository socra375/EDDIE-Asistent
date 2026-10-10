// Runs due routines: the schedule ones (once a day, like the morning
// briefing) and the event ones (checked every cron tick against a linked
// computer — see api/_lib/connectors/computer/). Called from the same cron
// as reminders and briefings (api/_lib/reminders/cron.js).
import { deliver, telegramSend } from '../reminders/run.js';
import { sendPush } from '../push/send.js';
import { localParts } from '../connectors/dates.js';
import { devicesByUser } from '../computer/store.js';
import { runOnDevice } from '../computer/run.js';
import { runRoutineActions } from './actions.js';
import { claimRoutineDay, dueEventRoutines, dueScheduleRoutines, releaseRoutineDay, setRoutineState } from './store.js';

// A routine this long after its hour isn't run (same reasoning as the
// morning briefing: nobody wants "a las 8" showing up at 3pm).
const SCHEDULE_WINDOW_MINUTES = 180;

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
  const late = toMinutes(local.time) - toMinutes(routine.time);
  if (late < 0 || late > SCHEDULE_WINDOW_MINUTES) return false;
  if (!(await claimRoutineDay(routine.id, local.date))) return false;
  try {
    const text = `🔁 ${routine.name}\n\n${await runRoutineActions(routine.actions, { user: routine.user, timezone: routine.timezone })}`;
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

async function runEvent(routine, helpers) {
  if (routine.eventType !== 'download_complete') return false;
  const now = await isDownloading(routine.userId, routine.deviceId);
  const was = routine.state.downloading;
  // Only a true -> false transition we actually observed counts as "finished".
  const finished = was === true && now === false;
  if (now !== null && now !== was) await setRoutineState(routine.id, { downloading: now });
  if (!finished) return false;
  try {
    const text = `✅ ${routine.name}\n\n${await runRoutineActions(routine.actions, { user: routine.user, timezone: routine.timezone })}`;
    return await deliver(routine, text, routinePush(routine, text), helpers);
  } catch (err) {
    console.error('[routines] event failed:', err.message);
    return false;
  }
}

export async function runRoutines({ now = new Date(), send = telegramSend, push = sendPush } = {}) {
  const helpers = { send, push };
  const result = { scheduled: 0, events: 0 };

  for (const routine of await dueScheduleRoutines()) {
    if (await runSchedule(routine, now, helpers)) result.scheduled += 1;
  }
  for (const routine of await dueEventRoutines()) {
    if (await runEvent(routine, helpers)) result.events += 1;
  }
  return result;
}
