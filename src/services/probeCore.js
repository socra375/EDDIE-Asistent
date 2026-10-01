// The local probe (Sonda Local): a FastAPI server on the user's own computer
// (http://127.0.0.1:8000) that can look at the machine itself — disk, memory,
// CPU, battery — which Eddie's cloud server never can. Only the browser on
// that same computer can reach it, so the web app talks to it directly.
//
// Pure functions (no browser storage, fetch injectable) so they can be tested
// in Node. Contract: POST /chat { message } with header X-Eddie-Key →
// { response: "Markdown…", tools_used: ["check_disk_space"] }; GET /health → { ok: true }.

export const DEFAULT_PROBE_URL = 'http://127.0.0.1:8000';
export const PROBE_TIMEOUT_MS = 90_000; // the probe calls its own AI model and then its tools
// /health answers in milliseconds, but the first time Chrome may hold the
// request while it asks for permission to reach this device's local network.
export const PING_TIMEOUT_MS = 20_000;
const MAX_MESSAGE = 4000;
const MAX_TOOLS = 12;
const MAX_RESPONSE = 20_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export class ProbeError extends Error {
  constructor(message, kind = 'error') {
    super(message);
    this.kind = kind; // config | network | timeout | auth | http | format
  }
}

// The probe's base address, or null. Only this computer (loopback) is
// accepted, so a typo can never send the user's messages somewhere on the internet.
export function cleanProbeUrl(value) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!LOOPBACK.has(u.hostname.toLowerCase())) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return `${u.protocol}//${u.host}`;
}

// What may travel in the X-Eddie-Key header: printable ASCII, no spaces.
export function cleanKey(value) {
  const key = String(value || '').trim();
  return /^[\x21-\x7e]{0,200}$/.test(key) ? key : null;
}

const toolLabel = (name) => name.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// The probe's answer, checked: { response, tools }. Throws on anything else.
export function parseProbeReply(data) {
  if (!data || typeof data !== 'object' || typeof data.response !== 'string' || !data.response.trim()) {
    throw new ProbeError('La sonda respondió algo que no entiendo (faltaba "response").', 'format');
  }
  const tools = (Array.isArray(data.tools_used) ? data.tools_used : [])
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/[^\w.-]/g, '').slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_TOOLS);
  return { response: data.response.trim().slice(0, MAX_RESPONSE), tools };
}

// The receipt shown on the bubble: one step per local tool the probe used.
export function stepsFromTools(tools) {
  return tools.map((name, i) => ({ id: `p${i + 1}`, tool: name, label: toolLabel(name), status: 'done', summary: 'Herramienta de la sonda local' }));
}

function networkError(base) {
  return new ProbeError(
    `No pude conectar con la sonda en ${base}. Revisa que esté encendida (uvicorn), que permita este sitio en CORS y, si Chrome te preguntó, que diste permiso para acceder a apps de este dispositivo. Solo funciona desde el navegador del mismo equipo donde corre la sonda.`,
    'network',
  );
}

async function call(base, path, { fetchImpl, timeoutMs, ...init }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(`${base}${path}`, { ...init, mode: 'cors', credentials: 'omit', cache: 'no-store', signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new ProbeError(
        `La sonda tardó más de ${Math.round(timeoutMs / 1000)} s en responder, así que no hubo conexión. Si Chrome te mostró un aviso para permitir el acceso a dispositivos de tu red local, acepta y vuelve a probar; si no, revisa que la sonda esté encendida.`,
        'timeout',
      );
    }
    throw networkError(base, err);
  } finally {
    clearTimeout(timer);
  }
}

// Sends one message to the probe → { response, tools }. Throws ProbeError
// with a message meant for the user.
export async function askProbe({ url, key, message, fetchImpl = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS }) {
  const base = cleanProbeUrl(url);
  if (!base) throw new ProbeError('La dirección de la sonda debe ser de este equipo, por ejemplo http://127.0.0.1:8000.', 'config');
  const cleanedKey = cleanKey(key);
  if (cleanedKey === null) throw new ProbeError('La clave de la sonda tiene caracteres no válidos.', 'config');
  const text = String(message || '').trim().slice(0, MAX_MESSAGE);
  if (!text) throw new ProbeError('No hay nada que preguntarle a la sonda.', 'config');
  const res = await call(base, '/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cleanedKey ? { 'X-Eddie-Key': cleanedKey } : {}) },
    body: JSON.stringify({ message: text }),
    fetchImpl,
    timeoutMs,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.status === 401 || res.status === 403) throw new ProbeError('La sonda rechazó la clave (X-Eddie-Key). Revisa que sea la misma en Conectores → Sonda local y en la sonda.', 'auth');
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : typeof data?.error === 'string' ? data.error : '';
    throw new ProbeError(`La sonda respondió con un error (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}.`, 'http');
  }
  return parseProbeReply(data);
}

// Is the probe up? GET /health → { ok: true, ms } (no AI involved, so it's free).
export async function pingProbe({ url, fetchImpl = globalThis.fetch, timeoutMs = PING_TIMEOUT_MS, now = () => Date.now() }) {
  const base = cleanProbeUrl(url);
  if (!base) throw new ProbeError('La dirección de la sonda debe ser de este equipo, por ejemplo http://127.0.0.1:8000.', 'config');
  const started = now();
  const res = await call(base, '/health', { method: 'GET', fetchImpl, timeoutMs });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || data?.ok !== true) throw new ProbeError(`La sonda contestó, pero /health no dijo { "ok": true } (estado ${res.status}).`, 'http');
  return { ok: true, ms: Math.max(0, now() - started) };
}

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Questions about the computer itself, which only the probe can answer
// (used when "detect questions about the computer" is on).
const SYSTEM_RE = new RegExp(
  '\\b(' +
    [
      'disco( duro)?',
      'discos',
      'ssd',
      'hdd',
      'almacenamiento',
      'espacio (libre|en disco|disponible|usado|ocupado|me queda|queda|tengo)',
      'cuanto espacio',
      'gigas? (libres?|disponibles?)',
      'particion(es)?',
      'memoria (ram|libre|disponible|usada|del (equipo|sistema|computador|pc))',
      'cuanta memoria',
      'ram',
      'cpu',
      'procesador',
      'nucleos',
      'bateria',
      'cargador',
      'temperatura',
      'procesos?',
      'uptime',
      'tiempo encendid[oa]',
      'lleva encendid[oa]',
      '(uso|estado|rendimiento|salud) del (sistema|equipo|computador|pc|chromebook)',
      '(mi|el|este|tu) (computador|computadora|ordenador|pc|chromebook|equipo|laptop|portatil|sistema operativo)',
      'crostini',
      'linux',
      '(mi|la) (ip|direccion ip)',
    ].join('|') +
    ')\\b',
);

export function looksLikeSystemQuestion(text) {
  const t = plain(text);
  return t.length >= 6 && SYSTEM_RE.test(t);
}
