// Sends a notification to every device a user has enabled them on. The
// payload is plain text the service worker shows (public/sw.js): title, body
// and the address to open when it is tapped.
import webpush from 'web-push';
import { getVapid } from './vapid.js';
import { dropEndpoint, markResult, subscriptionsOf } from './store.js';

const TTL_S = 24 * 60 * 60;

// Only the real push services are ever called with a browser-supplied
// address: otherwise a subscription could make the server request any URL.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443') && url.href.length <= 700 && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

const clip = (value, max) => String(value ?? '').replace(/[\p{Cc}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function buildPayload({ title, body, url = '/', tag } = {}) {
  return JSON.stringify({
    title: clip(title, 80) || 'Eddie',
    body: clip(body, 240),
    url: typeof url === 'string' && /^\/(?!\/)/.test(url) && url.length <= 200 ? url : '/',
    ...(tag ? { tag: clip(tag, 40) } : {}),
  });
}

// → { sent, removed, failed, devices }
export async function sendPush(userId, message, { sender = webpush, vapid = getVapid, subscriptions = subscriptionsOf } = {}) {
  const result = { sent: 0, removed: 0, failed: 0, devices: 0 };
  const subs = (await subscriptions(userId)).filter((s) => isPushEndpoint(s.endpoint));
  result.devices = subs.length;
  if (!subs.length) return result;
  const keys = await vapid();
  const payload = buildPayload(message);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: TTL_S,
          urgency: 'normal',
          vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          timeout: 10000,
        });
        result.sent += 1;
        await markResult(s.endpoint, true).catch(() => {});
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          result.removed += 1;
          await dropEndpoint(s.endpoint).catch(() => {});
        } else {
          result.failed += 1;
          await markResult(s.endpoint, false).catch(() => {});
        }
      }
    }),
  );
  return result;
}
