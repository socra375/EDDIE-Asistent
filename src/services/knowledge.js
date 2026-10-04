// The second brain (what Eddie learned by researching the web): the calls the
// Memoria screen makes to /api/connectors/knowledge. The research itself runs on
// the server; nothing here sees an API key.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/knowledge${path}`, {
      method,
      credentials: 'include',
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

// { configured, topics: [{ id, title, summary, kind, noteCount, sourceCount, updatedAt }] }
export const listTopics = () => call('');
// { topic: { …, notes: [{ id, content, sourceUrl, sourceTitle }] } }
export const getTopic = (id) => call(`/topic?id=${encodeURIComponent(id)}`);
// Researches and learns (takes ~20–30 s) → { topic, kind, summary, noteCount, sources, updated }
export const learnTopic = (topic) => call('/learn', { method: 'POST', body: { topic } });
export const deleteTopic = (id) => call('/delete', { method: 'POST', body: { id } });
export const deleteAllTopics = () => call('/delete', { method: 'POST', body: { all: true } });
export const deleteNote = (id) => call('/note', { method: 'POST', body: { id } });
export const setTopicCategory = (id, category) => call('/category', { method: 'POST', body: { id, category } });
