// What the user watched and listened to on YouTube, from Chrome's own local history — only if they gave the
// «history» permission from the popup (an optional permission: nothing is read before that, and removing it stops it).
// Only YouTube watch pages are looked at: the video id, its title and when it was opened. Nothing else in the
// history is read, kept or sent.
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const HISTORY_DAYS = 60;
export const MAX_ITEMS = 300;
export const MAX_VISITS = 30;
const MAX_TITLE = 120;

// → { id, music } for a YouTube watch address, or null.
export function watchOf(value) {
  let u;
  try {
    u = new URL(String(value || ''));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1);
    return ID_RE.test(id) ? { id, music: false } : null;
  }
  if (!WATCH_HOSTS.has(host) || u.pathname !== '/watch') return null;
  const id = u.searchParams.get('v') || '';
  return ID_RE.test(id) ? { id, music: host === 'music.youtube.com' } : null;
}

// «Song - Artist - YouTube» → «Song - Artist»; the unread-count prefix «(3) » goes too.
export function cleanTitle(title) {
  return String(title || '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s*[-–]\s*(YouTube Music|YouTube)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE);
}

// Groups history entries (one per address: the same video can have several, e.g. with &t=) by video.
// → [{ id, title, music, visits: [unix seconds, newest last, at most MAX_VISITS] }], the most watched first.
export function groupVideos(entries) {
  const byId = new Map();
  for (const e of entries) {
    const w = watchOf(e.url);
    if (!w) continue;
    const title = cleanTitle(e.title);
    const item = byId.get(w.id) || { id: w.id, title: '', music: false, visits: [] };
    if (title && !item.title) item.title = title;
    item.music = item.music || w.music;
    item.visits.push(...e.visits);
    byId.set(w.id, item);
  }
  return [...byId.values()]
    .filter((v) => v.title && v.visits.length)
    .map((v) => ({ ...v, visits: [...new Set(v.visits)].sort((a, b) => a - b).slice(-MAX_VISITS) }))
    .sort((a, b) => b.visits.length - a.visits.length || b.visits.at(-1) - a.visits.at(-1))
    .slice(0, MAX_ITEMS);
}

// Reads the YouTube part of the history. `history` is chrome.history (or a double in tests).
export async function collectYoutube(history, now = Date.now()) {
  const startTime = now - HISTORY_DAYS * 86400000;
  const found = await history.search({ text: 'youtu', startTime, maxResults: 5000 });
  const entries = [];
  for (const h of found) {
    if (!watchOf(h.url)) continue;
    const visits = (await history.getVisits({ url: h.url })).map((v) => Math.round(v.visitTime / 1000)).filter((s) => s * 1000 >= startTime);
    if (visits.length) entries.push({ url: h.url, title: h.title, visits });
  }
  return groupVideos(entries);
}
