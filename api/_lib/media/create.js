// Making, editing and deleting pictures for a user: the rules (limits, what
// can be edited) around the providers in image.js and the gallery in store.js.
//
//   DAILY_IMAGE_LIMIT   pictures created or edited per rolling 24 hours (default 20, 0 = no limit)
import { MediaError, cleanAspect, cleanPrompt, makeImage, MAX_IMAGE_BYTES, checkImage } from './image.js';
import { MAX_ITEMS, MAX_TOTAL_BYTES, addMedia, deleteMedia, getLatestMedia, getMedia, getMediaFile, mediaUsage } from './store.js';

export const DEFAULT_DAILY_IMAGES = 20;

export function dailyImageLimit(env = process.env) {
  const raw = String(env.DAILY_IMAGE_LIMIT ?? '').trim();
  const n = raw === '' ? DEFAULT_DAILY_IMAGES : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 500) : DEFAULT_DAILY_IMAGES;
}

// Throws a MediaError when the user cannot make another picture now.
export async function checkRoom(userId, env = process.env) {
  const limit = dailyImageLimit(env);
  const usage = await mediaUsage(userId);
  if (limit > 0 && usage.last24h >= limit) throw new MediaError(`Ya hiciste ${limit} imágenes en las últimas 24 horas (el tope diario). Vuelve a intentarlo más tarde o sube DAILY_IMAGE_LIMIT en Vercel.`, 'RATE_LIMITED');
  if (usage.count >= MAX_ITEMS || usage.bytes >= MAX_TOTAL_BYTES) throw new MediaError(`La galería está llena (${MAX_ITEMS} imágenes o ${Math.round(MAX_TOTAL_BYTES / 1048576)} MB): elimina alguna para crear otra.`, 'FULL');
  return usage;
}

const publicOf = (item, result) => ({ ...item, usedFallback: result.provider !== 'gemini' });

// A new picture. → { item, buffer, usedFallback } (throws MediaError).
export async function createImage({ userId, prompt: rawPrompt, aspect }, deps = {}) {
  const { env = process.env, make = makeImage } = deps;
  const prompt = cleanPrompt(rawPrompt);
  if (prompt.length < 3) throw new MediaError('Dime qué imagen quieres (al menos unas palabras).', 'BAD_REQUEST');
  await checkRoom(userId, env);
  const result = await make({ prompt, aspect: cleanAspect(aspect), env });
  const item = await addMedia(userId, { prompt, mime: result.mimeType, buffer: result.buffer, provider: result.provider });
  return { item: publicOf(item, result), buffer: result.buffer, usedFallback: result.provider !== 'gemini' };
}

// The picture to edit: one attached in the chat, else the gallery image `id`, else the latest.
async function sourceOf(userId, { id, attached }) {
  if (attached?.data) {
    const checked = checkImage(attached.data);
    if (!checked) throw new MediaError('No pude leer la imagen adjunta (usa PNG, JPG o WebP).', 'BAD_REQUEST');
    return { mimeType: checked.mimeType, data: attached.data, parentId: null, label: 'la imagen que adjuntaste' };
  }
  const meta = id ? await getMedia(userId, id) : await getLatestMedia(userId);
  if (!meta || meta.kind !== 'imagen') throw new MediaError(id ? 'Esa imagen ya no está en tu galería.' : 'Todavía no tienes imágenes para editar: pídeme crear una o adjunta una.', 'NOT_FOUND');
  const file = await getMediaFile(userId, meta.id);
  if (!file || file.buffer.length > MAX_IMAGE_BYTES) throw new MediaError('No pude abrir esa imagen para editarla.', 'NOT_FOUND');
  return { mimeType: file.mime, data: file.buffer.toString('base64'), parentId: meta.id, label: `«${meta.prompt.slice(0, 60)}»` };
}

// An edit of an existing picture (a new gallery item; the original stays). → { item, buffer, parent, usedFallback }
export async function editImage({ userId, instruction: rawInstruction, id = null, attached = null }, deps = {}) {
  const { env = process.env, make = makeImage } = deps;
  const instruction = cleanPrompt(rawInstruction);
  if (instruction.length < 3) throw new MediaError('Dime qué quieres cambiar de la imagen.', 'BAD_REQUEST');
  const source = await sourceOf(userId, { id, attached });
  await checkRoom(userId, env);
  const result = await make({ prompt: instruction, source: { mimeType: source.mimeType, data: source.data }, env });
  const item = await addMedia(userId, { prompt: instruction, mime: result.mimeType, buffer: result.buffer, provider: result.provider, parentId: source.parentId });
  return { item: publicOf(item, result), buffer: result.buffer, parent: source.label, usedFallback: result.provider !== 'gemini' };
}

export async function removeImage(userId, id) {
  return deleteMedia(userId, id);
}
