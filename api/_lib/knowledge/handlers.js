// /api/connectors/knowledge — what the Memoria screen uses to teach Eddie
// something and to look after what he learned:
//   GET  knowledge          the topics, newest first
//   GET  knowledge/topic    ?id=…  one topic with its notes
//   POST knowledge/learn    { topic, focus? } research and learn (takes ~20–30 s)
//   POST knowledge/delete   { id } forgets a topic, { all: true } forgets everything
//   POST knowledge/note     { id } removes one note (a wrong or useless one)
import { requireUser } from '../session.js';
import { LearnError, learnTopic } from './learn.js';
import { deleteAllTopics, deleteNote, deleteTopic, getTopic, listTopics } from './store.js';

const UUID = /^[0-9a-f-]{36}$/i;
const missingEnv = () => ['DATABASE_URL', 'GEMINI_API_KEY'].filter((name) => !process.env[name]);

const LEARN_STATUS = { BAD_REQUEST: 400, FULL: 409, RATE_LIMITED: 429, PROVIDER_UNAVAILABLE: 503, NO_SOURCES: 502, NOTHING_USEFUL: 422, TIMEOUT: 504, PROVIDER_ERROR: 502 };

export const knowledgeEnabled = (settings) => !(settings?.disabledConnectors || []).includes('knowledge');

export async function handleKnowledgeRoute({ method, path = [], cookies = {}, query = {}, body }) {
  const sub = path[1];
  const user = await requireUser(cookies);
  const missing = missingEnv();

  if (!sub && method === 'GET') {
    if (missing.length) return { status: 200, json: { configured: false, missing, topics: [] } };
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { configured: true, topics: await listTopics(user.id) } };
  }
  if (sub === 'topic' && method === 'GET') {
    if (!UUID.test(String(query.id || ''))) return { status: 400, json: { error: 'Indica el tema.' } };
    const topic = await getTopic(user.id, query.id);
    return topic ? { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { topic } } : { status: 404, json: { error: 'Ese tema ya no existe.' } };
  }
  if (sub === 'learn' && method === 'POST') {
    if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
    try {
      const result = await learnTopic({ userId: user.id, topic: body?.topic, focus: typeof body?.focus === 'string' ? body.focus : '' });
      return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: result };
    } catch (err) {
      if (err instanceof LearnError) return { status: LEARN_STATUS[err.code] || 502, json: { error: err.message, code: err.code } };
      throw err;
    }
  }
  if (sub === 'delete' && method === 'POST') {
    if (body?.all === true) return { status: 200, json: { ok: true, removed: await deleteAllTopics(user.id) } };
    if (UUID.test(String(body?.id || ''))) {
      const removed = await deleteTopic(user.id, body.id);
      return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Ese tema ya no existe.' } };
    }
    return { status: 400, json: { error: 'Indica el tema (id) o all: true.' } };
  }
  if (sub === 'note' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica la nota.' } };
    const removed = await deleteNote(user.id, body.id);
    return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Esa nota ya no existe.' } };
  }
  return { status: 405, json: { error: 'Método no permitido.' } };
}
