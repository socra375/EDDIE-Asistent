// Persists and refreshes each user's Google OAuth tokens. Only ever
// called from the backend — the tokens themselves never reach the browser.
import { getDb } from './db.js';
import { refreshAccessToken } from './google.js';

export async function saveCredentials(userId, tokens) {
  const sql = getDb();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await sql`
    insert into google_credentials (user_id, access_token, refresh_token, expires_at, scope, updated_at)
    values (${userId}, ${tokens.access_token}, ${tokens.refresh_token || null}, ${expiresAt}, ${tokens.scope}, now())
    on conflict (user_id) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, google_credentials.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = now()
  `;
}

// Returns a currently-valid access token, transparently refreshing it if
// it's expired (or about to expire) and a refresh token is on file.
export async function getValidAccessToken(userId) {
  const sql = getDb();
  const rows = await sql`select * from google_credentials where user_id = ${userId}`;
  const credentials = rows[0];

  if (!credentials) {
    const err = new Error('No hay una conexión con Google activa. Vuelve a iniciar sesión con Google.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const expiresSoon = new Date(credentials.expires_at).getTime() - Date.now() < 60_000;
  if (!expiresSoon) return credentials.access_token;

  if (!credentials.refresh_token) {
    const err = new Error('El acceso a Google expiró y no se puede renovar automáticamente. Vuelve a iniciar sesión.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const refreshed = await refreshAccessToken(credentials.refresh_token);
  await saveCredentials(userId, { ...refreshed, refresh_token: credentials.refresh_token });
  return refreshed.access_token;
}
