// Notifications that arrive with Eddie closed (Web Push): this browser asks
// permission, subscribes with the server's public key and tells the server
// where to send. The server side is api/_lib/push/; the notification itself
// is shown by the service worker (public/sw.js).
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const READY_MS = 4000;

async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/push${path}${qs}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `No se pudo completar (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// iPhone and iPad only allow notifications to an app added to the home screen.
export function needsInstall() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  return ios && !standalone;
}

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), READY_MS))]);
  if (!reg) throw new Error('La app todavía no está lista para notificaciones (solo funcionan en la versión publicada, ya cargada una vez).');
  return reg;
}

function keyBytes(base64url) {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// → { supported, permission, endpoint, subscribed, devices }  (subscribed: this browser's subscription is also known to the server)
export async function pushState(signedIn) {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', endpoint: '', subscribed: false, devices: 0 };
  const permission = Notification.permission;
  let endpoint = '';
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
    endpoint = (await reg?.pushManager.getSubscription())?.endpoint || '';
  } catch {
    endpoint = '';
  }
  if (!signedIn) return { supported: true, permission, endpoint, subscribed: false, devices: 0 };
  const status = await call('/status', { query: endpoint ? { endpoint } : {} }).catch(() => ({ subscribed: false, devices: 0 }));
  return { supported: true, permission, endpoint, subscribed: Boolean(endpoint && status.subscribed), devices: status.devices || 0 };
}

export async function enablePush({ clientId, platform }) {
  if (!pushSupported()) throw new Error('Este navegador no admite notificaciones.');
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('El navegador no dio permiso para las notificaciones. Puedes cambiarlo en el candado de la barra de direcciones.');
  const [reg, { publicKey }] = await Promise.all([registration(), call('/key')]);
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  let sub;
  try {
    sub = await reg.pushManager.subscribe(options);
  } catch (err) {
    if (err?.name !== 'InvalidStateError') throw err;
    // Subscribed with another key before: start over.
    await (await reg.pushManager.getSubscription())?.unsubscribe();
    sub = await reg.pushManager.subscribe(options);
  }
  await call('/subscribe', { method: 'POST', body: { clientId, platform, subscription: sub.toJSON() } });
  return sub.endpoint;
}

export async function disablePush() {
  const reg = await registration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await call('/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export const sendTestPush = () => call('/test', { method: 'POST', body: {} });

// Signing in again (or as someone else) on a browser that already accepted
// notifications: tell the server this browser belongs to this account.
export async function resyncPush({ clientId, platform }) {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((resolve) => setTimeout(() => resolve(null), 1500))]);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return false;
    await call('/subscribe', { method: 'POST', body: { clientId, platform, subscription: sub.toJSON() } });
    return true;
  } catch {
    return false;
  }
}
