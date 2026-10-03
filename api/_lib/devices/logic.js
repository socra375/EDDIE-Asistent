// The pure rules of "dispositivos": who counts as on, what a name may be, how
// a device is found by what the user said. No database in here (see store.js).

// A device that has not checked in for this long is off (it checks in every
// ~2 minutes while Eddie is open).
export const ONLINE_MS = 4 * 60 * 1000;
// A command nobody picked up for this long is dropped: the user has moved on.
export const COMMAND_TTL_MS = 2 * 60 * 1000;

export const ACTIONS = ['vigilance_on', 'vigilance_off', 'view_start', 'view_stop'];
export const VIGILANCE_ACTIONS = ['vigilance_on', 'vigilance_off'];
export const ACTION_LABEL = { vigilance_on: 'activar el Modo Vigilancia', vigilance_off: 'apagar el Modo Vigilancia', view_start: 'compartir su cámara contigo', view_stop: 'dejar de compartir su cámara' };

export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Plain text only, one line, bounded.
export const plain = (value, max) =>
  String(value ?? '')
    .replace(/[\p{Cc}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const cleanDeviceName = (value, fallback = 'Mi dispositivo') => plain(value, 40) || fallback;
export const cleanPlatform = (value) => plain(value, 60);

export function isOnline(lastSeen, now = Date.now()) {
  const t = lastSeen ? new Date(lastSeen).getTime() : NaN;
  return Number.isFinite(t) && now - t < ONLINE_MS;
}

const fold = (text) =>
  String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// The device the user meant by `query` ("el portátil", "chromebook"): an exact
// name first, then one that contains the words (or the other way round). With
// no query, a single device is the obvious one. → { device } | { error }.
export function findDevice(devices, query) {
  if (!devices.length) return { error: 'No hay ningún dispositivo conectado a tu cuenta todavía. Abre Eddie en el otro equipo con la misma cuenta de Google.' };
  const q = fold(query);
  if (!q) return devices.length === 1 ? { device: devices[0] } : { error: `¿En cuál dispositivo? Tienes: ${devices.map((d) => d.name).join(', ')}.` };
  const named = devices.map((device) => ({ device, name: fold(device.name) }));
  const exact = named.filter((n) => n.name === q);
  if (exact.length === 1) return { device: exact[0].device };
  const words = q.split(' ').filter((w) => w.length > 2 && !['del', 'los', 'las', 'mi', 'mis', 'el', 'la', 'en', 'de'].includes(w));
  const partial = named.filter((n) => n.name.includes(q) || q.includes(n.name) || (words.length > 0 && words.every((w) => n.name.includes(w))));
  if (partial.length === 1) return { device: partial[0].device };
  if (partial.length > 1) return { error: `Hay varios que encajan con «${query}»: ${partial.map((n) => n.device.name).join(', ')}. Dime cuál.` };
  return { error: `No encuentro «${query}». Tus dispositivos: ${devices.map((d) => d.name).join(', ')}.` };
}

// Why a command cannot go to this device right now, or null when it can.
export function whyNotReachable(device, now = Date.now()) {
  if (!device.remoteEnabled) return `«${device.name}» no permite el control desde otros dispositivos. Actívalo allí en Configuración → Dispositivos.`;
  if (!isOnline(device.lastSeen, now)) return `«${device.name}» está apagado o sin conexión (Eddie no está abierto allí).`;
  return null;
}

// What to tell the user when the device answered.
export function describeAck(device, action, status, message) {
  if (status === 'done') {
    const done = { vigilance_on: 'Modo Vigilancia activado', vigilance_off: 'Modo Vigilancia apagado', view_start: 'compartiendo su cámara', view_stop: 'dejó de compartir su cámara' };
    return `${device.name}: ${done[action] || 'listo'}.`;
  }
  if (status === 'consent') return `${device.name} todavía no tiene el permiso de la cámara: hay que darlo una sola vez, estando delante de ese equipo (Configuración → Dispositivos → «Dar permiso de cámara»). Después se activa desde cualquier lugar sin preguntar.`;
  if (status === 'error') return `${device.name}: ${message || 'no se pudo'}.`;
  return `${device.name} no respondió a tiempo. Puede que Eddie esté cerrado o en segundo plano allí.`;
}

// ---- Remote view: what a device may share ----------------------------------
export const FRAME_MAX_CHARS = 90_000; // base64 of a ~480 px JPEG is ~30 000; this is the ceiling
export const FRAME_FRESH_MS = 30_000; // an older picture is never shown
export const VIEWER_WINDOW_S = 20; // the device keeps sending this long after the viewer last asked
const CATEGORIES = ['persona', 'animal', 'objeto', 'material', 'vehículo', 'otro'];
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function validFrame(frame) {
  return typeof frame === 'string' && frame.length >= 200 && frame.length <= FRAME_MAX_CHARS && frame.length % 4 === 0 && BASE64_RE.test(frame) && frame.startsWith('/9j/'); // JPEG
}

const int = (n, min, max) => (Number.isFinite(Number(n)) ? Math.min(max, Math.max(min, Math.round(Number(n)))) : min);

// What the device says it sees: text only, bounded, nothing else gets through.
export function cleanMeta(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const objects = (Array.isArray(m.objects) ? m.objects : []).slice(0, 12).map((o) => {
    const out = { label: plain(o?.label, 40), category: CATEGORIES.includes(o?.category) ? o.category : 'objeto', count: int(o?.count ?? 1, 1, 99), confidence: Math.round(Math.min(1, Math.max(0, Number(o?.confidence) || 0)) * 100) / 100 };
    if (Array.isArray(o?.box) && o.box.length === 4 && o.box.every((v) => Number.isFinite(Number(v)))) out.box = o.box.map((v) => int(v, 0, 1000));
    return out;
  });
  return { summary: plain(m.summary, 300), objects: objects.filter((o) => o.label), width: int(m.width, 0, 4000), height: int(m.height, 0, 4000), seq: int(m.seq, 0, 1_000_000_000) };
}

// "Veo 2 personas y 1 laptop." for the model (and the viewer's caption) from what a device shared.
export function describeMeta(meta) {
  const m = cleanMeta(meta);
  if (m.summary) return m.summary;
  if (!m.objects.length) return 'No veo nada destacable.';
  const parts = m.objects.slice(0, 6).map((o) => (o.count > 1 ? `${o.count} ${o.label}` : `1 ${o.label}`));
  return `Veo ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0]}.`;
}

// ---- Live video (WebRTC): the messages the two browsers exchange ----
export const SIGNAL_ROLES = ['target', 'viewer'];
export const SIGNAL_KINDS = ['offer', 'answer', 'ice', 'bye'];
export const SIGNAL_MAX_CHARS = 12_000; // an SDP for one video track is about 1–3 KB
export const SIGNAL_TTL_S = 60;
export const SIGNAL_MAX_PENDING = 80;

// → { kind, payload } cleaned, or null when it is not an acceptable message.
export function cleanSignal(kind, payload) {
  if (!SIGNAL_KINDS.includes(kind)) return null;
  const text = typeof payload === 'string' ? payload : payload == null ? '' : JSON.stringify(payload);
  if (kind === 'bye') return { kind, payload: '' };
  if (!text || text.length > SIGNAL_MAX_CHARS) return null;
  // Offers and answers are JSON { type, sdp }; candidates are JSON { candidate, sdpMid, sdpMLineIndex }.
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if ((kind === 'offer' || kind === 'answer') && (parsed.type !== kind || typeof parsed.sdp !== 'string')) return null;
  if (kind === 'ice' && parsed.candidate !== undefined && parsed.candidate !== null && typeof parsed.candidate !== 'string') return null;
  return { kind, payload: text };
}

// The servers the two browsers use to find each other: public STUN, plus a TURN relay
// when one is configured (TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL in Vercel) for the
// networks where a direct path is impossible. Only sent to a signed-in user.
export function iceServers(env = process.env) {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  const urls = String(env.TURN_URLS || '')
    .split(/[,\s]+/)
    .filter((u) => /^turns?:[A-Za-z0-9._:\-?=&]+$/.test(u))
    .slice(0, 6);
  if (urls.length && env.TURN_USERNAME && env.TURN_CREDENTIAL) servers.push({ urls, username: String(env.TURN_USERNAME), credential: String(env.TURN_CREDENTIAL) });
  return servers;
}
