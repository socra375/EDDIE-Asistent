// Which addresses Eddie may ask the user's browser to open, and which of them
// it may open without asking first.
//
// Anything is https, public and without a password in it. Eddie opens at once
// only the places it works from (Google's documents, calendar and meetings,
// YouTube, the usual meeting services and Eddie itself); any other website goes
// through a confirmation card, because a page Eddie read could try to send the
// user somewhere on its own. The extension re-checks the first rules (same code
// in extension/urls.js) so a wrong address never opens, whoever sent it.

const MAX_URL_CHARS = 2000;

// host === domain or a subdomain of it
const inDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

const TRUSTED_DOMAINS = [
  'docs.google.com',
  'drive.google.com',
  'sheets.google.com',
  'slides.google.com',
  'meet.google.com',
  'calendar.google.com',
  'mail.google.com',
  'youtube.com',
  'youtu.be',
  'zoom.us',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'meet.jit.si',
];

// The services where a meeting is held, by the address of its link.
const MEETING_DOMAINS = {
  meet: ['meet.google.com'],
  zoom: ['zoom.us'],
  teams: ['teams.microsoft.com', 'teams.live.com'],
  webex: ['webex.com'],
  whereby: ['whereby.com'],
  jitsi: ['meet.jit.si'],
};

const PRIVATE_HOST = /^(localhost|.*\.(local|localhost|internal|lan|home|corp|intranet))$/i;

// The address as a string, or null when it isn't a public https address.
export function safeHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_CHARS) return null;
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  // IP addresses (v4 and v6) and names that only exist inside a network are never opened.
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[') || PRIVATE_HOST.test(host)) return null;
  return u.toString();
}

function appHost(env = process.env) {
  try {
    return new URL(env.APP_URL).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// true for the places Eddie opens without asking.
export function isTrustedUrl(value, env = process.env) {
  const url = safeHttpsUrl(value);
  if (!url) return false;
  const host = new URL(url).hostname.toLowerCase();
  const own = appHost(env);
  return TRUSTED_DOMAINS.some((d) => inDomain(host, d)) || (own !== '' && host === own);
}

// 'meet' | 'zoom' | 'teams' | 'webex' | 'whereby' | 'jitsi', or null.
export function meetingProvider(value) {
  const url = safeHttpsUrl(value);
  if (!url) return null;
  const host = new URL(url).hostname.toLowerCase();
  return Object.keys(MEETING_DOMAINS).find((name) => MEETING_DOMAINS[name].some((d) => inDomain(host, d))) || null;
}
