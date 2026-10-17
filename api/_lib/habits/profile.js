// What the YouTube history says about the user's habits, and when it is a good moment to offer a song. Pure: the
// history comes in as [{ id, title, music, visits: [unix seconds] }], the answer goes out, so it is tested without a
// server. «Offer» means a question Eddie asks («¿Quieres que reproduzca X?»); he never plays anything by himself.
const DAY = 86400;
const WINDOW_MIN = 90; // a visit counts for «now» when it was within this many minutes of the same time of day
const HALF_LIFE_DAYS = 30;

export const MIN_SCORE = 1.2;
export const MIN_VISITS = 2; // a song heard once is a curiosity, not a habit
export const OFFER_GAP_SECONDS = 3 * 3600; // between two offers, whatever the answer
export const MAX_OFFERS_PER_DAY = 3;
export const DECLINED_QUIET_DAYS = 7;
export const QUIET_HOURS = [23, 7]; // no offers from 11 pm to 7 am

const formatters = new Map();
function formatter(timezone) {
  if (!formatters.has(timezone)) {
    formatters.set(timezone, new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }));
  }
  return formatters.get(timezone);
}

const DOW = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

// → { dow: 0–6 (0 = Sunday), minutes: minutes since local midnight }
export function localSlot(seconds, timezone = 'UTC') {
  let parts;
  try {
    parts = formatter(timezone).formatToParts(new Date(seconds * 1000));
  } catch {
    parts = formatter('UTC').formatToParts(new Date(seconds * 1000));
  }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { dow: DOW[get('weekday')] ?? 0, minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}

const isWeekend = (dow) => dow === 0 || dow === 6;
const circular = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 1440 - d);
};

// How much this video belongs to «now»: its visits near this time of day, same kind of day, recent ones weigh more.
export function scoreAt(item, nowSeconds, timezone) {
  const now = localSlot(nowSeconds, timezone);
  let score = 0;
  for (const v of item.visits) {
    const age = (nowSeconds - v) / DAY;
    if (age < 0) continue;
    const slot = localSlot(v, timezone);
    const gap = circular(slot.minutes, now.minutes);
    if (gap > WINDOW_MIN) continue;
    const kind = isWeekend(slot.dow) === isWeekend(now.dow) ? 1 : 0.4;
    score += (1 - gap / WINDOW_MIN) * kind * 0.5 ** (age / HALF_LIFE_DAYS);
  }
  return score;
}

export function topVideos(items, limit = 5) {
  return [...items].sort((a, b) => b.visits.length - a.visits.length || b.visits.at(-1) - a.visits.at(-1)).slice(0, limit);
}

const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// For the «what do I listen to most» questions: the favourites and the hours of the day they are listened at.
export function summarize(items, { timezone = 'UTC', now = Date.now() / 1000 } = {}) {
  const buckets = new Array(24).fill(0);
  const days = { weekday: 0, weekend: 0 };
  for (const item of items) {
    for (const v of item.visits) {
      const slot = localSlot(v, timezone);
      buckets[Math.floor(slot.minutes / 60)] += 1;
      days[isWeekend(slot.dow) ? 'weekend' : 'weekday'] += 1;
    }
  }
  const peakHours = buckets
    .map((count, hour) => ({ hour, count }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((b) => hourLabel(b.hour));
  const music = items.filter((i) => i.music);
  return {
    videos: items.length,
    favourites: topVideos(items, 8).map((i) => ({ title: i.title, times: i.visits.length, music: i.music })),
    musicFavourites: topVideos(music, 5).map((i) => ({ title: i.title, times: i.visits.length })),
    peakHours,
    weekdayShare: days.weekday + days.weekend ? Math.round((100 * days.weekday) / (days.weekday + days.weekend)) : 0,
    now: hourLabel(Math.floor(localSlot(now, timezone).minutes / 60)),
    nowFits: topVideos(
      items.map((i) => ({ ...i, fit: scoreAt(i, now, timezone) })).filter((i) => i.fit > 0).sort((a, b) => b.fit - a.fit).slice(0, 3),
      3,
    ).map((i) => i.title),
  };
}

// The song to offer right now, or null. `offers`: [{ videoId, offeredAt (seconds), outcome }] of the last days.
export function pickOffer(items, { timezone = 'UTC', now = Date.now() / 1000, offers = [] } = {}) {
  const hour = Math.floor(localSlot(now, timezone).minutes / 60);
  if (hour >= QUIET_HOURS[0] || hour < QUIET_HOURS[1]) return null;
  if (offers.some((o) => now - o.offeredAt < OFFER_GAP_SECONDS)) return null;
  const today = localDay(now, timezone);
  if (offers.filter((o) => localDay(o.offeredAt, timezone) === today).length >= MAX_OFFERS_PER_DAY) return null;
  const declined = new Set(offers.filter((o) => o.outcome === 'declined' && now - o.offeredAt < DECLINED_QUIET_DAYS * DAY).map((o) => o.videoId));
  const best = items
    .filter((i) => i.visits.length >= MIN_VISITS && !declined.has(i.id))
    .map((i) => ({ item: i, score: scoreAt(i, now, timezone) }))
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)[0];
  return best ? { videoId: best.item.id, title: best.item.title, score: Math.round(best.score * 100) / 100 } : null;
}

function localDay(seconds, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(seconds * 1000));
  } catch {
    return new Date(seconds * 1000).toISOString().slice(0, 10);
  }
}

// What Eddie says out loud when he offers it.
export function offerText(title) {
  const clean = String(title).replace(/\s+/g, ' ').trim().slice(0, 90);
  return `¿Quieres que reproduzca «${clean}»? Sueles escucharla a esta hora.`;
}
