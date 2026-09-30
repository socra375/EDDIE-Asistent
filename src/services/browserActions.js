// Carries out the `open_url` actions Eddie's tools emit (open_youtube): a new
// browser tab. Only YouTube addresses are ever opened, re-checked here even
// though the server already builds them (the same list as
// api/_lib/connectors/youtube) — a defence in depth, not a second source of truth.
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

function safeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Tries to open each link in a new tab and returns them all as
// [{ url, label, opened }]. A browser only lets a page open a window from a
// click (a spoken request or a slow answer doesn't count) unless the user
// allowed pop-ups for the site, so `opened: false` means blocked: the chat
// shows those as a button, and the click opens it.
export function applyBrowserActions(actions) {
  const links = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type !== 'open_url') continue;
    const url = safeUrl(action.url);
    if (!url || links.some((l) => l.url === url)) continue;
    let opened = false;
    try {
      const tab = window.open(url, '_blank');
      if (tab) {
        opened = true;
        tab.opener = null;
      }
    } catch {
      opened = false;
    }
    links.push({ url, label: String(action.label || 'YouTube').slice(0, 120), opened });
  }
  return links;
}
