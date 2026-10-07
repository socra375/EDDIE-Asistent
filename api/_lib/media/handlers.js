// /api/connectors/media — the gallery, for the Galería screen and the centre of Inicio:
//   GET  media                    the user's pictures (newest first) and the limits
//   GET  media/file?id=…          the picture itself (only the owner's)
//   POST media/create  { prompt, aspect?, mirror?, timezone? }
//   POST media/edit    { id, instruction, mirror?, timezone? }   a new picture; the original stays
//   POST media/delete  { id }
// Making a picture counts as one request of the day's allowance (api/_lib/usage/).
import { requireUser } from '../session.js';
import { takeRequest } from '../usage/store.js';
import { MediaError } from './image.js';
import { createImage, dailyImageLimit, editImage, removeImage } from './create.js';
import { MAX_ITEMS, MAX_TOTAL_BYTES, getMediaFile, listMedia, mediaUsage } from './store.js';
import { sendCreatedImages } from '../telegram/mirror.js';
import { getLinkByUser } from '../telegram/store.js';

const UUID = /^[0-9a-f-]{36}$/i;
const STATUS = { BAD_REQUEST: 400, NOT_FOUND: 404, FULL: 409, RATE_LIMITED: 429, BLOCKED: 422, NO_IMAGE: 422, TIMEOUT: 504, PROVIDER_UNAVAILABLE: 503, PROVIDER_ERROR: 502 };
const missingEnv = () => ['DATABASE_URL', 'GEMINI_API_KEY'].filter((name) => !process.env[name]);

async function limits(userId) {
  const usage = await mediaUsage(userId);
  return { count: usage.count, bytes: usage.bytes, last24h: usage.last24h, maxItems: MAX_ITEMS, maxBytes: MAX_TOTAL_BYTES, dailyLimit: dailyImageLimit() };
}

// Runs a creation or an edit under the request allowance; gives the request back if it fails.
async function guarded(user, body, work) {
  const slot = await takeRequest(user.id, { timezone: body?.timezone });
  if (!slot.allowed) return { status: 429, json: { error: slot.message, code: 'QUOTA' } };
  try {
    const out = await work();
    // To the user's Telegram too, when the app asked and a chat is linked.
    if (body?.mirror === true) {
      const link = await getLinkByUser(user.id).catch(() => null);
      if (link) await Promise.race([sendCreatedImages(user.id, link.chatId, [{ type: 'show_image', id: out.item.id }]), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: { item: out.item, usedFallback: out.usedFallback, limits: await limits(user.id) } };
  } catch (err) {
    await slot.release();
    if (err instanceof MediaError) return { status: STATUS[err.code] || 502, json: { error: err.message, code: err.code } };
    throw err;
  }
}

export async function handleMediaRoute({ method, path = [], cookies = {}, query = {}, body }) {
  const user = await requireUser(cookies);
  const sub = path[1];
  const missing = missingEnv();

  if (!sub && method === 'GET') {
    if (missing.length) return { status: 200, json: { configured: false, missing, items: [] } };
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { configured: true, items: await listMedia(user.id), limits: await limits(user.id) } };
  }
  if (sub === 'file' && method === 'GET') {
    if (!UUID.test(String(query.id || ''))) return { status: 400, json: { error: 'Indica la imagen.' } };
    const file = await getMediaFile(user.id, query.id);
    if (!file) return { status: 404, json: { error: 'Esa imagen ya no existe.' } };
    // Ids never change what they point to, so the browser may keep it for good (privately).
    return { status: 200, body: file.buffer, contentType: file.mime, headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } };
  }
  if (sub === 'create' && method === 'POST') {
    if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
    return guarded(user, body, () => createImage({ userId: user.id, prompt: body?.prompt, aspect: body?.aspect }));
  }
  if (sub === 'edit' && method === 'POST') {
    if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica la imagen que quieres editar.' } };
    return guarded(user, body, () => editImage({ userId: user.id, instruction: body?.instruction, id: body.id }));
  }
  if (sub === 'delete' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica la imagen.' } };
    const removed = await removeImage(user.id, body.id);
    return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Esa imagen ya no existe.' } };
  }
  return { status: 404, json: { error: 'Esa acción de imágenes no existe.' } };
}
