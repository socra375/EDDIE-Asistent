// Talks to our own backend only — the frontend never holds provider API keys.
// VITE_API_BASE_URL lets a statically-hosted frontend (e.g. GitHub Pages)
// point at a backend deployed elsewhere; it defaults to a relative path,
// which is what you want when frontend and API share the same Vercel deploy.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class EddieApiError extends Error {}

export async function sendChatMessage({ provider, model, system, messages, context }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, system, messages, context }),
    });
  } catch {
    throw new EddieApiError('No se pudo contactar al servidor de Eddie. Verifica tu conexión.');
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // ignore, handled below
  }

  if (!res.ok) {
    throw new EddieApiError(data?.error || `El servidor respondió con un error (${res.status}).`);
  }

  return data;
}
