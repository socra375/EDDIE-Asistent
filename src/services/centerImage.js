// The picture shown in the empty disc in the middle of Inicio: the last one
// Eddie made (or the one the user picks in the Galería). Only its id is kept,
// in this browser; the picture itself comes from the gallery.
const KEY = 'eddie.centerImage';
export const CENTER_IMAGE_EVENT = 'eddie:center-image';
const UUID = /^[0-9a-f-]{36}$/i;

export function getCenterImage() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    return value && UUID.test(String(value.id || '')) ? { id: value.id, prompt: String(value.prompt || '').slice(0, 200) } : null;
  } catch {
    return null;
  }
}

// `image` = { id, prompt }, or null to clear it.
export function setCenterImage(image) {
  try {
    if (image && UUID.test(String(image.id || ''))) localStorage.setItem(KEY, JSON.stringify({ id: image.id, prompt: String(image.prompt || '').slice(0, 200) }));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage is a convenience: without it the picture just isn't remembered.
  }
  window.dispatchEvent(new CustomEvent(CENTER_IMAGE_EVENT));
}
