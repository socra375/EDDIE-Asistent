// Asks the user's browser to open a page. Two doors, used together:
//   - the page queue: the extension (if the user linked one) comes for it
//     within half a minute, whichever device the request came from;
//   - the `browser_open` action: Eddie's own page, if open, hands it to the
//     extension at once (or opens the tab itself) and Telegram sends a button.
// When both reach the extension, the command's id makes it open the page once.
import { enqueue, linkByUser } from './store.js';
import { safeHttpsUrl } from './urls.js';

export const EXTENSION_VERSION = '1.1.0';

async function linkOf(context) {
  try {
    const user = await context.getUser?.();
    return user ? await linkByUser(user.id) : null;
  } catch {
    return null;
  }
}

// → { delivery: 'extension' | 'page', url } | { error }
export async function requestOpen(context, { url, label }) {
  const safe = safeHttpsUrl(url);
  if (!safe) return { error: 'Solo abro direcciones https públicas.' };
  const link = await linkOf(context);
  const name = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  let id = null;
  if (link) {
    try {
      id = await enqueue((await context.getUser()).id, { url: safe, label: name });
    } catch {
      id = null;
    }
  }
  context.emit?.({ type: 'browser_open', url: safe, label: name, ...(id ? { id } : {}) });
  return { delivery: id ? 'extension' : 'page', url: safe };
}

// What Eddie just made (a document, a sheet, a presentation) opens in a tab
// when the user linked their browser and left that on. Only for requests made
// in Eddie's app: asking from the phone shouldn't open tabs on the computer.
export async function openCreated(context, { url, label }) {
  if (context.channel === 'telegram') return null;
  const link = await linkOf(context);
  if (!link?.prefs.openCreated) return null;
  const opened = await requestOpen(context, { url, label });
  return opened.error ? null : opened.delivery;
}
