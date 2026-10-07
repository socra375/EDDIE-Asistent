import { getCenterImage, setCenterImage } from './centerImage';

const UUID = /^[0-9a-f-]{36}$/i;

// Carries out the picture actions Eddie's tools emit (see api/_lib/connectors/media):
// `show_image` puts a picture Eddie MADE in the middle of Inicio (one he FOUND on the
// internet only goes under the reply, with its credit), `media_deleted` clears it from
// there if it was that one. Returns the pictures to show under the reply, as
// [{ id, prompt, found?, credit?, license?, sourceUrl? }].
export function applyMediaActions(actions) {
  const shown = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type === 'show_image' && UUID.test(String(action.id || ''))) {
      const picture = { id: action.id, prompt: String(action.prompt || '').slice(0, 200) };
      if (action.found === true) {
        picture.found = true;
        picture.credit = String(action.credit || '').slice(0, 120);
        picture.license = String(action.license || '').slice(0, 80);
        // Only a plain web address may become a link.
        picture.sourceUrl = /^https?:\/\//i.test(String(action.sourceUrl || '')) ? String(action.sourceUrl).slice(0, 500) : '';
      }
      if (!shown.some((p) => p.id === picture.id)) shown.push(picture);
    } else if (action?.type === 'media_deleted' && UUID.test(String(action.id || '')) && getCenterImage()?.id === action.id) {
      setCenterImage(null);
    }
  }
  const made = shown.filter((p) => !p.found);
  if (made.length) setCenterImage(made.at(-1));
  return shown;
}
