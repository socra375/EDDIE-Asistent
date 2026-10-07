// The gallery of pictures Eddie makes (see api/_lib/media/): the calls the
// Galería screen makes to /api/connectors/media. The pictures are made on the
// server; nothing here sees an API key.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/media${path}`, {
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

export const ASPECT_OPTIONS = [
  { id: '1:1', label: 'Cuadrada (1:1)' },
  { id: '16:9', label: 'Horizontal (16:9)' },
  { id: '9:16', label: 'Vertical (9:16)' },
  { id: '4:3', label: 'Clásica (4:3)' },
  { id: '3:4', label: 'Retrato (3:4)' },
];

const UUID = /^[0-9a-f-]{36}$/i;

// The address of a picture (only its owner, signed in, can open it).
export const mediaUrl = (id) => (UUID.test(String(id || '')) ? `${API_BASE}/api/connectors/media/file?id=${encodeURIComponent(id)}` : '');

const ctx = () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

// { configured, items: [{ id, prompt, mime, bytes, provider, parentId, createdAt }], limits }
export const listMedia = () => call('');
// → { item, usedFallback, limits } (takes ~10–30 s). `mirror` also sends it to Telegram.
export const createMedia = ({ prompt, aspect, mirror }) => call('/create', { method: 'POST', body: { prompt, aspect, mirror, ...ctx() } });
export const editMedia = ({ id, instruction, mirror }) => call('/edit', { method: 'POST', body: { id, instruction, mirror, ...ctx() } });
export const deleteMedia = (id) => call('/delete', { method: 'POST', body: { id } });
