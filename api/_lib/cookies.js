// Minimal cookie parsing/serialization. We read the raw Cookie header
// ourselves instead of relying on platform-specific auto-parsing, so the
// same code behaves identically on Vercel and on the local Express server.

export function parseCookies(header = '') {
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

// `Secure` cookies are allowed on http://localhost by every modern browser
// (localhost is treated as a secure context), so we can set it unconditionally
// without breaking local development.
export function serializeCookie(name, value, { maxAge, sameSite = 'Lax', path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`, 'HttpOnly', 'Secure'];
  if (typeof maxAge === 'number') parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function clearCookie(name) {
  return serializeCookie(name, '', { maxAge: 0 });
}
