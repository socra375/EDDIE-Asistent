// Talks to our own backend only — the frontend never holds provider API keys.
// VITE_API_BASE_URL lets a statically-hosted frontend (e.g. GitHub Pages)
// point at a backend deployed elsewhere; it defaults to a relative path,
// which is what you want when frontend and API share the same Vercel deploy.

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export class EddieApiError extends Error {}

// The response streams as newline-delimited JSON — see api/_lib/chatStream.js
// for the wire format. onChunk(fullTextSoFar) fires as each piece arrives so
// the caller can render the answer live instead of waiting for it to finish.
// onStep(step) fires each time a tool call starts or changes state — the
// "receipt" of what Eddie is doing ({ id, tool, label, activity, status,
// summary, verified, detail }); the same id arrives again as it finishes.
export async function sendChatMessage({ provider, model, system, messages, context, disabledConnectors, onChunk, onStep }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, system, messages, context, disabledConnectors }),
    });
  } catch {
    throw new EddieApiError('No se pudo contactar al servidor de Eddie. Verifica tu conexión.');
  }

  if (!res.ok) {
    // Failed before any streaming started (validation, missing key, quota,
    // etc.) — a normal JSON error body, same as before streaming existed.
    let data = null;
    try {
      data = await res.json();
    } catch {
      // ignore, handled below
    }
    throw new EddieApiError(data?.error || `El servidor respondió con un error (${res.status}).`);
  }

  if (!res.body) {
    throw new EddieApiError('Este navegador no admite respuestas en streaming.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let meta = { provider, model };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (event.type === 'chunk') {
        content += event.text;
        onChunk?.(content);
      } else if (event.type === 'done') {
        meta = {
          provider: event.provider,
          model: event.model,
          fallbackFrom: event.fallbackFrom,
          actions: event.actions || [],
          confirmations: event.confirmations || [],
          steps: event.steps || [],
        };
      } else if (event.type === 'step') {
        onStep?.({ ...event, type: undefined });
      } else if (event.type === 'error') {
        throw new EddieApiError(event.message);
      }
    }
  }

  return { content, ...meta };
}

// Runs an action the user confirmed on a card (see api/_lib/confirm.js).
// Resolves to { result, actions }; throws EddieApiError with the reason.
export async function confirmAction({ tool, args, context, disabledConnectors }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/chat?action=confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool, args, context, disabledConnectors }),
    });
  } catch {
    throw new EddieApiError('No se pudo contactar al servidor de Eddie. Verifica tu conexión.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new EddieApiError(data?.error || `No se pudo completar la acción (${res.status}).`);
  return { result: data?.result || {}, actions: data?.actions || [] };
}
