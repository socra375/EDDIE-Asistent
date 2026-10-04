// Reading a web page for the second brain. The addresses come from search
// results, i.e. from the outside world, so nothing here trusts them:
//  - only http(s) on the standard ports, never an address that points inside
//    (localhost, private networks, cloud metadata): the host name is resolved
//    and every address checked, again on each redirect;
//  - a short timeout and a size cap, text pages only, no cookies;
//  - the page is reduced to its readable text (no scripts, menus or markup).
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import { USER_AGENT } from '../connectors/http.js';

export const PAGE_TIMEOUT_MS = 6000;
export const MAX_PAGE_BYTES = 600_000;
export const MAX_PAGE_CHARS = 6000;
const MAX_REDIRECTS = 3;
const TEXT_TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml)/i;
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|home|lan|corp|intranet)$/i;

// True for an address that must never be fetched from here.
export function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '::1') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe[89ab]|ff)/.test(ip) || ip.startsWith('64:ff9b:');
  }
  return true; // not an address at all
}

// The URL if it may be read, or null.
export function safeUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_NAMES.test(host)) return null;
  if ((net.isIP(host) || /^\d+$/.test(host) || /^0x/i.test(host)) && isPrivateAddress(host)) return null;
  if (!net.isIP(host) && !host.includes('.')) return null;
  return url;
}

async function resolvesPublic(host, lookup) {
  const bare = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) return !isPrivateAddress(bare);
  try {
    const addresses = await lookup(bare, { all: true });
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

// Reads at most `max` bytes of the body.
async function readCapped(res, max) {
  if (!res.body?.getReader) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, max));
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', deg: '°' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    }
    return ENTITIES[code] ?? ENTITIES[code.toLowerCase()] ?? match;
  });
}

// { title, text }: the readable part of a page, one paragraph per line.
export function htmlToText(html, { maxChars = MAX_PAGE_CHARS } = {}) {
  let page = String(html || '');
  const title = decodeEntities((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(page)?.[1] || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 140);
  page = page.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|canvas|iframe|form|template|nav|header|footer|aside|button|select)\b[\s\S]*?<\/\1>/gi, ' ');
  // The article itself when the page marks it; otherwise the whole body.
  const main = /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i.exec(page);
  if (main && main[2].length > 800) page = main[2];
  const lines = decodeEntities(page.replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote|pre|ul|ol|table|dd|dt)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    // Menus, buttons and cookie notices are short; paragraphs and list items worth keeping are not.
    .filter((l) => l.length >= 40 && /[a-záéíóúñ]{3,}/i.test(l));
  const seen = new Set();
  const kept = [];
  let used = 0;
  for (const line of lines) {
    const key = line.slice(0, 80).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (used + line.length > maxChars) {
      const room = maxChars - used;
      if (room > 120) kept.push(line.slice(0, room));
      break;
    }
    kept.push(line);
    used += line.length + 1;
  }
  return { title, text: kept.join('\n') };
}

// { ok: true, url, title, text } or { ok: false, reason }. Never throws.
// The name resolver can be swapped (tests only: nothing in the app calls this).
let defaultLookup = dnsLookup;
export function setLookupForTests(fn) {
  defaultLookup = fn || dnsLookup;
}

export async function fetchPage(value, { fetchImpl = globalThis.fetch, lookup = defaultLookup, timeoutMs = PAGE_TIMEOUT_MS } = {}) {
  let url = safeUrl(value);
  if (!url) return { ok: false, reason: 'blocked' };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await resolvesPublic(url.hostname, lookup))) return { ok: false, reason: 'blocked' };
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain;q=0.9', 'Accept-Language': 'es,en;q=0.7' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) {
        const next = safeUrl(new URL(res.headers.get('location') || '', url).toString());
        if (!next) return { ok: false, reason: 'blocked' };
        url = next;
        continue;
      }
      if (!res.ok) return { ok: false, reason: `http ${res.status}` };
      if (!TEXT_TYPES.test(res.headers.get('content-type') || '')) return { ok: false, reason: 'not text' };
      const { title, text } = htmlToText(await readCapped(res, MAX_PAGE_BYTES));
      return text.length >= 200 ? { ok: true, url: url.toString(), title, text } : { ok: false, reason: 'empty' };
    }
    return { ok: false, reason: 'redirects' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
