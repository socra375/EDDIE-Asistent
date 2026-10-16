// What the agent asks for after «good morning» was queued as a job at start-up (routines/boot.js): the words to say, the
// pages to show while saying them, and whether to check the equipment afterwards. The data is read from the user's own
// services only now, when the computer is really there to say it, not while the agent waits for its hello to be answered.
import { claimBriefJob, claimVoiceReport } from '../computer/store.js';
import { collectToday } from '../todayHandlers.js';
import { sanitizeConnectorIds } from '../handler.js';
import { loadUserContext } from '../telegram/serverActions.js';
import { listPendingReminders } from '../reminders/store.js';
import { enqueue, linkByUser } from '../browser/store.js';
import { EXTENSION_VERSION } from '../browser/open.js';
import { safeHttpsUrl } from '../browser/urls.js';
import { bootRoutines } from './store.js';
import { CALENDAR_URL, GMAIL_URL, spokenBrief } from './spoken.js';

// The pages stay a little after the last word, so the last sentence is said with the page still there.
const CLOSE_MARGIN_SECONDS = 12;

const gone = (status, error) => ({ status, json: { error } });

// The browser that has the extension, from the name it linked with («Chrome en Windows», «Edge en Windows»…): the agent
// starts THAT one, not the system's default (an extension only works in its own browser).
export function browserKind(name) {
  const n = String(name || '').toLowerCase();
  if (/edge/.test(n)) return 'edge';
  if (/brave/.test(n)) return 'brave';
  if (/opera/.test(n)) return 'opera';
  if (/vivaldi/.test(n)) return 'vivaldi';
  return 'chrome';
}

const older = (version, min) => {
  const a = String(version || '0').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const b = String(min).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  return false;
};

// What it reads and writes; tests give their own.
const real = { claimBriefJob, bootRoutines, loadUserContext, collectToday, listPendingReminders, linkByUser, enqueue };

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
  let note = '';
  let browser = null;
  if (pass.pages !== false) {
    const wanted = [brief.wantsMail && ['Tu correo', GMAIL_URL], brief.wantsCalendar && ['Tu agenda', CALENDAR_URL]].filter(Boolean);
    if (wanted.length) {
      const link = await d.linkByUser(routine.userId);
      if (link) {
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
        browser = browserKind(link.name);
        // An old extension still opens the pages but cannot close them; say so instead of leaving them open without a word.
        if (pages.length && older(link.version, EXTENSION_VERSION)) note = 'Ojo: la extensión de tu navegador es una versión vieja y no cerrará las páginas. Actualízala en Conectores, Tu navegador.';
      } else {
        note = 'No abrí tu correo ni tu agenda: sin la extensión de Eddie en el navegador no podría cerrarlos después.';
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
      ...(browser ? { browser } : {}),
      checkup: pass.checkup !== false,
      ...(note ? { note } : {}),
    },
  };
}

const clip = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The computer has no Spanish voice, so it did not speak the good-morning: the same words arrive in writing, once.
// → { status, json }
export async function reportVoice(device, body, deps = {}) {
  const { deliver, telegramSend } = deps.deliver ? {} : await import('../reminders/run.js');
  const { sendPush } = deps.push ? {} : await import('../push/send.js');
  const d = { claimVoiceReport, bootRoutines, deliver, send: telegramSend, push: sendPush, ...deps };
  const pass = await d.claimVoiceReport(device.id, String(body?.job || ''));
  if (!pass) return gone(403, 'No hay un saludo de este equipo esperando ese aviso.');
  const routine = (await d.bootRoutines(device.id)).find((r) => r.id === String(pass.routine));
  if (!routine) return gone(404, 'Esa rutina ya no existe.');
  const pieces = (Array.isArray(body?.pieces) ? body.pieces : []).slice(0, 8).map((p) => clip(p, 300)).filter(Boolean);
  const text = [
    '🔈 Tu PC no tiene una voz en español, así que no te saludé en voz alta (con una voz en inglés sonaría a otro idioma).',
    '',
    ...pieces,
    '',
    'Para oírme: Configuración de Windows → Hora e idioma → Voz → Agregar voces → Español. Después te saludo en voz alta.',
  ].join('\n');
  const delivered = await d.deliver(routine, text, { title: 'Tu saludo del día', body: pieces[0] || 'Buenos días', url: '/', tag: `voice-${routine.id}` }, { send: d.send, push: d.push }).catch(() => false);
  return { status: 200, json: { ok: true, delivered: Boolean(delivered) } };
}
