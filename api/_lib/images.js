// Images Eddie can see. The browser (and the Telegram bot) send them already
// reduced and as base64; here they are checked before anything is forwarded
// to an AI provider. Vercel's functions accept at most ~4.5 MB per request,
// so the limits keep a whole request with three images well below that.
export const MAX_IMAGES = 3;
// Base64 characters per image (≈ 900 KB of picture).
export const MAX_IMAGE_CHARS = 1_200_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

class ImageError extends Error {
  constructor(message) {
    super(message);
    this.code = 'BAD_REQUEST';
  }
}

// One message's images → [{ mimeType, data }]. Throws on anything malformed.
export function sanitizeImages(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new ImageError('Las imágenes deben ser una lista.');
  if (raw.length > MAX_IMAGES) throw new ImageError(`Máximo ${MAX_IMAGES} imágenes por mensaje.`);
  return raw.map((img) => {
    if (!img || typeof img !== 'object' || !MIME_TYPES.has(img.mimeType)) throw new ImageError('Formato de imagen no admitido (usa JPG, PNG, WebP o GIF).');
    if (typeof img.data !== 'string' || !img.data) throw new ImageError('Una imagen llegó vacía.');
    if (img.data.length > MAX_IMAGE_CHARS) throw new ImageError('Una imagen es demasiado grande (se reduce sola en la app; prueba con otra).');
    if (!BASE64_RE.test(img.data)) throw new ImageError('Una imagen llegó dañada.');
    return { mimeType: img.mimeType, data: img.data };
  });
}

// Only the pictures of the last two user messages travel to the model (it
// needs the latest, and the one before for follow-ups) and never more than
// MAX_IMAGES in total: older ones are dropped, newest first wins.
export function limitImages(messages) {
  const withImages = messages.map((m, i) => (m.images?.length ? i : -1)).filter((i) => i >= 0);
  const keep = new Set();
  let total = 0;
  for (const i of withImages.slice(-2).reverse()) {
    const room = MAX_IMAGES - total;
    if (room <= 0) break;
    const images = messages[i].images.slice(0, room);
    total += images.length;
    keep.add(i);
    messages[i] = { ...messages[i], images };
  }
  return messages.map((m, i) => (m.images && !keep.has(i) ? { role: m.role, content: m.content } : m));
}

export const hasImages = (messages) => messages.some((m) => m.images?.length);
