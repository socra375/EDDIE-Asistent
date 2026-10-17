// /api/connectors/habits — what Eddie learned from the YouTube history, and the songs he offers:
//   GET  habits          { count, syncedAt, favourites } (Configuración shows it)
//   POST habits/suggest  { tz } → { offer: { id, videoId, title, text } } or { offer: null }
//   POST habits/answer   { id, outcome: 'accepted' | 'declined' }
//   POST habits/clear    forgets the history and the offers
import { requireUser } from '../session.js';
import { loadSettings } from '../telegram/serverActions.js';
import { validTimezone } from '../routines/plans.js';
import { addVisit, answerOffer, clearHabits, createOffer, loadHistory, recentOffers } from './store.js';
import { offerText, pickOffer, summarize } from './profile.js';

const UUID = /^[0-9a-f-]{36}$/i;

export async function handleHabitsRoute({ method, path = [], cookies = {}, body }) {
  const sub = path[1];
  const user = await requireUser(cookies);
  if (!process.env.DATABASE_URL) return { status: 503, json: { error: 'Falta configurar la base de datos.' } };

  if (!sub && method === 'GET') {
    const { items, syncedAt } = await loadHistory(user.id);
    const summary = summarize(items, {});
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { count: items.length, syncedAt, favourites: summary.musicFavourites.length ? summary.musicFavourites : summary.favourites.slice(0, 5) } };
  }
  if (sub === 'suggest' && method === 'POST') {
    const settings = await loadSettings(user.id);
    if (settings.musicOffers === false) return { status: 200, json: { offer: null } };
    const timezone = validTimezone(body?.tz) || 'UTC';
    const [{ items }, offers] = await Promise.all([loadHistory(user.id), recentOffers(user.id)]);
    const pick = items.length ? pickOffer(items, { timezone, offers }) : null;
    if (!pick) return { status: 200, json: { offer: null } };
    const id = await createOffer(user.id, pick);
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: { offer: { id, videoId: pick.videoId, title: pick.title, text: offerText(pick.title) } } };
  }
  if (sub === 'answer' && method === 'POST') {
    const outcome = body?.outcome === 'accepted' ? 'accepted' : body?.outcome === 'declined' ? 'declined' : null;
    if (!UUID.test(String(body?.id || '')) || !outcome) return { status: 400, json: { error: 'Indica la oferta y la respuesta.' } };
    const offer = await answerOffer(user.id, body.id, outcome);
    if (offer && outcome === 'accepted') await addVisit(user.id, offer.videoId, offer.title, Math.round(Date.now() / 1000));
    return { status: 200, json: { ok: true } };
  }
  if (sub === 'clear' && method === 'POST') {
    await clearHabits(user.id);
    return { status: 200, json: { ok: true } };
  }
  return { status: 404, json: { error: 'Ruta no encontrada.' } };
}
