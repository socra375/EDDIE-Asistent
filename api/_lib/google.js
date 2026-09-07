// Thin wrappers around Google's OAuth 2.0 and userinfo endpoints. No
// `googleapis` SDK dependency — these are plain REST calls, same pattern
// used for the Gemini/Claude adapters.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// Least-privilege scopes: only calendar *events* (not full calendar
// management) and only Drive files the app itself creates (not the user's
// whole Drive).
export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Falta configurar la variable de entorno ${name}.`);
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }
  return value;
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error_description || 'Google rechazó la solicitud de autenticación.');
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  return data;
}

export function exchangeCodeForTokens(code) {
  return postForm(TOKEN_URL, {
    code,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirect_uri: requireEnv('GOOGLE_REDIRECT_URI'),
    grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(refreshToken) {
  return postForm(TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: requireEnv('GOOGLE_CLIENT_ID'),
    client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
    grant_type: 'refresh_token',
  });
}

export async function fetchGoogleUserInfo(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = new Error('No se pudo obtener el perfil de Google.');
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  return res.json();
}
