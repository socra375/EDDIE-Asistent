// Encyclopedic facts from Wikipedia (Spanish first, English if nothing
// turns up): free, keyless, and a reliable source to cite.
import { clip, fetchJson } from '../http.js';

async function findTitle(lang, query) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&utf8=1`;
  const { ok, data } = await fetchJson(url, { timeoutMs: 6000 });
  if (!ok) return null;
  return data?.query?.search?.[0]?.title || null;
}

async function summary(lang, title) {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  const { ok, data } = await fetchJson(url, { timeoutMs: 6000 });
  if (!ok || !data?.extract) return null;
  return {
    title: data.title,
    description: data.description || null,
    summary: clip(data.extract, 1200),
    url: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    language: lang,
  };
}

async function searchWikipedia(args) {
  const query = clip(args.query, 200);
  if (!query) return { error: 'La búsqueda está vacía.' };
  for (const lang of ['es', 'en']) {
    const title = await findTitle(lang, query);
    if (!title) continue;
    const page = await summary(lang, title);
    if (page) return { ...page, cite_sources: 'Cita Wikipedia con el enlace.' };
  }
  return { error: `Wikipedia no tiene un artículo sobre "${query}".` };
}

export default {
  id: 'wikipedia',
  name: 'Wikipedia',
  description: 'Datos de enciclopedia sobre personas, lugares, historia y ciencia, con el enlace al artículo.',
  icon: 'book',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Consultar Wikipedia',
      activity: 'Consultando Wikipedia…',
      sensitive: false,
      declaration: {
        name: 'search_wikipedia',
        description:
          'Busca un artículo de Wikipedia y devuelve su resumen y enlace. Úsala para definiciones y datos estables (biografías, historia, geografía, ciencia); para lo muy reciente usa search_web.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'El tema, persona o lugar, p. ej. "Juan Pablo Duarte".' },
          },
          required: ['query'],
        },
      },
      run: (args) => searchWikipedia(args),
    },
  ],
  webhook: null,
};
