// Platform-agnostic auth logic: each function takes plain inputs (cookies,
// query, body) and returns a plain result descriptor ({ status, json,
// redirect, setCookie }). The Vercel functions in api/auth/** and the
// Express routes in server/dev-server.js are thin adapters over these.
import { randomUUID } from 'node:crypto';
import { getDb } from './db.js';
import { buildAuthorizeUrl, exchangeCodeForTokens, fetchGoogleUserInfo } from './google.js';
import { saveCredentials } from './googleCredentials.js';
import { createSession, destroySession, getSessionUser, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from './session.js';
import { serializeCookie, clearCookie } from './cookies.js';

const STATE_COOKIE_NAME = 'eddie_oauth_state';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export function startGoogleLogin() {
  const state = randomUUID();
  return {
    status: 302,
    redirect: buildAuthorizeUrl(state),
    setCookie: [serializeCookie(STATE_COOKIE_NAME, state, { maxAge: 600 })],
  };
}

export async function handleGoogleCallback(cookies, query) {
  if (query.error) {
    return { status: 302, redirect: `${APP_URL}/?google_error=${encodeURIComponent(query.error)}` };
  }

  const expectedState = cookies[STATE_COOKIE_NAME];
  if (!expectedState || expectedState !== query.state) {
    const err = new Error('Estado de autenticación inválido (posible CSRF). Intenta iniciar sesión de nuevo.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const tokens = await exchangeCodeForTokens(query.code);
  const profile = await fetchGoogleUserInfo(tokens.access_token);

  const sql = getDb();
  const rows = await sql`
    insert into users (google_sub, email, name, avatar_url)
    values (${profile.sub}, ${profile.email || null}, ${profile.name || null}, ${profile.picture || null})
    on conflict (google_sub) do update set
      email = excluded.email,
      name = excluded.name,
      avatar_url = excluded.avatar_url
    returning id
  `;
  const userId = rows[0].id;

  await saveCredentials(userId, tokens);
  const sessionId = await createSession(userId);

  return {
    status: 302,
    redirect: `${APP_URL}/`,
    setCookie: [serializeCookie(SESSION_COOKIE_NAME, sessionId, { maxAge: SESSION_MAX_AGE }), clearCookie(STATE_COOKIE_NAME)],
  };
}

export async function logout(cookies) {
  await destroySession(cookies[SESSION_COOKIE_NAME]);
  return { status: 200, json: { ok: true }, setCookie: [clearCookie(SESSION_COOKIE_NAME)] };
}

export async function me(cookies) {
  const user = await getSessionUser(cookies[SESSION_COOKIE_NAME]);
  return { status: 200, json: { user } };
}

export async function deleteAccount(cookies) {
  const user = await getSessionUser(cookies[SESSION_COOKIE_NAME]);
  if (!user) {
    const err = new Error('Debes iniciar sesión para hacer esto.');
    err.code = 'UNAUTHORIZED';
    throw err;
  }
  const sql = getDb();
  await sql`delete from users where id = ${user.id}`; // cascades sessions/credentials/tasks/settings/memory
  return { status: 200, json: { ok: true }, setCookie: [clearCookie(SESSION_COOKIE_NAME)] };
}
