// Runs one tool on the user's computer from the cloud: queue the job, ring
// the agent's doorbell (ntfy), then wait for the result. The agent never
// listens on a port and the database is only touched while there is real
// work, so an idle computer costs nothing (Neon's free plan sleeps when idle;
// an agent asking "anything for me?" every few seconds would keep it awake).
import { abandonJob, createJob, devicesByUser, expireJob, jobState } from './store.js';
import { argsFor, listForModel } from './catalog.js';

const DEFAULT_NTFY = 'https://ntfy.sh';
export const PICKUP_MS = 15_000; // the agent should take the job within this (its open connection is instant, its fallback look every 10 s)
export const RESULT_MS = 15_000; // and answer within this (the chat stops waiting at ~30 s)
const POLL_MS = 600;

export function ntfyBase(env = process.env) {
  const raw = String(env.EDDIE_NTFY_URL || DEFAULT_NTFY).trim().replace(/\/+$/, '');
  try {
    const u = new URL(raw);
    const local = ['localhost', '127.0.0.1'].includes(u.hostname);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    // fall through
  }
  return DEFAULT_NTFY;
}

// The doorbell carries no data: just "there is work". The agent then fetches
// the job from Eddie with its own token. Never forwarded to phones. `cache`: ntfy keeps the
// (empty) "job" message for a few hours so the agent can also pick it up by asking for the
// recent ones, which still works when its open connection died quietly (EDDIE Prime does).
export async function ringDoorbell(topic, { fetchImpl = globalThis.fetch, env = process.env, cache = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetchImpl(`${ntfyBase(env)}/${topic}`, {
      method: 'POST',
      body: 'job',
      headers: { ...(cache ? {} : { Cache: 'no' }), Firebase: 'no' },
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const PLATFORM_LABELS = { windows: 'Windows', mac: 'Mac', linux: 'Linux', chromebook: 'Chromebook' };

const plain = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// "PC-MARCOS (Windows)": how the computers are named to the model and in errors.
export const describeDevice = (d) => `«${d.name}»${d.platform ? ` (${PLATFORM_LABELS[d.platform] || d.platform})` : ''}`;

// Which of the user's computers a request means. `wanted` is what the model passed as `device`:
// a name ("PC-MARCOS"), part of it, or the kind of system ("windows", "chromebook"). With a single
// computer no name is needed; with several, never a guess — an action on the wrong machine is worse
// than one more question. → { device } or { error } (written for the model, with the real list).
export function pickDevice(devices, wanted) {
  if (!devices.length) return { error: 'No hay ningún equipo vinculado. En Conectores → «Tu equipo (EDDIE Prime)» se vincula con el agente eddie_agent.py (en Windows, con el instalador).' };
  const list = devices.map(describeDevice).join(', ');
  const query = plain(wanted);
  if (!query) {
    if (devices.length === 1) return { device: devices[0] };
    return { error: `Tienes varios equipos vinculados: ${list}. Dime en cuál (argumento device) o pregúntale al usuario.` };
  }
  const byName = devices.filter((d) => plain(d.name) === query);
  const found = byName.length ? byName : devices.filter((d) => plain(d.name).includes(query) || query.includes(plain(d.name)) || plain(d.platform) === query || plain(PLATFORM_LABELS[d.platform]) === query);
  if (found.length === 1) return { device: found[0] };
  if (found.length > 1) return { error: `«${String(wanted).slice(0, 40)}» puede ser más de un equipo: ${found.map(describeDevice).join(', ')}. Usa el nombre completo.` };
  return { error: `No encuentro un equipo llamado «${String(wanted).slice(0, 40)}». Los vinculados son: ${list}.` };
}

// The user's computer and the catalog entry for `toolName`, or an { error }
// written for the model (with the list of real tools, so it can retry).
export async function resolveTool(user, toolName, given, { risk } = {}) {
  if (!user) return { error: 'Para usar tu equipo a distancia, inicia sesión con tu cuenta de Google.' };
  const picked = pickDevice(await devicesByUser(user.id), given?.device);
  if (picked.error) return picked;
  const { device } = picked;
  const tool = device.tools.find((t) => t.name === toolName);
  const fitting = device.tools.filter((t) => t.risk === risk);
  if (!tool || tool.risk !== risk) {
    const where = risk === 'confirm' ? 'computer_action' : 'computer_check';
    const other = tool ? ` («${toolName}» existe, pero se usa con ${tool.risk === 'confirm' ? 'computer_action' : 'computer_check'}).` : '';
    return { error: `«${toolName}» no es una herramienta de ${where} en «${device.name}».${other} Disponibles: ${listForModel(fitting).join('; ') || 'ninguna'}.` };
  }
  const prepared = argsFor(tool, given);
  if (prepared.error) return { error: prepared.error };
  return { device, tool, args: prepared.args };
}

// Queue → doorbell → wait. Returns { result } or { error } (never throws for
// the expected cases: computer off, agent stopped, too slow).
export async function runOnDevice(device, tool, args, { fetchImpl, env, pickupMs = PICKUP_MS, resultMs = RESULT_MS, pollMs = POLL_MS, sleep = wait } = {}) {
  const jobId = await createJob(device.id, tool.name, args);
  const rang = await ringDoorbell(device.topic, { fetchImpl, env, cache: true });
  if (!rang) {
    await abandonJob(jobId);
    return { error: 'No pude avisarle a tu equipo (el servicio de aviso ntfy no respondió). Inténtalo de nuevo en un momento.' };
  }
  const started = Date.now();
  for (;;) {
    await sleep(pollMs);
    const state = await jobState(jobId);
    const elapsed = Date.now() - started;
    if (!state) return { error: 'El trabajo para tu equipo desapareció.' };
    if (state.status === 'done') return { result: state.result };
    if (state.status === 'error') return { error: `Tu equipo no pudo hacerlo: ${String(state.error || 'error desconocido').slice(0, 300)}` };
    if (state.status === 'queued' && elapsed >= pickupMs) {
      if (await expireJob(jobId)) {
        return { error: `«${device.name}» no responde: puede estar apagado, dormido o sin el agente de Eddie en marcha (en Windows arranca solo al iniciar sesión; en Linux, python3 eddie_agent.py run; en un Chromebook, Linux se apaga al cerrar la terminal).`, offline: true };
      }
      continue;
    }
    if (elapsed >= pickupMs + resultMs) {
      await abandonJob(jobId);
      return { error: `«${device.name}» tardó demasiado en responder.` };
    }
  }
}

export async function runOnComputer(user, toolName, given, options = {}) {
  const resolved = await resolveTool(user, toolName, given, { risk: options.risk || 'read' });
  if (resolved.error) return resolved;
  const outcome = await runOnDevice(resolved.device, resolved.tool, resolved.args, options);
  return { ...outcome, device: resolved.device.name, tool: resolved.tool };
}
