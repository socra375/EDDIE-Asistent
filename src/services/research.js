// El agente investigador, the rules without the network: when a request is worth
// a web search, how to look through the flat memory, and how to clean the card
// the chat shows (everything that comes from the web or the server is checked
// again here before it reaches the screen).
//
// The card: { id, status: 'running' | 'done' | 'timeout' | 'error', query,
//   memory: [{ source, title, text, url? }], web: { answer, results: [{ title, url, snippet }] } | null, note }

export const SOURCE_LABELS = { memory: 'Memoria', conversations: 'Conversaciones', knowledge: 'Segundo cerebro', business: 'Negocios' };
export const STATUSES = ['running', 'done', 'timeout', 'error'];
const MAX_MEMORY_ITEMS = 8;
const MAX_WEB_RESULTS = 5;

export const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The user asks for outside information on purpose (even about something of theirs: «busca en internet mi competencia»).
const EXPLICIT = /\b(busca|buscame|buscar|investiga|investigame|investigar|averigua|averiguame|googlea|en internet|en la web|en linea|noticias?|ultimas? (noticias|novedades)|actualidad)\b/;
// Softer ways of asking for information: they go to the web unless they are about the user's own things.
const INFO = /\b(compara|comparame|comparar|(informacion|datos|detalles) (sobre|de|acerca de)|cuentame (sobre|de)|dime (sobre|de)|dame (informacion|datos))\b/;
// Questions that usually need the outside world: facts, prices, dates, results, comparisons.
const FACTUAL = /\b(quien (es|fue|era|gano|ha ganado)|que (es|son|significa|paso|pasa|dice)|cuando (es|fue|sale|empieza|termina|nacio|murio)|donde (queda|esta|puedo comprar|se puede)|cuanto (cuesta|vale|sale|miden?|pesa|dura)|cual es (el|la) (mejor|precio|capital|diferencia)|como (esta|va|quedo|quedaron) (el|la|los|las)|resultado|marcador|precio|diferencia entre|mejores? |alternativas? a|tendencias?|reviews?|opiniones? de|vale la pena|202\d)\b/;
// About the user's own things: other agents and brains answer those, not the web.
const PERSONAL = /\b(mi|mis|mio|mia|mios|mias|me|tengo|tenia|recuerdame|recordatorio|agenda|correo|correos|tarea|tareas|cita|citas|cuentas?|deben|debo|cliente|clientes|contacto|contactos|recado|recados|horario|equipo|computadora|pc)\b/;
const MIN_WORDS = 4;

// Does this message deserve a web search in the background? Searching on every "hola" or "anota esto"
// would burn the search quota for nothing, so: asked for on purpose, or a question of fact that is not
// about the user's own things.
export function needsWeb(text) {
  const t = plain(text).trim();
  if (t.length < 12) return false;
  if (EXPLICIT.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS) return false;
  if (PERSONAL.test(t)) return false;
  if (INFO.test(t)) return true;
  const question = /\?/.test(t) || /^(quien|que|cuando|donde|cuanto|cuantos|cuantas|cual|cuales|como|por que)\b/.test(t);
  return FACTUAL.test(t) && (question || EXPLICIT.test(t) || words >= 6);
}

const WORD = /[\p{L}\p{N}]{4,}/gu;
const STOP = new Set([
  'sobre', 'acerca', 'dime', 'dame', 'esto', 'esta', 'este', 'esos', 'esas', 'como', 'para', 'pero', 'porque', 'cual', 'cuales', 'quien', 'cuando', 'donde', 'cuanto', 'tiene', 'tienes', 'tengo', 'puedes', 'puedo', 'quiero', 'hacer', 'haz', 'hazme', 'busca', 'investiga', 'internet', 'favor', 'gracias', 'hola', 'algo', 'mucho', 'muy', 'mas', 'ese', 'esa', 'unas', 'unos', 'entre', 'desde', 'hasta', 'cada', 'toda', 'todo', 'todos', 'todas', 'otra', 'otro', 'ahora', 'aqui', 'alli', 'tambien', 'solo',
]);
export const wordsOf = (text) => [...new Set((plain(text).match(WORD) || []).filter((w) => !STOP.has(w)))];

// The saved memory (flat: [{ id, c, t }]) against the question. `minHits`: how many of the question's
// words an item must share (1 is for a tool call that asked on purpose; the automatic search wants 2 so
// that one common word does not put noise in the chat).
export function findInMemory(list, query, { limit = 4, minHits = 2 } = {}) {
  const words = wordsOf(query);
  if (!words.length) return [];
  const need = Math.min(minHits, words.length);
  return (Array.isArray(list) ? list : [])
    .map((m) => {
      const have = new Set(wordsOf(m?.t));
      return { m, hits: words.filter((w) => have.has(w)).length };
    })
    .filter((x) => x.m && typeof x.m.t === 'string' && x.hits >= need)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => x.m);
}

// One line of plain text: control characters become spaces.
const clean = (value, max) =>
  Array.from(String(value ?? ''), (ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const safeUrl = (value) => {
  try {
    const u = new URL(String(value));
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href.slice(0, 500) : '';
  } catch {
    return '';
  }
};

// A card as the server sent it → what the screen may show (null if it is not a card at all).
export function sanitizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const memory = (Array.isArray(raw.memory) ? raw.memory : [])
    .filter((m) => m && m.source in SOURCE_LABELS && clean(m.text, 400))
    .slice(0, MAX_MEMORY_ITEMS)
    .map((m) => ({ source: m.source, title: clean(m.title, 80), text: clean(m.text, 320), ...(safeUrl(m.url) ? { url: safeUrl(m.url) } : {}) }));
  const results = (Array.isArray(raw.web?.results) ? raw.web.results : [])
    .map((r) => ({ title: clean(r?.title, 120), url: safeUrl(r?.url), snippet: clean(r?.snippet, 300) }))
    .filter((r) => r.url && r.title)
    .slice(0, MAX_WEB_RESULTS);
  const answer = clean(raw.web?.answer, 500);
  return {
    id: clean(raw.id, 40) || 'r1',
    status: STATUSES.includes(raw.status) ? raw.status : 'done',
    query: clean(raw.query, 200),
    memory,
    web: answer || results.length ? { answer: answer || null, results } : null,
    note: clean(raw.note, 200),
  };
}

export const cardHasContent = (card) => Boolean(card && (card.memory?.length || card.web?.results?.length || card.web?.answer));
