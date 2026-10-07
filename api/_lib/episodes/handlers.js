// /api/connectors/episodes — what the Memoria screen and the chat use to keep
// and manage conversation notes:
//   GET  episodes          the user's notes, newest first
//   POST episodes          summarize a stretch of conversation and keep it
//   POST episodes/delete   { id } removes one, { all: true } removes every note
import { requireUser } from '../session.js';
import { loadSettings } from '../telegram/serverActions.js';
import { deleteAllEpisodes, deleteEpisode, listEpisodes } from './store.js';
import { saveConversation } from './recall.js';
import { knowledgeEnabled } from '../knowledge/handlers.js';

const MAX_MESSAGES = 30;
const MAX_CONTENT = 2000;

function missingEnv() {
  return ['DATABASE_URL', 'GEMINI_API_KEY'].filter((name) => !process.env[name]);
}

export const episodesEnabled = (settings) => settings?.memoryEnabled !== false && !(settings?.disabledConnectors || []).includes('conversations');

function cleanMessages(value) {
  if (!Array.isArray(value)) return null;
  return value
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.trim().slice(0, MAX_CONTENT) }));
}

export async function handleEpisodesRoute({ method, path = [], cookies = {}, body }) {
  const sub = path[1];
  if (!sub && method === 'GET') {
    const user = await requireUser(cookies);
    const missing = missingEnv();
    if (missing.length) return { status: 200, json: { configured: false, missing, episodes: [] } };
    const episodes = await listEpisodes(user.id);
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { configured: true, episodes } };
  }
  if (!sub && method === 'POST') {
    const user = await requireUser(cookies);
    const missing = missingEnv();
    if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
    const messages = cleanMessages(body?.messages);
    if (!messages) return { status: 400, json: { error: 'Faltan los mensajes de la conversación.' } };
    const settings = await loadSettings(user.id);
    if (!episodesEnabled(settings)) return { status: 200, json: { saved: false, reason: 'apagado' } };
    const conversationId = typeof body?.conversationId === 'string' ? body.conversationId.slice(0, 80) : null;
    const result = await saveConversation({ userId: user.id, messages, conversationId, source: 'web', keepLearning: knowledgeEnabled(settings) });
    if (!result.saved) return { status: 200, json: result };
    // `actions` are what the analysis found for the first brain (datos, preferencias, proyectos…): the app
    // applies them to the user's memory; `learned` are the skills already kept in the second brain.
    return { status: 200, json: { saved: true, episode: result.episode, actions: result.actions, learned: result.learned, counts: result.counts } };
  }
  if (sub === 'delete' && method === 'POST') {
    const user = await requireUser(cookies);
    if (body?.all === true) return { status: 200, json: { ok: true, removed: await deleteAllEpisodes(user.id) } };
    if (typeof body?.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id)) {
      const removed = await deleteEpisode(user.id, body.id);
      return { status: removed ? 200 : 404, json: removed ? { ok: true } : { error: 'Ese recuerdo ya no existe.' } };
    }
    return { status: 400, json: { error: 'Indica el recuerdo (id) o all: true.' } };
  }
  return { status: 405, json: { error: 'Método no permitido.' } };
}
