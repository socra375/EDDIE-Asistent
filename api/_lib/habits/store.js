// Database side of the YouTube habits (db/migrations/0039_youtube_habits.sql).
import { getDb } from '../db.js';

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_ITEMS = 300;
const MAX_VISITS = 30;
const OFFER_DAYS = 14;

// What the extension sent, cleaned: nothing outside this shape is kept.
export function cleanItems(value) {
  if (!Array.isArray(value)) return [];
  const now = Date.now() / 1000;
  const items = [];
  for (const raw of value.slice(0, MAX_ITEMS)) {
    const id = String(raw?.id || '');
    const title = String(raw?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const visits = (Array.isArray(raw?.visits) ? raw.visits : [])
      .map(Number)
      .filter((s) => Number.isFinite(s) && s > 1_000_000_000 && s <= now + 60)
      .map(Math.round)
      .sort((a, b) => a - b)
      .slice(-MAX_VISITS);
    if (ID_RE.test(id) && title && visits.length) items.push({ id, title, music: raw?.music === true, visits });
  }
  return items;
}

const parse = (v) => {
  if (Array.isArray(v)) return v;
  try {
    const out = JSON.parse(v);
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
};

export async function saveHistory(userId, items) {
  const sql = getDb();
  await sql`
    insert into youtube_history (user_id, items, synced_at) values (${userId}, ${JSON.stringify(items)}, now())
    on conflict (user_id) do update set items = excluded.items, synced_at = now()
  `;
}

export async function loadHistory(userId) {
  const sql = getDb();
  const rows = await sql`select items, synced_at from youtube_history where user_id = ${userId}`;
  return rows[0] ? { items: cleanItems(parse(rows[0].items)), syncedAt: new Date(rows[0].synced_at).toISOString() } : { items: [], syncedAt: null };
}

// Forgets the history and the offers.
export async function clearHabits(userId) {
  const sql = getDb();
  await sql`delete from youtube_history where user_id = ${userId}`;
  await sql`delete from music_offers where user_id = ${userId}`;
}

// A song the user accepted counts as one more time they listened to it.
export async function addVisit(userId, videoId, title, seconds) {
  const { items } = await loadHistory(userId);
  const found = items.find((i) => i.id === videoId);
  if (found) found.visits = [...found.visits, seconds].slice(-MAX_VISITS);
  else items.push({ id: videoId, title, music: true, visits: [seconds] });
  await saveHistory(userId, items.slice(0, MAX_ITEMS));
}

export async function recentOffers(userId) {
  const sql = getDb();
  const rows = await sql`
    select video_id, offered_at, outcome from music_offers
    where user_id = ${userId} and offered_at > now() - make_interval(days => ${OFFER_DAYS}) order by offered_at desc limit 60
  `;
  return rows.map((r) => ({ videoId: r.video_id, offeredAt: new Date(r.offered_at).getTime() / 1000, outcome: r.outcome || null }));
}

export async function createOffer(userId, { videoId, title }) {
  const sql = getDb();
  const rows = await sql`insert into music_offers (user_id, video_id, title) values (${userId}, ${videoId}, ${title}) returning id`;
  return rows[0].id;
}

// → the offer when it was waiting for an answer.
export async function answerOffer(userId, id, outcome) {
  const sql = getDb();
  const rows = await sql`
    update music_offers set outcome = ${outcome}, answered_at = now()
    where id = ${id} and user_id = ${userId} and outcome is null returning video_id, title
  `;
  return rows[0] ? { videoId: rows[0].video_id, title: rows[0].title } : null;
}
