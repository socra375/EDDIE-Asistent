// Persists and refreshes each user's Google OAuth tokens. Only ever
// called from the backend — the tokens themselves never reach the browser,
// and they're stored encrypted when CONNECTOR_SECRET is set (secretBox.js).
import { getDb } from './db.js';
import { GMAIL_SCOPES, refreshAccessToken } from './google.js';
import { openToken, sealToken } from './secretBox.js';

export async function saveCredentials(userId, tokens) {
  const sql = getDb();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await sql`
    insert into google_credentials (user_id, access_token, refresh_token, expires_at, scope, updated_at)
    values (${userId}, ${sealToken(tokens.access_token)}, ${sealToken(tokens.refresh_token) || null}, ${expiresAt}, ${tokens.scope}, now())
    on conflict (user_id) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, google_credentials.refresh_token),
      expires_at = excluded.expires_at,
      scope = excluded.scope,
      updated_at = now()
  `;
}

// Whether this user ever connected Google (and hasn't removed it) — used by
// the connectors hub to show "Conectado" without touching the tokens.
export async function hasGoogleCredentials(userId) {
  const sql = getDb();
  const rows = await sql`select 1 from google_credentials where user_id = ${userId}`;
  return rows.length > 0;
}

// The permissions the user granted, from Google's own space-separated list.
export async function getGrantedScopes(userId) {
  const sql = getDb();
  const rows = await sql`select scope from google_credentials where user_id = ${userId}`;
  return rows[0]?.scope ? rows[0].scope.split(/\s+/).filter(Boolean) : [];
}

// Gmail is opt-in on top of the login ("Conectar Gmail" in Conectores).
export async function hasGmailAccess(userId) {
  const granted = await getGrantedScopes(userId);
  return GMAIL_SCOPES.every((s) => granted.includes(s));
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
  if (!expiresSoon) return openToken(credentials.access_token);

  if (!credentials.refresh_token) {
    const err = new Error('El acceso a Google expiró y no se puede renovar automáticamente. Vuelve a iniciar sesión.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const refreshToken = openToken(credentials.refresh_token);
  const refreshed = await refreshAccessToken(refreshToken);
  // A refresh answer doesn't always repeat the scope; keep what was granted.
  await saveCredentials(userId, { ...refreshed, refresh_token: refreshToken, scope: refreshed.scope || credentials.scope });
  return refreshed.access_token;
}
