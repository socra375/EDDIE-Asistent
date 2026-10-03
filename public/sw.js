// Eddie's service worker: shows Eddie's notifications when the app is closed
// (reminders, the morning summary — see the push handlers at the end), lets the
// installed app open without a network and keeps repeat visits fast. It caches ONLY the app itself (the page, its
// scripts, styles and icons, and the camera detector's model once downloaded). Everything under /api — the login cookie, the
// AI, the camera frames, the voice — always goes straight to the network and
// is never stored, and so does everything that isn't a GET to this origin.
const SHELL = 'eddie-shell-v1';
const ASSETS = 'eddie-assets-v1';
const MODELS = 'eddie-models-v1';
const KEEP = [SHELL, ASSETS, MODELS];
const SHELL_FILES = ['/', '/manifest.webmanifest', '/favicon.svg', '/eddie-icon-192.png', '/eddie-icon-512.png', '/apple-touch-icon.png'];
const MAX_ASSETS = 80;
// A page that doesn't answer in this long is served from the cache instead.
const PAGE_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

// Hashed files (/assets/index-ab12.js) never change: the cache wins.
async function assetFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    await trim(cache);
  }
  return res;
}

// The detector's files (/models/…, ~18 MB) are fetched once, when the camera is
// first used, and then kept for good (they never change).
async function modelFirst(request) {
  const cache = await caches.open(MODELS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

// The page itself: the network first (so a new version shows up), the cached
// copy when offline or slow.
async function pageFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), PAGE_TIMEOUT_MS))]);
    if (res.ok) await cache.put('/', res.clone());
    return res;
  } catch {
    return (await cache.match('/')) || new Response('Eddie no pudo abrirse sin conexión. Conéctate una vez para guardarlo en este equipo.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function shellFile(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // fonts, maps, weather… stay the browser's business
  if (url.pathname.startsWith('/api/')) return; // never cached, never touched
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(pageFirst(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetFirst(request));
  } else if (url.pathname.startsWith('/models/')) {
    event.respondWith(modelFirst(request));
  } else if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(shellFile(request));
  }
});

// ---- Notifications (Web Push) ----
// The server (api/_lib/push/) sends { title, body, url, tag } as JSON. Only text
// is shown and only an address on this site is opened.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = String(data.title || 'Eddie').slice(0, 80);
  event.waitUntil(
    self.registration.showNotification(title, {
      body: String(data.body || '').slice(0, 240),
      icon: '/eddie-icon-192.png',
      badge: '/favicon.svg',
      tag: typeof data.tag === 'string' ? data.tag.slice(0, 40) : undefined,
      data: { url: typeof data.url === 'string' ? data.url : '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target;
  try {
    target = new URL(event.notification.data?.url || '/', self.location.origin);
    if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  } catch {
    target = new URL('/', self.location.origin);
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        // The open app switches screen by itself (see App.jsx); nothing reloads.
        open.postMessage({ type: 'eddie:open', search: target.search });
        return;
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});
