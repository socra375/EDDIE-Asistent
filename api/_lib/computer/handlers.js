// /api/connectors/computer/*. Two audiences:
//   the app (signed-in user):   pair-code, installer (the one-click Windows installer, with a code inside), unlink, test
//   the agent (bearer token):   agent/pair (with the code), agent/hello,
//                               agent/next, agent/result
// The agent's token is created at pairing, shown to it once and kept only as
// a hash; it can only fetch and answer this user's computer jobs.
import { requireUser } from '../session.js';
import { isOwner, ownerEmails } from '../connectors/github/index.js';
import { plainText, sanitizeCatalog } from './catalog.js';
import { consumePairCode, createDevice, createPairCode, deleteDevice, deviceByToken, devicesByUser, finishJob, takeJob, updateCatalog } from './store.js';
import { ntfyBase, runOnComputer } from './run.js';
import { INSTALLER_CODE_MINUTES, INSTALLER_FILENAME, installerOrigin, windowsInstaller } from './installer.js';

const MAX_RESULT_CHARS = 16_000;
const CODE_RE = /^[A-Z2-9]{8}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

const mayPair = (user) => ownerEmails().length === 0 || isOwner(user);
const cleanName = (value) => plainText(value, 60) || 'Mi equipo';
const PLATFORMS = ['windows', 'mac', 'linux', 'chromebook'];
const cleanPlatform = (value) => (PLATFORMS.includes(value) ? value : null);
const cleanVersion = (value) => (typeof value === 'string' && /^[\w.+-]{1,20}$/.test(value) ? value : null);

function bearer(headers) {
  const raw = headers.authorization || headers.Authorization || '';
  const m = /^Bearer\s+([\w-]{20,100})$/.exec(String(raw).trim());
  return m ? m[1] : null;
}

async function agentDevice(headers) {
  const token = bearer(headers);
  return token ? deviceByToken(token) : null;
}

const unauthorized = () => ({ status: 401, json: { error: 'Token del agente no válido. Vuelve a vincular el equipo desde Conectores.' } });

// The result travels back to the model: a JSON value of bounded size.
function cleanResult(value) {
  const json = JSON.stringify(value ?? null);
  if (json.length <= MAX_RESULT_CHARS) return value ?? null;
  return { truncated: true, text: json.slice(0, MAX_RESULT_CHARS) };
}

async function agentRoute(action, { method, headers, body }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (action === 'pair') {
    const code = String(body?.code || '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return { status: 400, json: { error: 'El código debe tener 8 letras o números (lo ves en Conectores).' } };
    const userId = await consumePairCode(code);
    if (!userId) return { status: 404, json: { error: 'Ese código no existe o ya caducó. Pide uno nuevo en Conectores.' } };
    const name = cleanName(body?.name);
    const tools = sanitizeCatalog(body?.tools);
    const { token, topic } = await createDevice(userId, { name, version: cleanVersion(body?.version), tools, platform: cleanPlatform(body?.platform) });
    return { status: 200, json: { token, topic, ntfy: ntfyBase(), name, tools: tools.length } };
  }
  const device = await agentDevice(headers);
  if (!device) return unauthorized();
  if (action === 'hello') {
    const tools = sanitizeCatalog(body?.tools);
    await updateCatalog(device.id, { version: cleanVersion(body?.version), tools, platform: cleanPlatform(body?.platform) });
    return { status: 200, json: { ok: true, name: device.name, topic: device.topic, ntfy: ntfyBase(), tools: tools.length } };
  }
  if (action === 'next') return { status: 200, json: { job: await takeJob(device.id) } };
  if (action === 'result') {
    const id = String(body?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, json: { error: 'Falta el id del trabajo.' } };
    const ok = body?.ok === true;
    const error = ok ? null : String(body?.error || 'Error desconocido en el equipo.').slice(0, 500);
    const saved = await finishJob(device.id, id, { ok, result: ok ? cleanResult(body?.result) : null, error });
    return saved ? { status: 200, json: { ok: true } } : { status: 409, json: { error: 'Ese trabajo ya no está esperando (caducó o ya se respondió).' } };
  }
  return { status: 404, json: { error: 'Esa acción del agente no existe.' } };
}

export async function handleComputerRoute({ method, path = [], cookies = {}, headers = {}, body }) {
  const action = path[1];
  if (action === 'agent') return agentRoute(path[2], { method, headers, body });
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  const user = await requireUser(cookies);
  if (action === 'pair-code') {
    if (!mayPair(user)) return { status: 403, json: { error: 'Solo el dueño de Eddie puede vincular un equipo.' } };
    return { status: 200, json: await createPairCode(user.id) };
  }
  if (action === 'installer') {
    if (!mayPair(user)) return { status: 403, json: { error: 'Solo el dueño de Eddie puede vincular un equipo.' } };
    const { code, minutes } = await createPairCode(user.id, INSTALLER_CODE_MINUTES);
    return { status: 200, json: { filename: INSTALLER_FILENAME, content: windowsInstaller({ code, origin: installerOrigin(headers) }), minutes } };
  }
  if (action === 'unlink') {
    // One computer (by id), or all of them when none is named.
    const id = body?.id ? String(body.id) : null;
    if (id && !UUID_RE.test(id)) return { status: 400, json: { error: 'Indica qué equipo desvincular.' } };
    await deleteDevice(user.id, id);
    return { status: 200, json: { ok: true } };
  }
  if (action === 'test') {
    const devices = await devicesByUser(user.id);
    if (!devices.length) return { status: 409, json: { error: 'No hay ningún equipo vinculado.' } };
    const id = body?.id ? String(body.id) : null;
    const device = id ? devices.find((d) => d.id === id) : devices.length === 1 ? devices[0] : null;
    if (!device) return { status: 409, json: { error: id ? 'Ese equipo ya no está vinculado.' : 'Hay varios equipos: elige cuál probar.' } };
    const started = Date.now();
    const outcome = await runOnComputer(user, 'system_summary', { device: device.name });
    if (outcome.error) return { status: 200, json: { ok: false, error: outcome.error } };
    return { status: 200, json: { ok: true, ms: Date.now() - started, result: outcome.result } };
  }
  return { status: 404, json: { error: 'Esa acción del equipo no existe.' } };
}
