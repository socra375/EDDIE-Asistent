// Finding real pictures on the internet for Eddie to show and send (the other
// half of making them with Gemini). Sources, in this order, until enough pictures
// have been downloaded and checked:
//
//   1. Pexels        (only with PEXELS_API_KEY, free): very good photos, free licence
//   2. Openverse     (no key): images under Creative Commons licences, mature content off
//   3. Wikimedia Commons (no key): free-licence photos, logos, places, people, things
//   4. the web       (Tavily, with or without TAVILY_API_KEY): anything else; the licence is NOT known
//
// Nothing is hot-linked: every picture is downloaded here, checked by its first
// bytes (PNG, JPEG or WebP, within the size cap) and kept in the gallery with its
// credit, licence and page. The download is as careful as the second brain's page
// reader: public addresses only (every redirect re-checked), a size cap, a timeout.
import { lookup as dnsLookup } from 'node:dns/promises';
import { MAX_IMAGE_BYTES, MediaError, sniffImage } from './image.js';
import { resolvesPublic, safeUrl } from '../knowledge/pages.js';
import { USER_AGENT, clip, fetchJson } from '../connectors/http.js';

export const MAX_FOUND = 4;
const MIN_BYTES = 3000; // tracking pixels and icons
const DOWNLOAD_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const SEARCH_BUDGET_MS = 24000;

// What is not searched for (explicit sexual content, content with minors, gore), and what is dropped from the results.
const BLOCKED = /\b(porn\w*|xxx|sexo|sexual\w*|sexy|desnud\w*|nud[eo]s?|naked|topless|nsfw|er[oó]tic\w*|hentai|onlyfans|gore|cad[aá]ver\w*|decapit\w*|lolit?a?s?|ni[ñn]\w* (desnud|sex)|child\s+(porn|nude|sex))\b/i;

export function cleanQuery(value) {
  const query = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (query.length < 2) throw new MediaError('Dime qué imagen buscas (al menos una palabra).', 'BAD_REQUEST');
  if (BLOCKED.test(query)) throw new MediaError('No busco imágenes de ese tipo (contenido sexual explícito o violento).', 'BLOCKED');
  return query;
}

const stripTags = (text) => String(text || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
const host = (value) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function licenseName(license, version) {
  const l = String(license || '').toLowerCase();
  if (!l) return 'licencia no indicada';
  if (l === 'cc0') return 'CC0 (dominio público)';
  if (l === 'pdm') return 'Dominio público';
  return `CC ${l.toUpperCase()}${version ? ` ${version}` : ''}`;
}

// ---- The sources: each returns candidates { source, imageUrl, pageUrl, title, credit, license } ----

export async function searchPexels({ query, limit, env = process.env }) {
  if (!env.PEXELS_API_KEY) return [];
  const { ok, data } = await fetchJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${Math.min(limit, 15)}&locale=es-ES`, {
    headers: { Authorization: env.PEXELS_API_KEY },
    timeoutMs: 8000,
  });
  if (!ok) return [];
  return (data?.photos || [])
    .map((p) => ({
      source: 'pexels',
      imageUrl: p?.src?.large || p?.src?.medium || '',
      pageUrl: p?.url || '',
      title: clip(p?.alt || query, 120),
      credit: p?.photographer ? `${clip(p.photographer, 60)} (Pexels)` : 'Pexels',
      license: 'Licencia Pexels (uso libre)',
    }))
    .filter((c) => c.imageUrl);
}

export async function searchOpenverse({ query, limit }) {
  const { ok, data } = await fetchJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=${Math.min(limit, 20)}&mature=false`, { timeoutMs: 8000 });
  if (!ok) return [];
  return (data?.results || [])
    .map((r) => ({
      source: 'openverse',
      // The thumbnail is served by Openverse itself (a medium size, a fixed host); the original is the fallback.
      imageUrl: r?.thumbnail || r?.url || '',
      pageUrl: r?.foreign_landing_url || r?.url || '',
      title: clip(r?.title || query, 120),
      credit: clip(r?.creator ? `${r.creator}${r.source ? ` (${r.source})` : ''}` : r?.source || 'Openverse', 80),
      license: licenseName(r?.license, r?.license_version),
    }))
    .filter((c) => c.imageUrl && !BLOCKED.test(c.title));
}

export async function searchWikimedia({ query, limit }) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(limit, 20)),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: '1000',
    format: 'json',
    formatversion: '2',
  });
  const { ok, data } = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { timeoutMs: 8000 });
  if (!ok) return [];
  return (data?.query?.pages || [])
    .map((page) => {
      const info = page?.imageinfo?.[0];
      if (!info || !/^image\/(jpeg|png|webp)$/.test(info.mime || '') || Number(info.width) < 300) return null;
      const meta = info.extmetadata || {};
      const title = stripTags(page.title).replace(/^File:/i, '').replace(/\.(jpe?g|png|webp)$/i, '').replace(/_/g, ' ');
      return {
        source: 'wikimedia',
        imageUrl: info.thumburl || info.url || '',
        pageUrl: info.descriptionurl || '',
        title: clip(title || query, 120),
        credit: clip(`${stripTags(meta.Artist?.value) || 'autor desconocido'} (Wikimedia Commons)`, 90),
        license: clip(stripTags(meta.LicenseShortName?.value) || 'licencia libre', 40),
      };
    })
    .filter((c) => c && c.imageUrl && !BLOCKED.test(c.title));
}

export async function searchWeb({ query, limit, env = process.env }) {
  const headers = { 'Content-Type': 'application/json' };
  if (env.TAVILY_API_KEY) headers.Authorization = `Bearer ${env.TAVILY_API_KEY}`;
  else headers['X-Tavily-Access-Mode'] = 'keyless';
  const { ok, data } = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 5, include_images: true, include_image_descriptions: true, include_answer: false }),
    timeoutMs: 9000,
  });
  if (!ok) return [];
  return (data?.images || [])
    .slice(0, limit)
    .map((img) => {
      const imageUrl = typeof img === 'string' ? img : img?.url || '';
      const description = typeof img === 'string' ? '' : img?.description || '';
      return { source: 'web', imageUrl, pageUrl: imageUrl, title: clip(description || query, 120), credit: host(imageUrl) || 'la web', license: 'licencia no verificada (úsala solo para verla)' };
    })
    .filter((c) => c.imageUrl && !BLOCKED.test(c.title));
}

export const SOURCES = { pexels: searchPexels, openverse: searchOpenverse, wikimedia: searchWikimedia, web: searchWeb };

// ---- The download ----

async function readCapped(res, max) {
  if (!res.body?.getReader) {
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > max ? null : buffer;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// → { ok: true, buffer, mime } | { ok: false, reason }. Never throws.
export async function fetchPicture(value, { fetchImpl = globalThis.fetch, lookup = dnsLookup, timeoutMs = DOWNLOAD_TIMEOUT_MS, max = MAX_IMAGE_BYTES } = {}) {
  let url = safeUrl(value);
  if (!url) return { ok: false, reason: 'blocked' };
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!(await resolvesPublic(url.hostname, lookup))) return { ok: false, reason: 'blocked' };
      const res = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400) {
        const next = safeUrl(new URL(res.headers.get('location') || '', url).toString());
        if (!next) return { ok: false, reason: 'blocked' };
        url = next;
        continue;
      }
      if (!res.ok) return { ok: false, reason: `http ${res.status}` };
      if (Number(res.headers.get('content-length') || 0) > max) return { ok: false, reason: 'too big' };
      const buffer = await readCapped(res, max);
      if (!buffer) return { ok: false, reason: 'too big' };
      const mime = sniffImage(buffer); // by its bytes, never by what the server says
      if (!mime || buffer.length < MIN_BYTES) return { ok: false, reason: 'not a picture' };
      return { ok: true, buffer, mime };
    }
    return { ok: false, reason: 'redirects' };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

const chunk = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// → { query, pictures: [{ buffer, mime, source, title, credit, license, pageUrl, imageUrl }], tried: ['openverse', …] }
// Never throws for a source that fails: the next one is tried.
export async function findPictures({ query: rawQuery, count = 3, env = process.env, sources = SOURCES, download = fetchPicture, now = Date.now } = {}) {
  const query = cleanQuery(rawQuery);
  const want = Math.max(1, Math.min(MAX_FOUND, Number.parseInt(count, 10) || 3));
  const started = now();
  const order = [...(env.PEXELS_API_KEY ? ['pexels'] : []), 'openverse', 'wikimedia', 'web'];
  const pictures = [];
  const seen = new Set();
  const tried = [];
  for (const name of order) {
    if (pictures.length >= want || now() - started > SEARCH_BUDGET_MS) break;
    tried.push(name);
    let candidates = [];
    try {
      candidates = await sources[name]({ query, limit: want * 3, env });
    } catch {
      candidates = [];
    }
    // The same picture twice (in one source or across sources) is kept once.
    const fresh = [];
    for (const c of candidates) {
      if (!c?.imageUrl || seen.has(c.imageUrl) || fresh.some((f) => f.imageUrl === c.imageUrl)) continue;
      fresh.push(c);
    }
    for (const batch of chunk(fresh, 3)) {
      if (pictures.length >= want || now() - started > SEARCH_BUDGET_MS) break;
      const got = await Promise.all(batch.map(async (c) => ({ c, file: await download(c.imageUrl) })));
      for (const { c, file } of got) {
        seen.add(c.imageUrl);
        if (file?.ok && pictures.length < want) pictures.push({ ...c, buffer: file.buffer, mime: file.mime });
      }
    }
  }
  return { query, pictures, tried };
}
