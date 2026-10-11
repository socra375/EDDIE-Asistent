// /api/connectors/browser/*. Two audiences:
//   the app (signed-in user):    pair-code, unlink, prefs, test
//   the extension (bearer token): agent/pair (with the code), agent/hello,
//                                 agent/next, agent/agenda
// The extension's token is created at pairing, shown to it once and kept only
// as a hash; it can only fetch this user's pages and meetings.
import { requireUser } from '../session.js';
import { upcomingMeetings } from './meetings.js';
import { consumePairCode, createLink, createPairCode, deleteLink, enqueue, linkByToken, linkByUser, takeCommands, updateHello, updatePrefs, wasTaken } from './store.js';
import { isMessagingUrl, safeHttpsUrl } from './urls.js';
import { decideNextAction } from './agentStep.js';
import { getTask, pendingTaskFor, recordStep, TASK_MAX_MINUTES } from './tasks.js';
import { sanitizeImages } from '../images.js';
import { sendPush } from '../push/send.js';

const CODE_RE = /^[A-Z2-9]{8}$/;
const TEST_WAIT_MS = 45_000;
const TEST_STEP_MS = 1500;

const cleanText = (value, max, fallback) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
const cleanVersion = (value) => (typeof value === 'string' && /^[\w.+-]{1,20}$/.test(value) ? value : null);

function bearer(headers) {
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+([\w-]{20,100})$/.exec(String(raw).trim());
  return m ? m[1] : null;
}

const unauthorized = () => ({ status: 401, json: { error: 'El navegador ya no está vinculado. Vuelve a vincularlo desde Conectores.' } });

async function agentRoute(action, { method, headers, body }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (action === 'pair') {
    const code = String(body?.code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return { status: 400, json: { error: 'El código debe tener 8 letras o números (lo ves en Conectores).' } };
    const userId = await consumePairCode(code);
    if (!userId) return { status: 404, json: { error: 'Ese código no existe o ya caducó. Pide uno nuevo en Conectores.' } };
    const { token, link } = await createLink(userId, { name: cleanText(body?.name, 60, 'Mi navegador'), version: cleanVersion(body?.version) });
    return { status: 200, json: { token, name: link.name, prefs: link.prefs } };
  }
  const token = bearer(headers);
  const link = token ? await linkByToken(token) : null;
  if (!link) return unauthorized();
  if (action === 'hello') {
    await updateHello(link.userId, { name: body?.name ? cleanText(body.name, 60, null) : null, version: cleanVersion(body?.version) });
    return { status: 200, json: { ok: true, prefs: link.prefs } };
  }
  if (action === 'next') {
    return { status: 200, json: { commands: await takeCommands(link.userId), task: await pendingTaskFor(link.userId), prefs: link.prefs, now: new Date().toISOString() } };
  }
  if (action === 'task-step') return taskStepRoute(link.userId, body);
  if (action === 'agenda') {
    // Nothing to ask Google for when the user turned the meetings off.
    if (!link.prefs.autoMeetings) return { status: 200, json: { meetings: [], prefs: link.prefs, now: new Date().toISOString() } };
    const { meetings, reason } = await upcomingMeetings(link.userId);
    return { status: 200, json: { meetings, reason, prefs: link.prefs, now: new Date().toISOString() } };
  }
  return { status: 404, json: { error: 'Esa acción de la extensión no existe.' } };
}

const TASK_STATUS_WORD = { done: 'Tarea terminada', stopped: 'Eddie se detuvo', blocked: 'Eddie se detuvo por seguridad', error: 'Eddie tuvo un problema' };

async function notifyTaskFinished(userId, task, finalStatus, reason) {
  await sendPush(userId, { title: TASK_STATUS_WORD[finalStatus] || 'Eddie terminó', body: reason || task.goal, url: '/', tag: 'browser-task' }).catch(() => {});
}

// One screenshot from the extension → one decided action, or 'stop' once the
// task is over (done, blocked, the user asked to stop, or a safety limit —
// actions or time — was hit). The extension executes whatever this returns;
// nothing here ever touches the tab itself.
async function taskStepRoute(userId, body) {
  const task = await getTask(String(body?.taskId || ''));
  if (!task || task.userId !== userId) return { status: 404, json: { error: 'Esa tarea no existe.' } };
  if (task.status !== 'running') return { status: 200, json: { action: 'stop' } };

  const minutesUp = (Date.now() - new Date(task.startedAt).getTime()) / 60000;
  if (task.stopRequested) {
    await recordStep(task.id, { finish: 'stopped', result: 'El usuario la detuvo.' });
    await notifyTaskFinished(userId, task, 'stopped', 'El usuario la detuvo.');
    return { status: 200, json: { action: 'stop' } };
  }
  if (task.actionCount >= task.maxActions) {
    await recordStep(task.id, { finish: 'stopped', result: 'Se alcanzó el límite de acciones.' });
    await notifyTaskFinished(userId, task, 'stopped', 'Se alcanzó el límite de acciones.');
    return { status: 200, json: { action: 'stop' } };
  }
  if (minutesUp > TASK_MAX_MINUTES) {
    await recordStep(task.id, { finish: 'stopped', result: 'Se acabó el tiempo permitido.' });
    await notifyTaskFinished(userId, task, 'stopped', 'Se acabó el tiempo permitido.');
    return { status: 200, json: { action: 'stop' } };
  }

  let image;
  try {
    image = sanitizeImages([{ mimeType: 'image/png', data: String(body?.image || '') }])[0];
  } catch (err) {
    return { status: 400, json: { error: err.message } };
  }
  const width = Number.isFinite(Number(body?.width)) ? Math.round(Number(body.width)) : 0;
  const height = Number.isFinite(Number(body?.height)) ? Math.round(Number(body.height)) : 0;
  const history = Array.isArray(body?.history) ? body.history.map((h) => String(h).slice(0, 120)).slice(-6) : [];

  let decision;
  try {
    decision = await decideNextAction(image, { goal: task.goal, history, width, height, messagingSafe: isMessagingUrl(task.startUrl) });
  } catch (err) {
    await recordStep(task.id, { finish: 'error', result: err.message });
    await notifyTaskFinished(userId, task, 'error', err.message);
    return { status: err.status || 502, json: { error: err.message } };
  }

  if (decision.action === 'done' || decision.action === 'blocked') {
    const finalStatus = decision.action === 'done' ? 'done' : 'blocked';
    await recordStep(task.id, { finish: finalStatus, result: decision.reason });
    await notifyTaskFinished(userId, task, finalStatus, decision.reason);
  } else {
    await recordStep(task.id, {});
  }
  return { status: 200, json: decision };
}

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validPrefs(body) {
  const prefs = {};
  if (body?.autoMeetings !== undefined) {
    if (typeof body.autoMeetings !== 'boolean') return { error: 'autoMeetings debe ser verdadero o falso.' };
    prefs.autoMeetings = body.autoMeetings;
  }
  if (body?.openCreated !== undefined) {
    if (typeof body.openCreated !== 'boolean') return { error: 'openCreated debe ser verdadero o falso.' };
    prefs.openCreated = body.openCreated;
  }
  if (body?.leadMinutes !== undefined) {
    if (!Number.isInteger(body.leadMinutes) || body.leadMinutes < 0 || body.leadMinutes > 10) return { error: 'Los minutos de antelación van de 0 a 10.' };
    prefs.leadMinutes = body.leadMinutes;
  }
  return { prefs };
}

export async function handleBrowserRoute({ method, path = [], cookies = {}, headers = {}, body }, { sleep = sleepMs, waitMs = TEST_WAIT_MS } = {}) {
  const action = path[1];
  if (action === 'agent') return agentRoute(path[2], { method, headers, body });
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  const user = await requireUser(cookies);
  if (action === 'pair-code') return { status: 200, json: await createPairCode(user.id) };
  if (action === 'unlink') {
    await deleteLink(user.id);
    return { status: 200, json: { ok: true } };
  }
  if (action === 'prefs') {
    const { prefs, error } = validPrefs(body);
    if (error) return { status: 400, json: { error } };
    const link = await updatePrefs(user.id, prefs);
    return link ? { status: 200, json: { ok: true, prefs: link.prefs } } : { status: 409, json: { error: 'No hay ningún navegador vinculado.' } };
  }
  if (action === 'test') {
    if (!(await linkByUser(user.id))) return { status: 409, json: { error: 'No hay ningún navegador vinculado.' } };
    // Opens Eddie itself (or a neutral page when running locally over http).
    const url = safeHttpsUrl(process.env.APP_URL || '') || 'https://www.google.com/';
    const id = await enqueue(user.id, { url, label: 'Prueba de Eddie' });
    const started = Date.now();
    while (Date.now() - started < waitMs) {
      if (await wasTaken(id)) return { status: 200, json: { ok: true, seconds: Math.round((Date.now() - started) / 1000) } };
      await sleep(TEST_STEP_MS);
    }
    return { status: 200, json: { ok: false, error: 'La extensión no vino a buscar la página. ¿Está abierto el navegador y activa la extensión?' } };
  }
  return { status: 404, json: { error: 'Esa acción del navegador no existe.' } };
}
