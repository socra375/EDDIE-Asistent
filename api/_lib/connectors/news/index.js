// Today's headlines from Google News' public RSS feeds: free, keyless, and
// localized to the user's country (guessed from their time zone).
import { clip, fetchText } from '../http.js';

const DEFAULT_COUNTRY = 'US';
// Time zone → country for Spanish-speaking places; anything else falls back
// to Spanish-language news for the US (widest Spanish coverage).
const TIMEZONE_COUNTRY = {
  'America/Santo_Domingo': 'DO',
  'America/Mexico_City': 'MX',
  'America/Monterrey': 'MX',
  'America/Cancun': 'MX',
  'America/Tijuana': 'MX',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Caracas': 'VE',
  'America/Santiago': 'CL',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Buenos_Aires': 'AR',
  'America/Montevideo': 'UY',
  'America/Asuncion': 'PY',
  'America/La_Paz': 'BO',
  'America/Guayaquil': 'EC',
  'America/Panama': 'PA',
  'America/Costa_Rica': 'CR',
  'America/Guatemala': 'GT',
  'America/El_Salvador': 'SV',
  'America/Tegucigalpa': 'HN',
  'America/Managua': 'NI',
  'America/Havana': 'CU',
  'America/Puerto_Rico': 'PR',
  'Europe/Madrid': 'ES',
  'Atlantic/Canary': 'ES',
};

export function countryFor(timezone) {
  return TIMEZONE_COUNTRY[timezone] || DEFAULT_COUNTRY;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, '')
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]) : '';
}

export function parseRss(xml, limit = 6) {
  const items = [];
  for (const m of String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item = m[1];
    const source = tag(item, 'source');
    let title = tag(item, 'title');
    // Google appends " - Source" to every title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    if (!title) continue;
    const date = new Date(tag(item, 'pubDate'));
    items.push({
      title: clip(title, 180),
      source: source || null,
      published: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      url: tag(item, 'link') || null,
    });
    if (items.length >= limit) break;
  }
  return items;
}

async function getNews(args, context) {
  const country = countryFor(context.timezone);
  const locale = `hl=es-419&gl=${country}&ceid=${country}:es-419`;
  const topic = clip(args.topic, 120);
  const url = topic
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(`${topic} when:3d`)}&${locale}`
    : `https://news.google.com/rss?${locale}`;
  const { ok, text } = await fetchText(url, { timeoutMs: 7000 });
  if (!ok) return { error: 'No se pudieron obtener las noticias en este momento.' };
  const headlines = parseRss(text);
  if (!headlines.length) return { error: topic ? `No hay noticias recientes sobre "${topic}".` : 'No se encontraron titulares.' };
  return { country, topic: topic || null, headlines, cite_sources: 'Menciona el medio de cada titular que uses.' };
}

export default {
  id: 'news',
  name: 'Noticias',
  description: 'Los titulares del día en tu país, o las noticias recientes de un tema, desde Google Noticias.',
  icon: 'news',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Leer los titulares del día',
      sensitive: false,
      declaration: {
        name: 'get_news',
        description:
          'Devuelve titulares recientes (medio, fecha y enlace). Sin "topic" da los principales titulares del país del usuario; con "topic" busca noticias de los últimos días sobre ese tema.',
        parameters: {
          type: 'OBJECT',
          properties: {
            topic: { type: 'STRING', description: 'Tema opcional, p. ej. "béisbol", "economía", "inteligencia artificial".' },
          },
        },
      },
      run: (args, context) => getNews(args, context),
    },
  ],
  webhook: null,
};
