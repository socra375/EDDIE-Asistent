// Web search through Tavily, built for AI assistants: it returns a short
// answer plus the sources to cite. Works with no key at all (Tavily's
// keyless mode, rate limited); TAVILY_API_KEY — free, 1,000 searches a
// month at https://app.tavily.com — lifts the limit.
import { clip, fetchJson } from '../http.js';

const TAVILY_URL = 'https://api.tavily.com/search';

async function searchWeb(args) {
  const query = clip(args.query, 300);
  if (!query) return { error: 'La búsqueda está vacía.' };
  const key = process.env.TAVILY_API_KEY;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  else headers['X-Tavily-Access-Mode'] = 'keyless';

  const { ok, status, data } = await fetchJson(TAVILY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      topic: args.topic === 'news' ? 'news' : 'general',
      search_depth: 'basic',
      max_results: 5,
      include_answer: true,
    }),
    timeoutMs: 9000,
  });
  if (!ok) {
    if (status === 429 || status === 432 || status === 433) {
      return {
        error: key
          ? 'Se alcanzó el límite de búsquedas de Tavily de este mes.'
          : 'Se alcanzó el límite de búsquedas sin clave. Agrega TAVILY_API_KEY (gratis, 1.000 búsquedas al mes) en Vercel.',
      };
    }
    if (status === 401) return { error: 'Tavily rechazó la clave TAVILY_API_KEY.' };
    return { error: 'La búsqueda web no respondió en este momento.' };
  }
  const results = (data?.results || []).slice(0, 5).map((r) => ({ title: clip(r.title, 120), url: r.url, snippet: clip(r.content, 350) }));
  if (!results.length && !data?.answer) return { error: `No se encontraron resultados para "${query}".` };
  return { query, answer: clip(data?.answer, 600) || null, results, cite_sources: 'Cita las fuentes (título y enlace) que uses.' };
}

export default {
  id: 'websearch',
  name: 'Búsqueda web',
  description: 'Eddie busca información actual en internet y te dice de dónde la sacó.',
  icon: 'search',
  auth: null,
  requiredEnv: [],
  note: (env) =>
    env.TAVILY_API_KEY
      ? 'Tavily con tu clave (1.000 búsquedas gratis al mes).'
      : 'Funciona sin clave con un límite bajo; agrega TAVILY_API_KEY (gratis) en Vercel para más búsquedas.',
  tools: [
    {
      label: 'Buscar en internet',
      sensitive: false,
      declaration: {
        name: 'search_web',
        description:
          'Busca en internet información actual o que no conoces con seguridad (resultados deportivos, precios, eventos recientes, datos de empresas o productos, "quién es", "qué pasó con"). Devuelve un resumen y las fuentes; cítalas en tu respuesta.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'La búsqueda, en pocas palabras clave, en el idioma más útil para encontrar la respuesta.' },
            topic: { type: 'STRING', enum: ['general', 'news'], description: '"news" para noticias recientes; si no, "general".' },
          },
          required: ['query'],
        },
      },
      run: (args) => searchWeb(args),
    },
  ],
  webhook: null,
};
