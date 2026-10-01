// Conversation notes (Eddie's memory of past conversations): the calls the
// app makes to /api/connectors/episodes. The summaries are written on the
// server (see api/_lib/episodes/); nothing here ever sees an API key.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body, keepalive = false } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/episodes${path}`, {
      method,
      credentials: 'include',
      keepalive,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data || {};
}

// { configured, episodes: [{ id, summary, source, messageCount, createdAt }] }
export const listEpisodes = () => call('');

// Summarize and keep a stretch of conversation → { saved, reason?, episode? }.
export const saveEpisode = ({ conversationId, messages, keepalive }) => call('', { method: 'POST', body: { conversationId, messages }, keepalive });

export const deleteEpisode = (id) => call('/delete', { method: 'POST', body: { id } });
export const deleteAllEpisodes = () => call('/delete', { method: 'POST', body: { all: true } });
