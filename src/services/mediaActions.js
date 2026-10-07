import { getCenterImage, setCenterImage } from './centerImage';

const UUID = /^[0-9a-f-]{36}$/i;

// Carries out the picture actions Eddie's tools emit (see api/_lib/connectors/media):
// `show_image` puts the picture in the middle of Inicio, `media_deleted` clears it
// from there if it was that one. Returns the pictures to show under the reply,
// as [{ id, prompt }].
export function applyMediaActions(actions) {
  const shown = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type === 'show_image' && UUID.test(String(action.id || ''))) {
      const picture = { id: action.id, prompt: String(action.prompt || '').slice(0, 200) };
      if (!shown.some((p) => p.id === picture.id)) shown.push(picture);
    } else if (action?.type === 'media_deleted' && UUID.test(String(action.id || '')) && getCenterImage()?.id === action.id) {
      setCenterImage(null);
    }
  }
  if (shown.length) setCenterImage(shown.at(-1));
  return shown;
}
