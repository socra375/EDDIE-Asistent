// Carries out the browser actions Eddie's tools emit: `open_url` (a YouTube
// page, see the youtube connector), `browser_open` (a page the user's
// browser should open: their meeting, a document Eddie made, a site they
// asked for — see the browser connector), `play_video` (the player inside
// Eddie, src/player/YouTubePlayer.jsx) and `player_control` (pause / resume /
// close it). Addresses are re-checked here even though the server already
// built them — a defence in depth, not a second source of truth: YouTube only
// for `open_url`, public https pages for `browser_open`.
import { openableUrl } from '../../extension/urls.js';
import { bridgeState, openViaExtension } from './browserBridge.js';
import { REMOTE_VIEW_EVENT } from './remoteShare.js';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const CONTROLS = new Set(['pause', 'resume', 'close']);

// Fired for the player component (kept apart from React so any surface can use it).
export const PLAY_VIDEO_EVENT = 'eddie:play-video';
export const PLAYER_CONTROL_EVENT = 'eddie:player-control';

function safeUrl(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname.toLowerCase())) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Opens a page in a new tab. With the "Eddie en tu navegador" extension it
// opens at once and nothing can block it; without it the browser only lets a
// page open a window from a click (a spoken request or a slow answer doesn't
// count) unless the user allowed pop-ups for the site. → whether it opened.
function openTab(url, id) {
  if (bridgeState().installed) {
    openViaExtension(url, id);
    return true;
  }
  try {
    const tab = window.open(url, '_blank');
    if (tab) {
      tab.opener = null;
      return true;
    }
  } catch {
    // fall through: blocked
  }
  return false;
}

const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');

// Returns the links Eddie opened, as [{ url, label, opened, played? }], for
// the chat to show. `opened: false` means the browser blocked the window: the
// chat shows it as a button and the click opens it. Videos played inside
// Eddie, and everything opened through the extension, never hit that.
export function applyBrowserActions(actions) {
  const links = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type === 'open_url') {
      const url = safeUrl(action.url);
      if (!url || links.some((l) => l.url === url)) continue;
      links.push({ url, label: String(action.label || 'YouTube').slice(0, 120), opened: openTab(url) });
    } else if (action?.type === 'browser_open') {
      const url = openableUrl(action.url);
      if (!url || links.some((l) => l.url === url)) continue;
      const id = /^[0-9a-f-]{36}$/i.test(String(action.id || '')) ? action.id : undefined;
      links.push({ url, label: String(action.label || hostOf(url)).slice(0, 120), opened: openTab(url, id) });
    } else if (action?.type === 'play_video' && VIDEO_ID_RE.test(String(action.videoId || ''))) {
      const url = `https://www.youtube.com/watch?v=${action.videoId}`;
      if (links.some((l) => l.url === url)) continue;
      const video = { videoId: action.videoId, title: String(action.title || '').slice(0, 160), channel: String(action.channel || '').slice(0, 120) };
      window.dispatchEvent(new CustomEvent(PLAY_VIDEO_EVENT, { detail: video }));
      links.push({ url, label: video.title || 'el video', opened: true, played: true });
    } else if (action?.type === 'open_remote_view' && /^[0-9a-f-]{36}$/i.test(String(action.deviceId || ''))) {
      window.dispatchEvent(new CustomEvent(REMOTE_VIEW_EVENT, { detail: { deviceId: action.deviceId, name: String(action.name || '').slice(0, 40), attach: action.attach === true } }));
    } else if (action?.type === 'close_remote_view' && /^[0-9a-f-]{36}$/i.test(String(action.deviceId || ''))) {
      window.dispatchEvent(new CustomEvent(REMOTE_VIEW_EVENT, { detail: { deviceId: action.deviceId, close: true } }));
    } else if (action?.type === 'player_control' && CONTROLS.has(action.action)) {
      window.dispatchEvent(new CustomEvent(PLAYER_CONTROL_EVENT, { detail: { action: action.action } }));
    }
  }
  return links;
}
