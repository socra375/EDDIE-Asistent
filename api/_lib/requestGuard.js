// Who may call the API from a browser.
//
// Eddie's page and its API share one address, so a browser call from any other
// site is somebody else's page using this server (and its AI quota, or the
// signed-in user's cookie). Browsers say where a request comes from
// (`Sec-Fetch-Site`, `Origin`); this refuses the ones from elsewhere. Calls
// without those headers (Telegram's webhook, the EDDIE Prime agent, the cron
// job, curl) are server-to-server and are not browser requests, so they pass:
// each of them has its own secret or token.
//
// A page hosted on another address can be allowed with ALLOWED_ORIGINS
// (comma-separated, e.g. "https://eddie.example.com").
function originOf(value) {
  try {
    return new URL(String(value)).origin;
  } catch {
    return '';
  }
}

export function allowedOrigins(env = process.env) {
  const list = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(originOf)
    .filter(Boolean);
  const app = originOf(env.APP_URL);
  return new Set(app ? [app, ...list] : list);
}

// true when the request comes from Eddie's own page, an allowed page, or isn't a browser's.
export function isTrustedRequest(req, env = process.env) {
  const site = req.headers?.['sec-fetch-site'];
  if (!site || site === 'same-origin' || site === 'none') return true;
  const origin = originOf(req.headers?.origin);
  return Boolean(origin) && allowedOrigins(env).has(origin);
}

// Sets CORS headers only for an allowed other page (never '*'). Returns true when the request is not trusted.
export function applyCors(req, res, { methods = 'POST, OPTIONS', headers = 'Content-Type, X-Audio-Type', env = process.env } = {}) {
  const origin = originOf(req.headers?.origin);
  res.setHeader('Vary', 'Origin');
  if (origin && req.headers?.['sec-fetch-site'] !== 'same-origin' && allowedOrigins(env).has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
  }
  return !isTrustedRequest(req, env);
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// For endpoints that act with the user's cookie: a change (POST, PUT, PATCH,
// DELETE) coming from another site is refused (403) even if the cookie would
// have been sent. Answers and returns true when it refuses.
export function refuseCrossSiteChange(req, res, env = process.env) {
  if (SAFE_METHODS.has(req.method) || isTrustedRequest(req, env)) return false;
  res.status(403).json({ error: 'Origen no permitido.' });
  return true;
}
