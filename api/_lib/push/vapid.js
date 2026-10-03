// The server's VAPID identity (the key pair that proves to the push services
// that the notifications come from Eddie). Nothing to configure and nothing to
// paste anywhere: the pair is made the first time it is needed and kept in
// Neon with the private half encrypted with CONNECTOR_SECRET. If you prefer,
// VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Vercel take over.
import webpush from 'web-push';
import { hasTokenSecret, openToken, sealToken } from '../secretBox.js';
import { readKeys, saveKeys } from './store.js';

const PUBLIC_RE = /^[A-Za-z0-9_-]{80,100}$/;
const PRIVATE_RE = /^[A-Za-z0-9_-]{40,50}$/;

export function pushError(message, status = 503) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The contact the push services may use if something is wrong (https page or mailto:).
export function vapidSubject(env = process.env) {
  if (/^(https:\/\/|mailto:)/.test(env.VAPID_SUBJECT || '')) return env.VAPID_SUBJECT;
  if (/^https:\/\//.test(env.APP_URL || '')) return env.APP_URL;
  if (/^[^@\s]+@[^@\s]+$/.test(env.EDDIE_OWNER_EMAIL || '')) return `mailto:${env.EDDIE_OWNER_EMAIL}`;
  return 'mailto:eddie@example.com';
}

let cached = null;

// → { publicKey, privateKey, subject }
export async function getVapid({ env = process.env, store = { readKeys, saveKeys }, generate = () => webpush.generateVAPIDKeys() } = {}) {
  const subject = vapidSubject(env);
  if (PUBLIC_RE.test(env.VAPID_PUBLIC_KEY || '') && PRIVATE_RE.test(env.VAPID_PRIVATE_KEY || '')) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  }
  if (cached && cached.secret === env.CONNECTOR_SECRET) return { ...cached.keys, subject };
  if (!hasTokenSecret(env)) {
    throw pushError('Las notificaciones necesitan CONNECTOR_SECRET en Vercel (para guardar su llave cifrada) o VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY.');
  }
  let row = await store.readKeys();
  if (!row) {
    const made = generate();
    row = await store.saveKeys(made.publicKey, sealToken(made.privateKey, env.CONNECTOR_SECRET));
  }
  let privateKey;
  try {
    privateKey = openToken(row.privateKey, env.CONNECTOR_SECRET);
  } catch {
    privateKey = null;
  }
  if (!privateKey || !PRIVATE_RE.test(privateKey)) {
    throw pushError('No se pudo leer la llave de las notificaciones (¿cambió CONNECTOR_SECRET?). Define VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY nuevos o vuelve a activar las notificaciones tras limpiar la tabla push_keys.');
  }
  cached = { secret: env.CONNECTOR_SECRET, keys: { publicKey: row.publicKey, privateKey } };
  return { ...cached.keys, subject };
}

export function resetVapidCache() {
  cached = null;
}
