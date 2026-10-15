// The pages the user trusts: Eddie opens them, and works inside them (clicks, typing), without asking each time.
//
// The user adds one with a confirmation card in the chat (trust_site) and removes it from the chat or from Conectores;
// nothing a page or a document says can add one. A trusted domain covers its subdomains. What never changes, trusted or
// not (api/_lib/browser/urls.js): only public https addresses, no passwords in the link, nothing inside a network;
// and, inside the page, no passwords or payment data, and messaging apps only draft (agentStep.js).
import { getDb } from '../db.js';
import { isTrustedUrl, safeHttpsUrl } from './urls.js';

export const MAX_TRUSTED = 20;

// Hosts where anybody can publish a site: trusting the host itself would trust strangers' pages.
const SHARED_HOSTS = new Set([
  'vercel.app', 'netlify.app', 'github.io', 'gitlab.io', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev',
  'blogspot.com', 'wordpress.com', 'wixsite.com', 'weebly.com', 'squarespace.com', 'notion.site', 'carrd.co', 'glitch.me', 'repl.co',
  'onrender.com', 'fly.dev', 'railway.app', 'azurewebsites.net', 'cloudfront.net', 'amazonaws.com', 'appspot.com', 'ngrok.io', 'trycloudflare.com',
]);
// «com.do», «co.uk», «gob.mx»…: a country's own public suffix, not a site.
const COUNTRY_SUFFIX = /^(com|org|net|gob|gov|edu|co|ac|or|ne|go|mil)\.[a-z]{2}$/;

// A host is the domain or one of its subdomains.
const inDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// "canva.com", "https://www.canva.com/design", "Canva.com/" → { domain: 'canva.com' } | { error }
export function domainOf(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Dime de qué página (por ejemplo canva.com).' };
  const url = safeHttpsUrl(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (!url) return { error: 'Solo puedo confiar en páginas públicas con https (sin direcciones internas, IP, ni contraseñas en el enlace).' };
  const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (!domain.includes('.') || SHARED_HOSTS.has(domain) || COUNTRY_SUFFIX.test(domain)) {
    return { error: `«${domain}» es un sitio compartido donde cualquiera publica páginas: no puedo darle confianza a todo. Dime la página concreta (por ejemplo mi-sitio.${SHARED_HOSTS.has(domain) ? domain : 'com'}).` };
  }
  return { domain };
}

export async function listTrusted(userId) {
  const sql = getDb();
  const rows = await sql`select domain from browser_trusted_sites where user_id = ${userId} order by created_at`;
  return rows.map((r) => r.domain);
}

// → { added: true } | { added: false, already: true } | { added: false, full: true }
export async function addTrusted(userId, domain) {
  const sql = getDb();
  const have = await listTrusted(userId);
  if (have.includes(domain)) return { added: false, already: true };
  if (have.length >= MAX_TRUSTED) return { added: false, full: true };
  await sql`insert into browser_trusted_sites (user_id, domain) values (${userId}, ${domain}) on conflict do nothing`;
  return { added: true };
}

export async function removeTrusted(userId, domain) {
  const sql = getDb();
  const rows = await sql`delete from browser_trusted_sites where user_id = ${userId} and domain = ${domain} returning domain`;
  return rows.length > 0;
}

// Does this address open without asking for this user? The built-in work places (Google, YouTube, meetings) or one of theirs.
export async function isTrustedForUser(userId, url, env = process.env) {
  if (isTrustedUrl(url, env)) return true;
  const safe = safeHttpsUrl(url);
  if (!safe || !userId) return false;
  const host = new URL(safe).hostname.toLowerCase();
  return (await listTrusted(userId)).some((d) => inDomain(host, d));
}
