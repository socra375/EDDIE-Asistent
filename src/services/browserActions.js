// Carries out the browser actions Eddie's tools emit (see the youtube
// connector): `open_url` (a new tab), `play_video` (the player inside Eddie,
// src/player/YouTubePlayer.jsx) and `player_control` (pause / resume / close
// it). Only YouTube is ever opened or played, re-checked here even though the
// server already builds those addresses (the same list as
// api/_lib/connectors/youtube) — a defence in depth, not a second source of truth.
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

// Returns the links Eddie opened, as [{ url, label, opened, played? }], for
// the chat to show. A browser only lets a page open a window from a click (a
// spoken request or a slow answer doesn't count) unless the user allowed
// pop-ups for the site, so `opened: false` means blocked: the chat shows it
// as a button and the click opens it. Videos played inside Eddie need no
// window, so they never hit that.
export function applyBrowserActions(actions) {
  const links = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    if (action?.type === 'open_url') {
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
    } else if (action?.type === 'play_video' && VIDEO_ID_RE.test(String(action.videoId || ''))) {
      const url = `https://www.youtube.com/watch?v=${action.videoId}`;
      if (links.some((l) => l.url === url)) continue;
      const video = { videoId: action.videoId, title: String(action.title || '').slice(0, 160), channel: String(action.channel || '').slice(0, 120) };
      window.dispatchEvent(new CustomEvent(PLAY_VIDEO_EVENT, { detail: video }));
      links.push({ url, label: video.title || 'el video', opened: true, played: true });
    } else if (action?.type === 'player_control' && CONTROLS.has(action.action)) {
      window.dispatchEvent(new CustomEvent(PLAYER_CONTROL_EVENT, { detail: { action: action.action } }));
    }
  }
  return links;
}
