// What the agent asks for after «good morning» was queued as a job at start-up (routines/boot.js): the words to say, the
// pages to show while saying them, and whether to check the equipment afterwards. The data is read from the user's own
// services only now, when the computer is really there to say it, not while the agent waits for its hello to be answered.
import { claimBriefJob } from '../computer/store.js';
import { collectToday } from '../todayHandlers.js';
import { sanitizeConnectorIds } from '../handler.js';
import { loadUserContext } from '../telegram/serverActions.js';
import { listPendingReminders } from '../reminders/store.js';
import { enqueue, hasLink } from '../browser/store.js';
import { safeHttpsUrl } from '../browser/urls.js';
import { bootRoutines } from './store.js';
import { CALENDAR_URL, GMAIL_URL, spokenBrief } from './spoken.js';

// The pages stay a little after the last word, so the last sentence is said with the page still there.
const CLOSE_MARGIN_SECONDS = 12;

const gone = (status, error) => ({ status, json: { error } });

// What it reads and writes; tests give their own.
const real = { claimBriefJob, bootRoutines, loadUserContext, collectToday, listPendingReminders, hasLink, enqueue };

// → { status, json }. `device` is the agent's own computer (it came with its token); `jobId` the job that is its pass.
export async function serveBrief(device, jobId, now = new Date(), deps = {}) {
  const d = { ...real, ...deps };
  const pass = await d.claimBriefJob(device.id, String(jobId || ''));
  if (!pass) return gone(403, 'No hay un saludo esperando en este equipo.');
  const routine = (await d.bootRoutines(device.id)).find((r) => r.id === String(pass.routine) && r.actions.some((a) => a.type === 'morning'));
  if (!routine) return gone(404, 'Esa rutina ya no existe.');

  const context = await d.loadUserContext(routine.userId);
  const off = sanitizeConnectorIds(context.settings.disabledConnectors);
  const [data, reminders] = await Promise.all([
    d.collectToday({ timezone: routine.timezone, disabled: off, getUser: async () => routine.user }),
    off.includes('reminders') ? [] : d.listPendingReminders(routine.userId).catch(() => []),
  ]);
  const brief = spokenBrief({ name: routine.user?.name, timezone: routine.timezone, now, calendar: data.calendar, mail: data.mail, tasks: context.tasks, reminders });

  // The pages that go with what is said, only if the browser extension is there to close them again: Eddie never opens
  // what he cannot put away.
  let pages = [];
  let pagesNote = '';
  if (pass.pages !== false) {
    const wanted = [brief.wantsMail && ['Tu correo', GMAIL_URL], brief.wantsCalendar && ['Tu agenda', CALENDAR_URL]].filter(Boolean);
    if (wanted.length) {
      if (await d.hasLink(routine.userId)) {
        const closeAfter = brief.seconds + CLOSE_MARGIN_SECONDS;
        for (const [label, raw] of wanted) {
          const url = safeHttpsUrl(raw);
          if (!url) continue;
          try {
            await d.enqueue(routine.userId, { url, label, closeAfter });
            pages.push(label);
          } catch {
            // no page this time: the words are what matters
          }
        }
      } else {
        pagesNote = 'No abrí tu correo ni tu agenda: sin la extensión de Eddie en el navegador no podría cerrarlos después.';
      }
    }
  }

  // What to do about the equipment's performance: the routine's own setting, never more than the user allowed.
  const tune = routine.actions.find((a) => a.type === 'morning')?.tune;
  return {
    status: 200,
    json: {
      tune: tune === 'ensayo' || tune === 'activo' ? tune : 'off',
      pieces: brief.pieces,
      seconds: brief.seconds,
      pages,
      // The browser may be closed at start-up; the extension takes the pages when it starts, so the agent starts it.
      launch_browser: pages.length > 0,
      checkup: pass.checkup !== false,
      ...(pagesNote ? { note: pagesNote } : {}),
    },
  };
}
