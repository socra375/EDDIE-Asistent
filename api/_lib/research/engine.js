// The research agent's search: Eddie's memories (what he keeps in Memoria, past
// conversations, the second brain, the business brain) and, when asked for, the
// web — all at once, each with its own time limit, none able to break the others.
// It only reads. What it finds is data (copied from pages and old chats), never
// instructions, and is cleaned (sanitizeCard) before it goes anywhere.
import { recallEpisodes } from '../episodes/recall.js';
import { recallForTool as recallKnowledge } from '../knowledge/recall.js';
import { listBusiness } from '../business/store.js';
import { matchNodes } from '../../../src/services/business.js';
import { searchWeb } from '../connectors/websearch/index.js';
import { cardHasContent, findInMemory, sanitizeCard } from '../../../src/services/research.js';
import { clip } from '../connectors/http.js';

const MEMORY_TIMEOUT_MS = 4000;
const WEB_TIMEOUT_MS = 10000;
const EPISODE_LIMIT = 3;
const EPISODE_MIN_SIMILARITY = 0.55;
const BUSINESS_LIMIT = 3;

function timeLimited(promise, ms, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} tardó demasiado`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

// Runs one source: { items } on success, { error } on any failure (a source never throws).
async function settle(what, ms, fn) {
  try {
    return { value: await timeLimited(Promise.resolve().then(fn), ms, what) };
  } catch (err) {
    return { error: err?.message || `${what} falló` };
  }
}

const dayText = (iso) => {
  try {
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(iso));
  } catch {
    return '';
  }
};

// The real sources; tests pass their own.
export const defaultSources = {
  conversations: async (userId, query) =>
    (await recallEpisodes(userId, query, { limit: EPISODE_LIMIT, minSimilarity: EPISODE_MIN_SIMILARITY })).map((e) => ({ source: 'conversations', title: `Conversación del ${dayText(e.createdAt)}`, text: e.summary })),
  knowledge: async (userId, query) => (await recallKnowledge(userId, query)).slice(0, 4).map((n) => ({ source: 'knowledge', title: n.topic || 'Lo que aprendí', text: n.content, url: n.sourceUrl || undefined })),
  business: async (userId, query) =>
    matchNodes(await listBusiness(userId), query, { limit: BUSINESS_LIMIT }).map((n) => ({
      source: 'business',
      title: n.title,
      text: [n.summary, n.status ? `Estado: ${n.status}` : '', n.amount != null ? `Monto: ${n.amount}` : '', n.notes?.at(-1)?.text].filter(Boolean).join(' · ') || n.title,
    })),
  web: (query) => searchWeb({ query }),
};

// → { card, errors }. `card` is already clean (status 'done'). `web: true` also searches the internet.
// `disabled` are the connectors the user switched off in the hub (conversations, knowledge, business, memory, websearch).
export async function investigate({ userId = null, query, flatMemory = [], web = false, disabled = [], minHits = 2, sources = defaultSources, id = 'r1', env = process.env } = {}) {
  const off = new Set(disabled);
  const db = Boolean(userId && env.DATABASE_URL);
  const brain = db && Boolean(env.GEMINI_API_KEY);
  const jobs = [];
  const add = (key, enabled, ms, fn) => enabled && jobs.push(settle(key, ms, fn).then((r) => ({ key, ...r })));
  add('memory', !off.has('memory'), MEMORY_TIMEOUT_MS, () => findInMemory(flatMemory, query, { limit: 4, minHits }).map((m) => ({ source: 'memory', title: '', text: m.t })));
  add('conversations', brain && !off.has('conversations'), MEMORY_TIMEOUT_MS, () => sources.conversations(userId, query));
  add('knowledge', db && !off.has('knowledge'), MEMORY_TIMEOUT_MS, () => sources.knowledge(userId, query));
  add('business', db && !off.has('business'), MEMORY_TIMEOUT_MS, () => sources.business(userId, query));
  add('web', web && !off.has('websearch'), WEB_TIMEOUT_MS, () => sources.web(query));
  const done = await Promise.all(jobs);

  const errors = done.filter((d) => d.error).map((d) => ({ source: d.key, message: d.error }));
  const memory = done.filter((d) => d.key !== 'web' && Array.isArray(d.value)).flatMap((d) => d.value);
  const webResult = done.find((d) => d.key === 'web');
  // searchWeb answers { error } for an empty result or an exhausted quota: that is a note, not a failure of the card.
  const webOk = webResult?.value && !webResult.value.error ? webResult.value : null;
  const webError = webResult?.error || webResult?.value?.error || '';
  const card = sanitizeCard({
    id,
    status: 'done',
    query: clip(query, 200),
    memory,
    web: webOk ? { answer: webOk.answer, results: webOk.results } : null,
    note: webError ? `Web: ${webError}` : '',
  });
  return { card, errors, hasContent: cardHasContent(card) };
}
