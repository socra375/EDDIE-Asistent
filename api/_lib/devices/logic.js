// The pure rules of "dispositivos": who counts as on, what a name may be, how
// a device is found by what the user said. No database in here (see store.js).

// A device that has not checked in for this long is off (it checks in every
// ~2 minutes while Eddie is open).
export const ONLINE_MS = 4 * 60 * 1000;
// A command nobody picked up for this long is dropped: the user has moved on.
export const COMMAND_TTL_MS = 2 * 60 * 1000;

export const ACTIONS = ['vigilance_on', 'vigilance_off'];
export const ACTION_LABEL = { vigilance_on: 'activar el Modo Vigilancia', vigilance_off: 'apagar el Modo Vigilancia' };

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
  if (status === 'done') return `${device.name}: ${action === 'vigilance_on' ? 'Modo Vigilancia activado' : 'Modo Vigilancia apagado'}.`;
  if (status === 'consent') return `${device.name} necesita que aceptes el permiso de la cámara en ese equipo; ya le aparece la pregunta.`;
  if (status === 'error') return `${device.name}: ${message || 'no se pudo'}.`;
  return `${device.name} no respondió a tiempo. Puede que Eddie esté cerrado o en segundo plano allí.`;
}
