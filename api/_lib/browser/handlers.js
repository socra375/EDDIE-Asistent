// /api/connectors/browser/*. Two audiences:
//   the app (signed-in user):    pair-code, unlink, prefs, test
//   the extension (bearer token): agent/pair (with the code), agent/hello,
//                                 agent/next, agent/agenda
// The extension's token is created at pairing, shown to it once and kept only
// as a hash; it can only fetch this user's pages and meetings.
import { requireUser } from '../session.js';
import { upcomingMeetings } from './meetings.js';
import { consumePairCode, createLink, createPairCode, deleteLink, enqueue, linkByToken, linkByUser, takeCommands, updateHello, updatePrefs, wasTaken } from './store.js';
import { safeHttpsUrl } from './urls.js';

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
  if (action === 'next') return { status: 200, json: { commands: await takeCommands(link.userId), prefs: link.prefs, now: new Date().toISOString() } };
  if (action === 'agenda') {
    // Nothing to ask Google for when the user turned the meetings off.
    if (!link.prefs.autoMeetings) return { status: 200, json: { meetings: [], prefs: link.prefs, now: new Date().toISOString() } };
    const { meetings, reason } = await upcomingMeetings(link.userId);
    return { status: 200, json: { meetings, reason, prefs: link.prefs, now: new Date().toISOString() } };
  }
  return { status: 404, json: { error: 'Esa acción de la extensión no existe.' } };
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
