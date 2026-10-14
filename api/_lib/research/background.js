// The research agent working in the background of an answer: while Eddie gathers
// what he knows (memories, clients, the date…), it searches the web — only when the
// request is about the outside world — and what it finds goes straight into the
// answer's prompt. Nothing is shown to the user as a card: the answer is simply better
// informed and cites its sources. It never makes the answer fail and never delays it more
// than RESEARCH_WAIT_MS counted from the start (a late search is dropped).
//
// Memories (Memoria, past chats, second brain, business) are already in the prompt through their own blocks, so
// this one only brings what they cannot: the web.
import { queryFrom } from '../episodes/recall.js';
import { formatWebBlock, needsWeb } from '../../../src/services/research.js';
import { limiterFor } from '../rateLimit.js';
import { investigate } from './engine.js';

export const RESEARCH_WAIT_MS = 5000;
const WEB_PER_MINUTE = 6;
const MEMORY_SOURCES = ['memory', 'conversations', 'knowledge', 'business'];

const lastUserText = (messages) => {
  const last = (Array.isArray(messages) ? messages : []).filter((m) => m?.role === 'user' && typeof m.content === 'string').at(-1);
  return last ? last.content : '';
};

// Starts the search at once and returns a promise of the prompt block ('' when there is nothing). It never rejects.
// Call it first, do the rest of the prompt work, and await it right before calling the model.
export function startResearch({ request, getUser, investigateImpl = investigate, waitMs = RESEARCH_WAIT_MS, env = process.env }) {
  const off = request.disabledConnectors;
  if (off.includes('research') || off.includes('websearch')) return Promise.resolve('');
  const query = queryFrom(request.messages);
  if (!query || !needsWeb(lastUserText(request.messages))) return Promise.resolve('');

  const job = (async () => {
    try {
      const user = env.DATABASE_URL ? await getUser() : null;
      // Six web searches a minute per person: a loop or a chatty hour never drains the free plan.
      if (!limiterFor('research-web', WEB_PER_MINUTE)(`research:${user?.id || 'anon'}`).ok) return '';
      const { card } = await investigateImpl({ userId: user?.id || null, query, web: true, disabled: [...off, ...MEMORY_SOURCES], env });
      return formatWebBlock(card);
    } catch (err) {
      console.error('[research] failed:', err?.message);
      return '';
    }
  })();
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(''), waitMs);
  });
  return Promise.race([job, late]).finally(() => clearTimeout(timer));
}
