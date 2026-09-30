// YouTube for Eddie. `open_youtube` opens the home page, the results of a
// search, or a YouTube link the user gave; with `play` it finds the first
// video for what was asked and plays it inside Eddie (a player the app shows,
// so no pop-up is needed), falling back to the results page when no video can
// be picked. `control_video` pauses, resumes or closes that player.
//
// Nothing here writes data: the tools emit actions (`open_url`, `play_video`,
// `player_control`) that the app carries out in the browser (see
// browserActions.js), or that the Telegram bot sends as a link. Only YouTube
// addresses are ever built or accepted, so the model can't be talked into
// opening anything else.
import { fetchJson, fetchText } from '../http.js';

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const MAX_QUERY = 200;

// A clean https YouTube address, or null. Credentials, fragments and other
// hosts (youtube.com.evil.com, javascript:, data:…) are refused.
export function safeYoutubeUrl(value) {
  let u;
  try {
    u = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!HOSTS.has(u.hostname.toLowerCase())) return null;
  u.protocol = 'https:';
  u.username = '';
  u.password = '';
  u.port = '';
  u.hash = '';
  return u.toString();
}

export function searchUrl(query) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export const watchUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

// The video id in a YouTube address (watch?v=, youtu.be/, shorts/, embed/, live/).
export function videoIdFromUrl(value) {
  const safe = safeYoutubeUrl(value);
  if (!safe) return null;
  const u = new URL(safe);
  let id = u.searchParams.get('v');
  if (!id) {
    const m = u.hostname === 'youtu.be' ? /^\/([^/]+)/.exec(u.pathname) : /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(u.pathname);
    id = m ? m[1] : null;
  }
  return id && VIDEO_ID_RE.test(id) ? id : null;
}

const decodeEntities = (t) =>
  String(t || '')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

// First video for a search through YouTube's Data API (YOUTUBE_API_KEY): the
// official way, limited to videos that may be played inside another site.
async function searchWithApi(query, key) {
  const params = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: '1', safeSearch: 'moderate', q: query, key });
  const { ok, status, data } = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${params}`, { timeoutMs: 8000 });
  if (ok) {
    const item = data?.items?.[0];
    if (item?.id?.videoId && VIDEO_ID_RE.test(item.id.videoId)) {
      return { video: { videoId: item.id.videoId, title: decodeEntities(item.snippet?.title), channel: decodeEntities(item.snippet?.channelTitle), source: 'api' } };
    }
    return { video: null, reason: 'no encontré videos para eso' };
  }
  const reason = data?.error?.errors?.[0]?.reason || '';
  if (status === 403 && /quota/i.test(reason)) return { video: null, reason: 'se acabó la cuota diaria de la API de YouTube' };
  if (status === 400 || status === 403) return { video: null, reason: 'la clave YOUTUBE_API_KEY no es válida o no tiene activada la API de YouTube' };
  return { video: null, reason: 'YouTube no respondió' };
}

// Without a key: reads the first video out of YouTube's results page. This is
// not an official API and YouTube can change the page, so any surprise just
// means "no video" and the caller opens the results list instead.
async function searchByPage(query) {
  const { ok, text } = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D`, {
    headers: { 'Accept-Language': 'es-ES,es;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
    timeoutMs: 9000,
  });
  if (!ok || !text) return { video: null, reason: 'YouTube no respondió' };
  const m = /"videoRenderer":\{"videoId":"([A-Za-z0-9_-]{11})"/.exec(text);
  if (!m) return { video: null, reason: 'no pude leer los resultados de YouTube' };
  const near = text.slice(m.index, m.index + 4000);
  const read = (re) => {
    const r = re.exec(near);
    if (!r) return '';
    try {
      return decodeEntities(JSON.parse(`"${r[1]}"`));
    } catch {
      return '';
    }
  };
  return { video: { videoId: m[1], title: read(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/), channel: read(/"ownerText":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/), source: 'page' } };
}

// { video, reason }: the first video for `query`, or why there is none. The
// official API is tried first when a key is set, then the results page.
export async function resolveVideo(query, env = process.env) {
  let why = '';
  if (env.YOUTUBE_API_KEY) {
    const r = await searchWithApi(query, env.YOUTUBE_API_KEY);
    if (r.video) return r;
    why = r.reason;
  }
  const r = await searchByPage(query);
  return r.video ? r : { video: null, reason: why || r.reason };
}

function playVideo(video, context) {
  const url = watchUrl(video.videoId);
  context.emit?.({ type: 'play_video', videoId: video.videoId, title: video.title, channel: video.channel, url });
  const label = `"${video.title || 'el video'}"${video.channel ? ` de ${video.channel}` : ''}`;
  return {
    playing: true,
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    url,
    summary: `Reproduciendo ${label}.`,
    note: 'Se reproduce en un reproductor dentro de Eddie. Dile qué puso; puedes pausarlo, reanudarlo o cerrarlo con control_video si te lo pide.',
  };
}

async function openYoutube(args, context) {
  const link = String(args.url || '').trim();
  if (link) {
    const url = safeYoutubeUrl(link);
    if (!url) return { error: 'Solo puedo abrir direcciones de YouTube (youtube.com, music.youtube.com o youtu.be).' };
    const id = args.play ? videoIdFromUrl(url) : null;
    if (id) return playVideo({ videoId: id, title: '', channel: '' }, context);
    context.emit?.({ type: 'open_url', url, label: 'YouTube' });
    return { opened: true, url, summary: 'Abrí el enlace de YouTube.' };
  }
  // eslint-disable-next-line no-control-regex
  const query = String(args.query || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
  if (!query) {
    context.emit?.({ type: 'open_url', url: 'https://www.youtube.com/', label: 'YouTube' });
    return { opened: true, url: 'https://www.youtube.com/', summary: 'Abrí YouTube.' };
  }
  let missed = '';
  if (args.play) {
    const { video, reason } = await resolveVideo(query);
    if (video) return playVideo(video, context);
    missed = reason;
  }
  const url = searchUrl(query);
  context.emit?.({ type: 'open_url', url, label: `YouTube: ${query}` });
  return {
    opened: true,
    url,
    summary: `Abrí YouTube con la búsqueda "${query}".`,
    note: missed
      ? `No pude elegir un video (${missed}), así que abrí la lista de resultados: dile que lo elija él. Si su navegador bloquea la ventana, verá un botón para abrirla.`
      : 'Se abre la lista de resultados para que el usuario elija el video (para que lo reproduzcas tú, usa play=true). Si su navegador bloquea la ventana, verá un botón para abrirla.',
  };
}

const CONTROLS = { pause: 'Pausé el video.', resume: 'Reanudé el video.', close: 'Cerré el reproductor.' };

function controlVideo(args, context) {
  const action = String(args.action || '');
  if (!CONTROLS[action]) return { error: 'La acción debe ser pause, resume o close.' };
  context.emit?.({ type: 'player_control', action });
  return { done: true, action, summary: CONTROLS[action] };
}

export default {
  id: 'youtube',
  name: 'YouTube',
  description: 'Eddie abre YouTube o busca ahí lo que le digas, y reproduce el video que le pidas ("ponme música de…") en un reproductor dentro de Eddie, que puede pausar o cerrar.',
  icon: 'play',
  category: 'multimedia',
  // Offered to the model only when the conversation touches the topic.
  route: /youtube|you tube|\byt\b|v[ií]deos?|canci[oó]n|canciones|m[uú]sica|tutorial|tr[aá]iler|trailer|videoclip|reproduc|escuchar/i,
  auth: null,
  requiredEnv: [],
  note: 'Al pedirle que ponga algo, lo reproduce en un reproductor dentro de Eddie. Funciona mejor con YOUTUBE_API_KEY en Vercel (API de YouTube, gratis); sin ella lee la página de resultados y puede fallar. Abrir YouTube o una búsqueda usa una pestaña nueva.',
  tools: [
    {
      label: 'Abrir YouTube o buscar en él',
      activity: 'Abriendo YouTube…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'open_youtube',
        description:
          'Abre YouTube en el navegador del usuario (sin argumentos: la portada), busca algo (query) u abre un enlace de YouTube (url). Con play=true elige el primer video de la búsqueda y lo reproduce dentro de Eddie: úsalo cuando pida poner, reproducir o escuchar una canción, video o tutorial concreto. Sin play abre la lista de resultados (buscar, ver opciones).',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Qué buscar en YouTube, en pocas palabras (p. ej. "canciones de salsa", "tutorial de React").' },
            url: { type: 'STRING', description: 'Un enlace de youtube.com, music.youtube.com o youtu.be que el usuario dio, para abrirlo tal cual.' },
            play: { type: 'BOOLEAN', description: 'true para reproducir el primer resultado dentro de Eddie (poner, reproducir, escuchar).' },
          },
        },
      },
      run: (args, context) => openYoutube(args, context),
    },
    {
      label: 'Pausar, reanudar o cerrar el video',
      activity: 'Controlando el video…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'control_video',
        description: 'Pausa, reanuda o cierra el reproductor de video que Eddie tiene abierto ("pausa el video", "sigue", "cierra el video").',
        parameters: {
          type: 'OBJECT',
          properties: { action: { type: 'STRING', enum: ['pause', 'resume', 'close'], description: 'pause, resume o close.' } },
          required: ['action'],
        },
      },
      run: (args, context) => controlVideo(args, context),
    },
  ],
  webhook: null,
};
