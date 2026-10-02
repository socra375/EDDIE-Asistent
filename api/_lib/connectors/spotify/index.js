// Spotify by voice: search, play, pause, skip, volume and "what's playing",
// through the user's own account (linked from Conectores). Spotify only lets
// an app control playback for Premium accounts, and only on a device that is
// open somewhere (the phone app, the desktop app, open.spotify.com in a tab).
// After playing or pausing, the tool reads the player back to check it did
// what was asked (the receipt's "comprobado").
import { clip, fetchJson } from '../http.js';
import { getSpotifyAccessToken, hasSpotify } from '../../spotify/auth.js';

const API = 'https://api.spotify.com/v1';
const TYPES = ['track', 'artist', 'album', 'playlist'];
const MAX_RESULTS = 8;
const VERIFY_DELAY_MS = 700;

class SpotifyError extends Error {}

async function spotifyToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new SpotifyError('Para usar Spotify, inicia sesión con Google y pulsa "Conectar Spotify" en Conectores.');
  try {
    return await getSpotifyAccessToken(user.id);
  } catch (err) {
    throw new SpotifyError(err.message || 'No se pudo acceder a Spotify. Vuelve a pulsar "Conectar Spotify".');
  }
}

const reasonOf = (data) => String(data?.error?.reason || '');

// One call to Spotify; failures become readable SpotifyErrors.
async function spotify(token, path, { method = 'GET', body } = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 8000,
    retries: method === 'GET' ? 1 : 0,
  });
  if (ok) return { status, data };
  if (status === 401) throw new SpotifyError('Spotify rechazó el acceso. Vuelve a pulsar "Conectar Spotify" en Conectores.');
  if (status === 403 && reasonOf(data) === 'PREMIUM_REQUIRED') throw new SpotifyError('Spotify solo deja controlar la reproducción desde otras apps con una cuenta Premium.');
  if (status === 403) throw new SpotifyError('Spotify no dio permiso para esto. Vuelve a pulsar "Conectar Spotify" y acepta los permisos.');
  if (status === 404 && reasonOf(data) === 'NO_ACTIVE_DEVICE') throw Object.assign(new SpotifyError('No hay ningún dispositivo de Spotify abierto. Abre Spotify (en el teléfono, el computador o open.spotify.com) y vuelve a pedírmelo.'), { noDevice: true });
  if (status === 404) throw new SpotifyError('Spotify no encontró eso.');
  if (status === 429) throw new SpotifyError('Spotify está limitando las solicitudes; inténtalo en un momento.');
  throw new SpotifyError(data?.error?.message || 'Spotify no respondió en este momento.');
}

function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof SpotifyError) return { error: err.message };
      throw err;
    }
  };
}

const artistsOf = (artists) => (artists || []).map((a) => a.name).filter(Boolean).join(', ');

// A search result reduced to what the model (and the user) needs.
function describeItem(type, item) {
  const out = { type, name: clip(item.name, 80), uri: item.uri };
  if (type === 'track') {
    out.artist = clip(artistsOf(item.artists), 80);
    out.album = clip(item.album?.name, 60);
  } else if (type === 'album') {
    out.artist = clip(artistsOf(item.artists), 80);
  } else if (type === 'playlist') {
    out.owner = clip(item.owner?.display_name, 40);
  }
  return out;
}

const labelOf = (item) => (item.artist ? `${item.name} — ${item.artist}` : item.name);

async function search(token, query, type, limit) {
  const params = new URLSearchParams({ q: clip(query, 120), type, limit: String(limit), market: 'from_token' });
  const { data } = await spotify(token, `/search?${params}`);
  return (data?.[`${type}s`]?.items || []).filter(Boolean).map((item) => describeItem(type, item));
}

async function searchTool(args, context) {
  const query = clip(args.query, 120);
  if (!query) return { error: 'Dime qué buscar en Spotify.' };
  const type = TYPES.includes(args.type) ? args.type : 'track';
  const limit = Number.isInteger(args.limit) ? Math.min(Math.max(args.limit, 1), MAX_RESULTS) : 5;
  const results = await search(await spotifyToken(context), query, type, limit);
  return { type, results, summary: results.length ? `Encontré ${results.length} en Spotify: ${results.slice(0, 3).map(labelOf).join('; ')}.` : `No encontré "${query}" en Spotify.` };
}

// What the player is doing now, or null when nothing is open.
async function readPlayer(token) {
  const { status, data } = await spotify(token, '/me/player?additional_types=track,episode');
  if (status === 204 || !data) return null;
  const item = data.item;
  return {
    playing: Boolean(data.is_playing),
    track: item ? { name: clip(item.name, 80), artist: clip(artistsOf(item.artists) || item.show?.name, 80), uri: item.uri } : null,
    context: data.context?.uri || null,
    device: data.device ? { id: data.device.id, name: clip(data.device.name, 40), volume: data.device.volume_percent } : null,
    shuffle: Boolean(data.shuffle_state),
  };
}

async function nowPlaying(_args, context) {
  const player = await readPlayer(await spotifyToken(context));
  if (!player?.track) return { playing: false, summary: 'No hay nada sonando en Spotify ahora mismo.' };
  const label = labelOf({ name: player.track.name, artist: player.track.artist });
  return { ...player, summary: `${player.playing ? 'Suena' : 'En pausa'}: ${label}${player.device ? ` en ${player.device.name}` : ''}.` };
}

// After a command, look at the player once more to check it took effect.
// true = confirmed, false = it didn't, null = couldn't check.
async function verify(token, isRight) {
  await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
  try {
    return Boolean(isRight(await readPlayer(token)));
  } catch {
    return null;
  }
}

// Plays on the active device; if none is active but the account has a device
// open somewhere (a tab, the phone), starts it there instead.
async function startPlayback(token, body) {
  try {
    await spotify(token, '/me/player/play', { method: 'PUT', body });
    return null;
  } catch (err) {
    if (!err.noDevice) throw err;
  }
  const { data } = await spotify(token, '/me/player/devices');
  const device = (data?.devices || []).find((d) => !d.is_restricted);
  if (!device) throw new SpotifyError('No hay ningún dispositivo de Spotify abierto. Abre Spotify (en el teléfono, el computador o open.spotify.com) y vuelve a pedírmelo.');
  await spotify(token, `/me/player/play?device_id=${encodeURIComponent(device.id)}`, { method: 'PUT', body });
  return device.name;
}

async function play(args, context) {
  const token = await spotifyToken(context);
  const query = clip(args.query, 120);
  const uri = typeof args.uri === 'string' && /^spotify:(track|album|artist|playlist):[A-Za-z0-9]+$/.test(args.uri) ? args.uri : '';
  const type = TYPES.includes(args.type) ? args.type : 'track';

  // Nothing to search: resume what was playing.
  if (!query && !uri) {
    const device = await startPlayback(token, undefined);
    const verified = await verify(token, (p) => p?.playing);
    return { playing: 'lo que estaba sonando', device: device || undefined, verified, summary: `Reanudé Spotify${device ? ` en ${device}` : ''}.` };
  }

  let target = { uri, name: uri, type: uri.split(':')[1] || type };
  if (!uri) {
    const [found] = await search(token, query, type, 1);
    if (!found) return { error: `No encontré "${query}" en Spotify.` };
    target = found;
  }
  // A single track plays on its own; an album, artist or playlist plays as a context.
  const body = target.type === 'track' ? { uris: [target.uri] } : { context_uri: target.uri };
  const device = await startPlayback(token, body);
  const verified = await verify(token, (p) => p?.playing && (target.type === 'track' ? p.track?.uri === target.uri : p.context === target.uri || p.track));
  const label = target.name ? labelOf(target) : 'eso';
  return { playing: label, type: target.type, device: device || undefined, verified, summary: `Pongo ${label}${device ? ` en ${device}` : ''}.` };
}

const SIMPLE = {
  pause: { path: '/me/player/pause', method: 'PUT', done: 'Pausé la música.', check: (p) => p && !p.playing },
  resume: { path: '/me/player/play', method: 'PUT', done: 'Reanudé la música.', check: (p) => p?.playing },
  next: { path: '/me/player/next', method: 'POST', done: 'Pasé a la siguiente canción.' },
  previous: { path: '/me/player/previous', method: 'POST', done: 'Volví a la canción anterior.' },
};

async function control(args, context) {
  const action = String(args.action || '');
  const token = await spotifyToken(context);

  if (action === 'volume') {
    if (!Number.isFinite(args.volume)) return { error: 'Dime el volumen, de 0 a 100.' };
    const volume = Math.min(100, Math.max(0, Math.round(args.volume)));
    await spotify(token, `/me/player/volume?volume_percent=${volume}`, { method: 'PUT' });
    const verified = await verify(token, (p) => p?.device && Math.abs(p.device.volume - volume) <= 1);
    return { action, volume, verified, summary: `Puse el volumen en ${volume}.` };
  }
  if (action === 'shuffle') {
    if (typeof args.shuffle !== 'boolean') return { error: 'Dime si el modo aleatorio va activado o desactivado.' };
    const on = args.shuffle;
    await spotify(token, `/me/player/shuffle?state=${on}`, { method: 'PUT' });
    return { action, shuffle: on, summary: on ? 'Activé el modo aleatorio.' : 'Desactivé el modo aleatorio.' };
  }
  const simple = SIMPLE[action];
  if (!simple) return { error: 'La acción debe ser pause, resume, next, previous, volume o shuffle.' };
  await spotify(token, simple.path, { method: simple.method });
  const verified = simple.check ? await verify(token, simple.check) : undefined;
  return { action, ...(verified === undefined ? {} : { verified }), summary: simple.done };
}

export default {
  id: 'spotify',
  name: 'Spotify',
  description: 'Busca y pon música, pausa, pasa de canción, cambia el volumen y dime qué suena, por voz, en tu cuenta de Spotify.',
  icon: 'music',
  category: 'multimedia',
  // Offered to the model only when the conversation touches the topic.
  route: /spotify|m[uú]sica|can[ct]i[oó]n|canciones|[aá]lbum|artista|playlist|lista de reproducci[oó]n|reproduc|escuchar|pon (algo|la|el|una|unas|m[uú]sica)|pausa|sigue|siguiente|anterior|volumen|sube|baja|aleatorio|suena|qu[eé] es esto/i,
  auth: {
    type: 'oauth-link',
    connectUrl: '/api/connectors/spotify/connect',
    isConnected: (user) => hasSpotify(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Spotify solo deja controlar la reproducción a las cuentas Premium, y necesita Spotify abierto en algún dispositivo (el teléfono, el computador o open.spotify.com en una pestaña). Eddie nunca toca tus listas ni tu biblioteca.',
  tools: [
    {
      label: 'Buscar música en Spotify',
      activity: 'Buscando en Spotify…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'spotify_search',
        description: 'Busca canciones, artistas, álbumes o playlists en Spotify. Úsalo cuando pidan buscar o elegir entre opciones; para ponerlo directamente usa spotify_play.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Qué buscar (título, artista…).' },
            type: { type: 'STRING', enum: TYPES, description: 'track (por defecto), artist, album o playlist.' },
            limit: { type: 'INTEGER', description: 'Cuántos resultados (1 a 8, por defecto 5).' },
          },
          required: ['query'],
        },
      },
      run: guarded(searchTool),
    },
    {
      label: 'Poner música en Spotify',
      activity: 'Poniendo música…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'spotify_play',
        description: 'Reproduce en Spotify lo que el usuario pida ("pon Bad Bunny", "pon el álbum Abbey Road", "pon mi playlist de estudio"). Busca el primer resultado y lo reproduce; sin query ni uri reanuda lo que sonaba. Para una canción concreta usa type track; para "música de X" usa type artist.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Qué poner (título, artista, álbum o playlist).' },
            type: { type: 'STRING', enum: TYPES, description: 'track (por defecto), artist, album o playlist.' },
            uri: { type: 'STRING', description: 'Un URI spotify:… devuelto antes por spotify_search, para reproducir ese resultado exacto.' },
          },
        },
      },
      run: guarded(play),
    },
    {
      label: 'Pausar, pasar de canción o cambiar el volumen',
      activity: 'Controlando Spotify…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'spotify_control',
        description: 'Controla la reproducción de Spotify: pause, resume, next (siguiente), previous (anterior), volume (con volume de 0 a 100) o shuffle (con shuffle true o false).',
        parameters: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['pause', 'resume', 'next', 'previous', 'volume', 'shuffle'], description: 'Qué hacer.' },
            volume: { type: 'INTEGER', description: 'Solo con action=volume: el volumen de 0 a 100.' },
            shuffle: { type: 'BOOLEAN', description: 'Solo con action=shuffle: true para activar el modo aleatorio, false para desactivarlo.' },
          },
          required: ['action'],
        },
      },
      run: guarded(control),
    },
    {
      label: 'Ver qué suena en Spotify',
      activity: 'Mirando qué suena…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'spotify_now_playing',
        description: 'Dice qué canción suena ahora en Spotify, en qué dispositivo y si está en pausa ("¿qué suena?", "¿qué canción es esta?").',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: guarded(nowPlaying),
    },
  ],
  webhook: null,
};
