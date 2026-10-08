// The third brain's screen calls (see api/_lib/business): what it lists, saves and forgets.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
// Sent when Eddie files something from a chat, so the screen reloads (see memory/BusinessBrain.jsx).
export const BUSINESS_CHANGED_EVENT = 'eddie:business-changed';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/business${path}`, {
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

// → { configured, nodes: [{ id, area, title, summary, status, value, amount, related, notes, updatedAt, analysis? }] }
export const listBusiness = () => call('');
export const saveBusiness = (body) => call('/save', { method: 'POST', body });
export const deleteBusiness = (id) => call('/delete', { method: 'POST', body: { id } });
export const removeBusinessNote = (id, index) => call('/note', { method: 'POST', body: { id, index } });
