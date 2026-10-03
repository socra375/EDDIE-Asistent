// /api/connectors/push/* — notifications that arrive with Eddie closed.
//   GET  push/key          the server's public key (made on first use)
//   GET  push/status       ?endpoint= is this browser subscribed? how many devices does the account have?
//   POST push/subscribe    { clientId, subscription, platform } this browser accepts notifications
//   POST push/unsubscribe  { endpoint }
//   POST push/test         sends a test notification to all the account's devices
// Everything needs the login cookie.
import { requireUser } from '../session.js';
import { createRateLimiter } from '../rateLimit.js';
import { CLIENT_ID_RE, cleanPlatform } from '../devices/logic.js';
import { MAX_SUBSCRIPTIONS, hasEndpoint, removeSubscription, saveSubscription, subscriptionsOf } from './store.js';
import { isPushEndpoint, sendPush } from './send.js';
import { getVapid } from './vapid.js';

const KEY_RE = /^[A-Za-z0-9_-]{16,200}$/;
const testLimit = createRateLimiter({ perMinute: 4 });
const bad = (error, status = 400) => ({ status, json: { error } });

function fail(err) {
  if (err?.status) return bad(err.message, err.status);
  console.error('[push] unexpected error:', err);
  return bad('No se pudo completar la operación de notificaciones.', 500);
}

export async function handlePushRoute({ method, path = [], cookies = {}, query = {}, body }, deps = {}) {
  const user = await requireUser(cookies);
  const sub = path[1];
  const vapid = deps.vapid || getVapid;
  const send = deps.sendPush || sendPush;

  try {
    if (sub === 'key' && method === 'GET') {
      const { publicKey } = await vapid();
      return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { publicKey } };
    }

    if (sub === 'status' && method === 'GET') {
      const endpoint = String(query.endpoint || '');
      const [subscribed, all] = await Promise.all([endpoint ? hasEndpoint(user.id, endpoint) : false, subscriptionsOf(user.id)]);
      return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { subscribed, devices: all.length } };
    }

    if (sub === 'subscribe' && method === 'POST') {
      const s = body?.subscription;
      const endpoint = String(s?.endpoint || '');
      const p256dh = String(s?.keys?.p256dh || '');
      const auth = String(s?.keys?.auth || '');
      if (!isPushEndpoint(endpoint)) return bad('Este navegador usa un servicio de notificaciones que Eddie no admite.');
      if (!KEY_RE.test(p256dh) || !KEY_RE.test(auth)) return bad('La suscripción del navegador no es válida.');
      const clientId = CLIENT_ID_RE.test(String(body?.clientId || '')) ? String(body.clientId) : null;
      const existing = await subscriptionsOf(user.id);
      if (!existing.some((x) => x.endpoint === endpoint) && existing.length >= MAX_SUBSCRIPTIONS) {
        return bad(`Ya hay ${MAX_SUBSCRIPTIONS} dispositivos con notificaciones; desactívalas en alguno primero.`, 409);
      }
      await saveSubscription(user.id, { clientId, endpoint, p256dh, auth, platform: cleanPlatform(body?.platform) });
      return { status: 200, json: { ok: true, devices: existing.some((x) => x.endpoint === endpoint) ? existing.length : existing.length + 1 } };
    }

    if (sub === 'unsubscribe' && method === 'POST') {
      const removed = await removeSubscription(user.id, String(body?.endpoint || ''));
      return { status: 200, json: { ok: true, removed } };
    }

    if (sub === 'test' && method === 'POST') {
      if (!testLimit(`test:${user.id}`).ok) return bad('Espera un momento antes de otra prueba.', 429);
      const result = await send(user.id, { title: 'Eddie', body: 'Prueba: las notificaciones funcionan. Te avisaré aquí aunque Eddie esté cerrado.', url: '/', tag: 'eddie-test' });
      if (!result.devices) return bad('Este dispositivo todavía no tiene las notificaciones activadas.', 409);
      return { status: 200, json: result };
    }
  } catch (err) {
    return fail(err);
  }
  return { status: 405, json: { error: 'Método no permitido.' } };
}
