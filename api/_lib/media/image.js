// Creating and editing pictures. Gemini's image model does both with the same
// call (a text instruction, plus the picture to change when editing). When
// Gemini is out of quota or down, a new picture (not an edit) can still come
// from Pollinations, a free service with no key; set MEDIA_FALLBACK=off to
// never use it (the prompt would leave for a third party).
//
//   GEMINI_IMAGE_MODEL   model id (default gemini-2.5-flash-image; if it is
//                        gone Eddie picks the first image model the key can use)
//   MEDIA_FALLBACK       "off" disables Pollinations
//
// Everything that comes back is checked: a real PNG/JPEG/WebP, not too big.
export const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const DEFAULT_ASPECT = '1:1';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_PROMPT_CHARS = 800;
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-image';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_TIMEOUT_MS = 38000;
const FALLBACK_TIMEOUT_MS = 30000;
const POLLINATIONS_SIZES = { '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344], '4:3': [1152, 864], '3:4': [864, 1152] };

export class MediaError extends Error {
  constructor(message, code = 'MEDIA_FAILED') {
    super(message);
    this.code = code;
  }
}

export const cleanAspect = (value) => (ASPECTS.includes(value) ? value : DEFAULT_ASPECT);

// What the user asked for, tidied: one line, no control characters, capped.
export function cleanPrompt(value, max = MAX_PROMPT_CHARS) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// The kind of picture these bytes are, by their first bytes (never by what a server claims), or null.
export function sniffImage(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

// base64 → { mimeType, buffer } for a real picture within the size cap, else null.
export function checkImage(b64) {
  if (typeof b64 !== 'string' || !b64) return null;
  const buffer = Buffer.from(b64, 'base64');
  const mimeType = sniffImage(buffer);
  return mimeType && buffer.length <= MAX_IMAGE_BYTES ? { mimeType, buffer } : null;
}

// ---- Gemini ----
let chosenModel = null;

function geminiError(status, data) {
  const message = data?.error?.message || `Gemini respondió con estado ${status}.`;
  if (status === 429 || data?.error?.status === 'RESOURCE_EXHAUSTED') return new MediaError('Se acabó el cupo gratis de imágenes de Gemini por ahora (se renueva solo; Google lo mide por minuto y por día).', 'RATE_LIMITED');
  if (status === 404) return new MediaError(message, 'NOT_FOUND');
  if (status === 400 && /image|modalit|aspect/i.test(message)) return new MediaError(message, 'BAD_PARAMS');
  if (status === 403 || status === 401) return new MediaError('Gemini rechazó la clave para generar imágenes (revisa GEMINI_API_KEY y que tenga acceso a modelos de imagen).', 'PROVIDER_UNAVAILABLE');
  if (status >= 500) return new MediaError('Gemini no está respondiendo ahora.', 'PROVIDER_UNAVAILABLE');
  return new MediaError(message, 'PROVIDER_ERROR');
}

// The image model this key can use, when the default is gone: the first one that
// lists generateContent and has "image" in its name.
async function discoverModel(apiKey, fetchImpl) {
  const res = await fetchImpl(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(8000) });
  const data = await res.json().catch(() => null);
  const names = (data?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /image/i.test(m.name || '') && !/imagen|embedding|vision/i.test(m.name || ''))
    .map((m) => String(m.name).replace(/^models\//, ''));
  return names.find((n) => /flash-image/i.test(n)) || names[0] || null;
}

async function geminiCall({ apiKey, model, parts, aspect, withAspect, fetchImpl }) {
  const generationConfig = { responseModalities: ['TEXT', 'IMAGE'], ...(withAspect ? { imageConfig: { aspectRatio: aspect } } : {}) };
  const res = await fetchImpl(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw geminiError(res.status, data);
  return data;
}

function pictureOf(data) {
  const block = data?.promptFeedback?.blockReason;
  if (block) throw new MediaError('Gemini no quiso crear esa imagen por sus políticas de contenido. Prueba con otra descripción.', 'BLOCKED');
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      const checked = checkImage(inline.data);
      if (checked) return checked;
    }
  }
  const text = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
  if (/SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(String(candidate?.finishReason || ''))) throw new MediaError('Gemini no quiso crear esa imagen por sus políticas de contenido. Prueba con otra descripción.', 'BLOCKED');
  throw new MediaError(text ? `Gemini no devolvió una imagen: ${text.slice(0, 200)}` : 'Gemini no devolvió ninguna imagen. Prueba con otra descripción.', 'NO_IMAGE');
}

// → { mimeType, buffer, provider: 'gemini' }. `source` ({ mimeType, data (base64) }) makes it an edit.
export async function geminiImage({ prompt, aspect = DEFAULT_ASPECT, source = null, env = process.env, fetchImpl = globalThis.fetch }) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new MediaError('Para crear imágenes falta GEMINI_API_KEY en Vercel.', 'PROVIDER_UNAVAILABLE');
  const text = source ? `Edita la imagen adjunta según esta instrucción y deja intacto todo lo demás: ${prompt}` : prompt;
  const parts = [{ text }, ...(source ? [{ inline_data: { mime_type: source.mimeType, data: source.data } }] : [])];
  let model = chosenModel || env.GEMINI_IMAGE_MODEL || GEMINI_DEFAULT_MODEL;
  let withAspect = !source;
  let discovered = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const data = await geminiCall({ apiKey, model, parts, aspect, withAspect, fetchImpl });
      chosenModel = model;
      return { ...pictureOf(data), provider: 'gemini' };
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new MediaError('Gemini tardó demasiado en crear la imagen. Inténtalo otra vez.', 'TIMEOUT');
      if (!(err instanceof MediaError)) throw new MediaError('No pude contactar a Gemini para crear la imagen.', 'PROVIDER_UNAVAILABLE');
      if (err.code === 'BAD_PARAMS' && withAspect) {
        withAspect = false; // that model takes no aspect ratio: let it choose
        continue;
      }
      if (err.code === 'NOT_FOUND' && !discovered) {
        discovered = true;
        const found = await discoverModel(apiKey, fetchImpl).catch(() => null);
        if (found && found !== model) {
          model = found;
          continue;
        }
      }
      throw err;
    }
  }
  throw new MediaError('No logré que Gemini creara la imagen.', 'PROVIDER_ERROR');
}

// ---- Pollinations (fallback for new pictures only) ----
export async function pollinationsImage({ prompt, aspect = DEFAULT_ASPECT, fetchImpl = globalThis.fetch }) {
  const [width, height] = POLLINATIONS_SIZES[cleanAspect(aspect)];
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=flux&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(FALLBACK_TIMEOUT_MS), headers: { Accept: 'image/*' } });
  } catch {
    throw new MediaError('El servicio de respaldo de imágenes no respondió.', 'PROVIDER_UNAVAILABLE');
  }
  if (!res.ok) throw new MediaError('El servicio de respaldo de imágenes no está disponible ahora.', 'PROVIDER_UNAVAILABLE');
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = buffer.length <= MAX_IMAGE_BYTES ? sniffImage(buffer) : null;
  if (!mimeType) throw new MediaError('El servicio de respaldo no devolvió una imagen válida.', 'PROVIDER_ERROR');
  return { mimeType, buffer, provider: 'pollinations' };
}

// Failures after which the free fallback may step in (never a refusal for content).
const FALLBACK_CODES = new Set(['RATE_LIMITED', 'PROVIDER_UNAVAILABLE', 'TIMEOUT', 'NOT_FOUND', 'PROVIDER_ERROR']);

// A new picture: Gemini first, then (for a creation only) the free fallback.
export async function makeImage({ prompt, aspect, source = null, env = process.env, gemini = geminiImage, fallback = pollinationsImage }) {
  try {
    return await gemini({ prompt, aspect, source, env });
  } catch (err) {
    if (source || !(err instanceof MediaError) || !FALLBACK_CODES.has(err.code) || String(env.MEDIA_FALLBACK || '').toLowerCase() === 'off') throw err;
    try {
      return await fallback({ prompt, aspect });
    } catch {
      throw err;
    }
  }
}
