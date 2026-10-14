// The research agent working while Eddie answers: it starts together with the
// answer (not after it), searches memory and — if the request is about the
// outside world — the web, and its card reaches the chat through the same
// stream as soon as it is ready (usually before the answer ends). It never
// slows the answer down more than RESEARCH_WAIT_MS and never makes it fail.
import { queryFrom } from '../episodes/recall.js';
import { cardHasContent, needsWeb, sanitizeCard } from '../../../src/services/research.js';
import { limiterFor } from '../rateLimit.js';
import { investigate } from './engine.js';

// Once the answer is complete, how long the stream stays open for a search that has not finished.
export const RESEARCH_WAIT_MS = 12_000;
const WEB_PER_MINUTE = 6;
const CARD_ID = 'r1';

const lastUserText = (messages) => {
  const last = (Array.isArray(messages) ? messages : []).filter((m) => m?.role === 'user' && typeof m.content === 'string').at(-1);
  return last ? last.content : '';
};

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs `run()` (the model's answer) and the research side by side.
// `onResearch(card)` receives clean cards: a "running" one when a web search is under way, then the final one
// (only when there is something to show, or a web search was made and the user is waiting for it).
// → whatever `run()` returns, plus `research` (the final card) when there is one.
export async function withResearch({ request, getUser, onResearch, run, investigateImpl = investigate, waitMs = RESEARCH_WAIT_MS, env = process.env }) {
  const query = onResearch && !request.disabledConnectors.includes('research') ? queryFrom(request.messages) : null;
  if (!query) return run();

  let open = true;
  const send = (card) => {
    if (!open) return;
    try {
      onResearch(sanitizeCard(card));
    } catch {
      // The stream is gone; the answer decides what happens next.
    }
  };

  const job = (async () => {
    try {
      const user = env.DATABASE_URL ? await getUser() : null;
      const wantsWeb = !request.disabledConnectors.includes('websearch') && needsWeb(lastUserText(request.messages)) && limiterFor('research-web', WEB_PER_MINUTE)(`research:${user?.id || 'anon'}`).ok;
      if (wantsWeb) send({ id: CARD_ID, status: 'running', query, note: 'Buscando en tu memoria y en la web…' });
      const { card } = await investigateImpl({ userId: user?.id || null, query, flatMemory: request.context.memory || [], web: wantsWeb, disabled: request.disabledConnectors, id: CARD_ID, env });
      if (!cardHasContent(card) && !wantsWeb) return null;
      const final = cardHasContent(card) ? card : { ...card, note: card.note || 'No encontré nada nuevo en tu memoria ni en la web.' };
      send(final);
      return final;
    } catch (err) {
      console.error('[research] failed:', err?.message);
      return null;
    }
  })();

  let result;
  try {
    result = await run();
  } catch (err) {
    open = false;
    throw err;
  }
  const TIMED_OUT = Symbol('timeout');
  const settled = await Promise.race([job, pause(waitMs).then(() => TIMED_OUT)]);
  if (settled === TIMED_OUT) {
    const late = { id: CARD_ID, status: 'timeout', query, memory: [], web: null, note: 'No alcancé a terminar la búsqueda.' };
    send(late);
    open = false;
    return { ...result, research: sanitizeCard(late) };
  }
  open = false;
  return settled ? { ...result, research: settled } : result;
}
