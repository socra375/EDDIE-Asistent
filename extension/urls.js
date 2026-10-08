// Which addresses the extension will open: public https pages without a
// password in them. The same rule as the server's (api/_lib/browser/urls.js,
// a test keeps them equal), kept here too so a wrong address never opens
// whoever sent it. Returns the address as a string, or null.
const MAX_URL_CHARS = 2000;
const PRIVATE_HOST = /^(localhost|.*\.(local|localhost|internal|lan|home|corp|intranet))$/i;

export function openableUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS) return null;
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[') || PRIVATE_HOST.test(host)) return null;
  return u.toString();
}

// The origin of an Eddie server the extension may talk to: https, or
// http://localhost while developing. Returns the origin or null.
export function serverOrigin(value) {
  try {
    const u = new URL(String(value || ''));
    if (u.username || u.password) return null;
    const local = u.protocol === 'http:' && u.hostname === 'localhost';
    return u.protocol === 'https:' || local ? u.origin : null;
  } catch {
    return null;
  }
}
