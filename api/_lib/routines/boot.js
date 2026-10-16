// "Cuando encienda la PC": what happens the moment the agent of a linked computer says it
// has just started up (api/_lib/computer/handlers.js → agent/hello, only for a new boot).
//
// Opening pages and speaking are done by the computer itself, so they are queued as jobs
// right here: the agent asks for its jobs as soon as its hello is answered, and the pages
// open within seconds of the PC starting — even though no browser was open (the browser
// extension can't help there, it needs the browser running). A routine's other actions
// (summary, notice, music, an agent task) can take a while and the agent is waiting for this
// very answer, so they are left pending for the next cron tick (api/_lib/routines/run.js).
import { createJob } from '../computer/store.js';
import { enqueue } from '../browser/store.js';
import { safeHttpsUrl } from '../browser/urls.js';
import { localParts } from '../connectors/dates.js';
import { runsOn } from '../../../src/services/weekdays.js';
import { bootRoutines, markBootPending } from './store.js';

// `morning` is only done by the computer when its agent can (1.11+); an older one leaves it to the written summary.
export const BOOT_ACTIONS = ['open_sites', 'say', 'morning'];

const hasTool = (device, name) => device.tools.some((t) => t.name === name);

async function openSites(device, userId, urls) {
  const safe = [...new Set(urls.map((u) => safeHttpsUrl(u)).filter(Boolean))].slice(0, 8);
  if (!safe.length) return 0;
  if (hasTool(device, 'open_urls')) {
    await createJob(device.id, 'open_urls', { urls: safe.join('\n') });
    return safe.length;
  }
  // An agent from before this existed: the browser extension takes them when the browser is running.
  let queued = 0;
  for (const url of safe) {
    try {
      await enqueue(userId, { url, label: '' });
      queued += 1;
    } catch {
      // no browser linked: nothing to do
    }
  }
  return queued;
}

// Never throws (the agent's hello must always be answered).
export async function handleDeviceBoot(device, at = new Date()) {
  try {
    for (const routine of await bootRoutines(device.id)) {
      // «Solo entre semana»: on the other days the PC starts up and nothing happens.
      let date = null;
      try {
        date = localParts(at.toISOString(), routine.timezone).date;
      } catch {
        // unusable time zone: the routine runs rather than staying silent
      }
      if (date && !runsOn(routine.days, date)) continue;
      let rest = false;
      let written = false;
      for (const action of routine.actions) {
        if (action.type === 'open_sites') await openSites(device, routine.userId, action.urls || []);
        else if (action.type === 'say' && hasTool(device, 'say_text')) await createJob(device.id, 'say_text', { text: String(action.text || '').slice(0, 300) });
        else if (action.type === 'morning') {
          // The agent comes back for the words (agent/brief) with this job as its pass: the data is read from Google then, not here, so the hello is answered at once.
          if (hasTool(device, 'morning_brief')) await createJob(device.id, 'morning_brief', { routine: routine.id, pages: action.pages !== false, checkup: action.checkup !== false });
          else rest = written = true;
        } else if (!BOOT_ACTIONS.includes(action.type)) rest = true;
      }
      if (rest) await markBootPending(routine.id, { written });
    }
  } catch (err) {
    console.error('[boot] failed:', err?.message || err);
  }
}
