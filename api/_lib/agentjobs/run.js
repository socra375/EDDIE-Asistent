// Runs one background job: a second Eddie (same memory, tools and business context as the chat) works on the request
// while the conversation goes on. What it did waits in the job row — the app picks it up and tells the user. It
// cannot start more jobs, edit routines or drive the browser pilot's own loop beyond what its tools allow.
import { askEddie } from '../channels/brain.js';
import { claimJob, failJob, finishJob } from './store.js';

// Actions the app (not the database) carries out: opening pages, pictures, drafts… the app applies them when it
// shows the result. Tasks and memory were already written by askEddie.
const SERVER_APPLIED = /^(create_task|complete_task|delete_task|memory_)/;

export const JOB_NOTE = [
  'Estás trabajando EN SEGUNDO PLANO: el usuario no está mirando esta conversación, sigue hablando con otra instancia tuya.',
  'Haz el trabajo completo con tus herramientas, sin hacerle preguntas ahora. Si algo necesita su permiso (enviar, borrar, pagar, agendar) déjalo preparado: saldrá una tarjeta para que él decida.',
  'Cuando termines responde en 2 a 4 frases, en primera persona y en pasado («Revisé…, encontré…, dejé listo…»): qué hiciste, qué encontraste y qué le toca decidir a él. Sin saludos ni despedidas.',
  'No inventes: si no pudiste hacer algo, dilo.',
].join('\n');

export async function runJob(user, id, { timezone, ask = askEddie } = {}) {
  const job = await claimJob(user.id, id);
  if (!job) return { error: 'Esa tarea ya está en marcha o terminó.' };
  const tz = job.timezone || timezone || 'UTC';
  try {
    const link = { userId: user.id, timezone: tz, user, history: [] };
    const out = await ask({ link, text: job.task, note: JOB_NOTE, disable: ['routines'], channel: 'job' });
    const actions = (out.actions || []).filter((a) => !SERVER_APPLIED.test(String(a?.type || '')));
    const changes = out.changes || [];
    const result = [out.reply, changes.length ? changes.map((c) => `✓ ${c}`).join('\n') : ''].filter(Boolean).join('\n');
    await finishJob(user.id, id, { result: result.slice(0, 2000), steps: out.steps || [], confirmations: out.confirmations || [], actions });
    return { ok: true };
  } catch (err) {
    await failJob(user.id, id, err?.message || 'Falló la tarea.');
    return { error: err?.message || 'Falló la tarea.' };
  }
}

