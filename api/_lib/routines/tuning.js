// Optimizing the computer, with training first. The agent (public/eddie_agent.py) only ever does two safe, reversible things —
// lower the priority of an app eating the processor in the background, release the memory of a stopped one — never closes or
// deletes anything, never touches the system, the antivirus, browsers or the app in use. On top of that, here:
//   · it starts in «ensayo»: it says what it WOULD do and does nothing, and each rehearsal is counted;
//   · «activo» needs the user's explicit request (a confirmation card) AND at least REHEARSALS_REQUIRED rehearsals;
//   · whatever it does (or would do) is written to the user afterwards, with how to undo it.
import { sendPush } from '../push/send.js';
import { claimTuneReport } from '../computer/store.js';
import { bootRoutines, bumpRehearsals, morningRoutines, setRoutineActions } from './store.js';

export const REHEARSALS_REQUIRED = 3;
const KINDS = { lower_priority: 'Bajar la prioridad de', trim_memory: 'Soltar la memoria de' };
const KINDS_DONE = { lower_priority: 'Bajé la prioridad de', trim_memory: 'Solté la memoria de' };
const MAX_ITEMS = 8;

const clip = (value, max) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// → { ok, summary } | { error }
export async function setTuningMode(userId, mode) {
  if (!['off', 'ensayo', 'activo'].includes(mode)) return { error: 'El modo debe ser off (apagado), ensayo (dice qué haría, sin tocar nada) o activo.' };
  const routines = await morningRoutines(userId);
  if (!routines.length) return { error: 'No tienes una rutina de «al encender el PC» con el saludo. Créala primero (acción morning): la optimización va dentro de ella.' };
  if (mode === 'activo') {
    const least = Math.min(...routines.map((r) => Number(r.state?.rehearsals || 0)));
    if (least < REHEARSALS_REQUIRED) {
      return { error: `Todavía no: antes de optimizar de verdad hace falta ensayar ${REHEARSALS_REQUIRED} veces y lleva ${least}. Cada ensayo es un encendido del PC con la optimización en modo ensayo; te mando lo que habría hecho para que lo revises.` };
    }
  }
  for (const routine of routines) {
    const actions = routine.actions.map((a) => (a.type === 'morning' ? { ...a, tune: mode } : a));
    await setRoutineActions(userId, routine.id, actions);
  }
  const summary = {
    off: 'Apagué la optimización del equipo. El saludo sigue igual.',
    ensayo: `Optimización en ensayo: en cada encendido te digo qué habría hecho y no toco nada (${REHEARSALS_REQUIRED} ensayos antes de poder activarla).`,
    activo: 'Optimización activa: en cada encendido bajo la prioridad de lo que se come el procesador en segundo plano y suelto la memoria de lo que está parado. Nunca cierro apps ni borro archivos. Si algo no te gusta, dime «deshaz la optimización».',
  }[mode];
  return { ok: true, mode, summary };
}

const line = (item, done) => `• ${(done ? KINDS_DONE : KINDS)[item.kind]} ${item.name} (${item.detail})`;

// The text the user gets after a start-up. Pure.
export function tuningReport({ mode, plan, applied, skipped, rehearsals }) {
  if (mode === 'activo') {
    if (!applied.length) return `🛠 Optimización del equipo\nNo hizo falta ajustar nada hoy.`;
    return [`🛠 Optimicé el equipo en segundo plano`, ...applied.map((i) => line(i, true)), '', `No cerré ninguna app ni borré nada.${skipped ? ` Dejé ${skipped} sin tocar porque ya habían cambiado.` : ''} Si algo no te gusta, dime «deshaz la optimización».`].join('\n');
  }
  const header = `🛠 Ensayo de optimización ${Math.min(rehearsals, REHEARSALS_REQUIRED)} de ${REHEARSALS_REQUIRED}`;
  const body = plan.length ? ['Habría hecho:', ...plan.map((i) => line(i, false))] : ['No encontré nada que valiera la pena ajustar.'];
  const next = rehearsals >= REHEARSALS_REQUIRED
    ? 'Ya hice los ensayos. Si lo que viste te parece bien, dime «activa la optimización»; si no, déjala así o apágala.'
    : `No toqué nada. Faltan ${REHEARSALS_REQUIRED - rehearsals} ensayo${REHEARSALS_REQUIRED - rehearsals === 1 ? '' : 's'} (un encendido más cada uno) antes de poder activarla.`;
  return [header, ...body, '', next].join('\n');
}

const cleanItems = (value) =>
  (Array.isArray(value) ? value : [])
    .slice(0, MAX_ITEMS)
    .filter((i) => i && KINDS[i.kind])
    .map((i) => ({ kind: i.kind, name: clip(i.name, 60), detail: clip(i.detail, 120) }))
    .filter((i) => i.name);

// The agent's report (agent/tune-report). The mode that counts is the routine's, not what the agent claims.
// → { status, json }
export async function reportTuning(device, body, deps = {}) {
  // reminders/run.js pulls in every connector (this file is imported by one of them): loaded when needed, not at start.
  const { deliver, telegramSend } = deps.deliver ? {} : await import('../reminders/run.js');
  const d = { claimTuneReport, bootRoutines, bumpRehearsals, deliver, send: telegramSend, push: sendPush, ...deps };
  const pass = await d.claimTuneReport(device.id, String(body?.job || ''));
  if (!pass) return { status: 403, json: { error: 'No hay un saludo de este equipo esperando ese informe.' } };
  const routine = (await d.bootRoutines(device.id)).find((r) => r.id === String(pass.routine));
  const action = routine?.actions.find((a) => a.type === 'morning');
  if (!routine || !action) return { status: 404, json: { error: 'Esa rutina ya no existe.' } };
  const mode = action.tune === 'activo' ? 'activo' : action.tune === 'ensayo' ? 'ensayo' : 'off';
  if (mode === 'off') return { status: 200, json: { ok: true, ignored: true } };
  const plan = cleanItems(body?.plan);
  // What counts is what the agent says it did only when the user allowed it to do anything.
  const applied = mode === 'activo' ? cleanItems(body?.applied) : [];
  const skipped = Math.max(0, Math.min(99, Number(body?.skipped) || 0));
  const rehearsals = mode === 'ensayo' ? await d.bumpRehearsals(routine.id) : Number(routine.state?.rehearsals || 0);
  const text = tuningReport({ mode, plan, applied, skipped, rehearsals });
  const delivered = await d.deliver(routine, text, { title: 'Optimización del equipo', body: text.split('\n')[0].slice(0, 120), url: '/', tag: `tune-${routine.id}` }, { send: d.send, push: d.push }).catch(() => false);
  return { status: 200, json: { ok: true, mode, rehearsals, delivered: Boolean(delivered) } };
}
