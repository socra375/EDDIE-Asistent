// Spotify's OAuth (authorization code flow, the client secret stays on the
// server) and the user's stored tokens. Eddie only ever asks to read and
// control playback — no playlists, no library, no account details.
//
//   GET  /api/connectors/spotify/connect     sends the signed-in user to Spotify
//   GET  /api/connectors/spotify/callback    Spotify sends them back with a code
//   POST /api/connectors/spotify/disconnect  forgets the tokens
//
// The Spotify app's redirect URI must be APP_URL/api/connectors/spotify/callback
// (or SPOTIFY_REDIRECT_URI).
import { randomUUID } from 'node:crypto';
import { getDb } from '../db.js';
import { clearCookie, serializeCookie } from '../cookies.js';
import { hasTokenSecret, openToken, sealToken } from '../secretBox.js';
import { getSessionUser, SESSION_COOKIE_NAME } from '../session.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const STATE_COOKIE = 'eddie_spotify_state';
export const SPOTIFY_SCOPES = ['user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing'];

const appUrl = (env) => env.APP_URL || 'http://localhost:5173';
export const redirectUri = (env = process.env) => env.SPOTIFY_REDIRECT_URI || `${appUrl(env)}/api/connectors/spotify/callback`;

function spotifyError(message, code = 'PROVIDER_ERROR') {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function buildAuthorizeUrl(state, env = process.env) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SPOTIFY_SCOPES.join(' '),
    redirect_uri: redirectUri(env),
    state,
  });
  return `${AUTH_URL}?${params}`;
}

async function tokenRequest(params, env) {
  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw spotifyError('No se pudo contactar a Spotify.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) {
    throw spotifyError(data?.error === 'invalid_grant' ? 'Spotify rechazó el acceso guardado. Vuelve a pulsar "Conectar Spotify".' : data?.error_description || 'Spotify rechazó la solicitud.', data?.error === 'invalid_grant' ? 'SPOTIFY_NOT_CONNECTED' : 'PROVIDER_ERROR');
  }
  return data;
}

export const exchangeCode = (code, env = process.env) => tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(env) }, env);
const refreshTokens = (refreshToken, env = process.env) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, env);

export async function saveSpotifyCredentials(userId, tokens) {
  const sql = getDb();
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await sql`
    insert into spotify_credentials (user_id, access_token, refresh_token, expires_at, scope, updated_at)
    values (${userId}, ${sealToken(tokens.access_token)}, ${sealToken(tokens.refresh_token) || null}, ${expiresAt}, ${tokens.scope || null}, now())
    on conflict (user_id) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, spotify_credentials.refresh_token),
      expires_at = excluded.expires_at,
      scope = coalesce(excluded.scope, spotify_credentials.scope),
      updated_at = now()
  `;
}

export async function hasSpotify(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from spotify_credentials where user_id = ${userId}`;
  return rows.length > 0;
}

export async function removeSpotifyCredentials(userId) {
  const sql = getDb();
  await sql`delete from spotify_credentials where user_id = ${userId}`;
}

// A currently valid access token, refreshed when it is about to expire.
export async function getSpotifyAccessToken(userId, env = process.env) {
  const sql = getDb();
  const rows = await sql`select * from spotify_credentials where user_id = ${userId}`;
  const credentials = rows[0];
  if (!credentials) throw spotifyError('Spotify no está conectado: pulsa "Conectar Spotify" en el módulo Conectores.', 'SPOTIFY_NOT_CONNECTED');
  if (new Date(credentials.expires_at).getTime() - Date.now() > 60_000) return openToken(credentials.access_token);
  if (!credentials.refresh_token) throw spotifyError('Se venció el acceso a Spotify. Vuelve a pulsar "Conectar Spotify".', 'SPOTIFY_NOT_CONNECTED');
  const tokens = await refreshTokens(openToken(credentials.refresh_token), env);
  await saveSpotifyCredentials(userId, tokens);
  return tokens.access_token;
}

async function sessionUser(cookies) {
  if (!cookies[SESSION_COOKIE_NAME]) return null;
  try {
    return await getSessionUser(cookies[SESSION_COOKIE_NAME]);
  } catch {
    return null;
  }
}

const back = (env, query) => ({ status: 302, redirect: `${appUrl(env)}/?${query}`, setCookie: [clearCookie(STATE_COOKIE)] });

export async function handleSpotifyRoute({ method, path, cookies = {}, query = {}, env = process.env }) {
  const action = path[1];
  const configured = env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.DATABASE_URL && hasTokenSecret(env);

  if (action === 'connect' && method === 'GET') {
    if (!configured) return back(env, 'connect=spotify&connect_error=missing_setup');
    const user = await sessionUser(cookies);
    if (!user) return back(env, 'connect=spotify&connect_error=login_required');
    const state = randomUUID();
    return { status: 302, redirect: buildAuthorizeUrl(state, env), setCookie: [serializeCookie(STATE_COOKIE, state, { maxAge: 600 })] };
  }

  if (action === 'callback' && method === 'GET') {
    if (query.error) return back(env, `connect=spotify&connect_error=${encodeURIComponent(String(query.error).slice(0, 40))}`);
    const expected = cookies[STATE_COOKIE];
    if (!configured || !expected || expected !== query.state || typeof query.code !== 'string') return back(env, 'connect=spotify&connect_error=bad_state');
    const user = await sessionUser(cookies);
    if (!user) return back(env, 'connect=spotify&connect_error=login_required');
    try {
      await saveSpotifyCredentials(user.id, await exchangeCode(query.code, env));
    } catch {
      return back(env, 'connect=spotify&connect_error=exchange_failed');
    }
    return back(env, 'connected=spotify');
  }

  if (action === 'disconnect' && method === 'POST') {
    const user = await sessionUser(cookies);
    if (!user) return { status: 401, json: { error: 'Inicia sesión para desconectar Spotify.' } };
    await removeSpotifyCredentials(user.id);
    return { status: 200, json: { ok: true } };
  }

  return { status: 404, json: { error: 'Esta acción de Spotify no existe.' } };
}
