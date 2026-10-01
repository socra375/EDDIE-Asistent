// Pictures for Eddie to look at. The browser shrinks every image before it
// leaves the device (JPEG, longest side 1280 px) so a request stays small and
// quick, and makes a tiny thumbnail that is the only part kept in the saved
// conversation. The full picture travels once, with the message it belongs to.
export const MAX_IMAGES = 3;
export const IMAGE_PROMPT = '¿Qué ves en esta imagen?';
const MAX_SIDE = 1280;
const THUMB_SIDE = 160;
// Base64 characters, a bit under what the server accepts.
const MAX_BASE64_CHARS = 900_000;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

// Scales (w, h) down so the longest side is at most `max`; never up.
export function fitSize(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // fall through to <img>
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(source) {
  return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
}

function renderJpeg(source, side, quality) {
  const { width, height } = fitSize(...Object.values(sizeOf(source)), side);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  // A transparent PNG would turn black as a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export const base64Of = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

// File → { mimeType, data (base64), thumb (data URL), name }. Throws a
// message meant for the user.
export async function prepareImage(file) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('Ese archivo no es una imagen.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('La imagen pesa demasiado (máximo 25 MB).');
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new Error('No pude abrir esa imagen. Usa JPG, PNG, WebP o GIF (las HEIC del iPhone no se pueden leer aquí).');
  }
  let side = MAX_SIDE;
  let quality = 0.82;
  let dataUrl = renderJpeg(source, side, quality);
  for (let i = 0; i < 6 && base64Of(dataUrl).length > MAX_BASE64_CHARS; i += 1) {
    if (quality > 0.55) quality -= 0.1;
    else side = Math.round(side * 0.8);
    dataUrl = renderJpeg(source, side, quality);
  }
  if (base64Of(dataUrl).length > MAX_BASE64_CHARS) throw new Error('No logré reducir esa imagen lo suficiente. Prueba con otra.');
  const thumb = renderJpeg(source, THUMB_SIDE, 0.7);
  source.close?.();
  return { mimeType: 'image/jpeg', data: base64Of(dataUrl), thumb, name: String(file.name || 'imagen').slice(0, 80) };
}
