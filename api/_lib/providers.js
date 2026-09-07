// Thin adapters around each AI provider's REST API.
// Both functions take a normalized shape and return a normalized shape,
// so the route handler never has to know provider-specific details.

// "-latest" is Google's own rolling alias: it always resolves to Google's
// current recommended Flash/Pro model, so this never goes stale the way a
// dated snapshot id (e.g. "gemini-1.5-flash") eventually does as Google
// retires older models.
const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-5';

export function defaultModelFor(provider) {
  return provider === 'claude' ? CLAUDE_DEFAULT_MODEL : GEMINI_DEFAULT_MODEL;
}

// Both providers occasionally return a transient "model overloaded /
// high demand, try again later" response (Gemini: 503, Claude: 529) even
// though the request itself was fine. Retrying a couple of times with a
// short backoff clears most of these without the user ever seeing them.
const RETRYABLE_STATUS_CODES = [429, 503, 529];

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, options);
    if (res.ok || attempt >= retries || !RETRYABLE_STATUS_CODES.includes(res.status)) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
}

export async function callGemini({ apiKey, model, system, messages }) {
  if (!apiKey) {
    const err = new Error('El proveedor Gemini no está configurado (falta GEMINI_API_KEY).');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: system }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gemini respondió con estado ${res.status}.`);
    err.code = 'PROVIDER_ERROR';
    err.status = res.status;
    throw err;
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) {
    const err = new Error('Gemini no devolvió contenido utilizable.');
    err.code = 'PROVIDER_EMPTY';
    throw err;
  }

  return { content: text.trim(), provider: 'gemini', model };
}

export async function callClaude({ apiKey, model, system, messages }) {
  if (!apiKey) {
    const err = new Error('El proveedor Claude no está configurado (falta ANTHROPIC_API_KEY).');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const url = 'https://api.anthropic.com/v1/messages';
  const body = {
    model,
    max_tokens: 2048,
    system,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  };

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const err = new Error(data?.error?.message || `Claude respondió con estado ${res.status}.`);
    err.code = 'PROVIDER_ERROR';
    err.status = res.status;
    throw err;
  }

  const text = data?.content?.map((c) => c.text || '').join('') || '';
  if (!text) {
    const err = new Error('Claude no devolvió contenido utilizable.');
    err.code = 'PROVIDER_EMPTY';
    throw err;
  }

  return { content: text.trim(), provider: 'claude', model };
}

export async function callProvider({ provider, model, system, messages }) {
  const resolvedModel = model || defaultModelFor(provider);

  if (provider === 'claude') {
    return callClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: resolvedModel, system, messages });
  }
  if (provider === 'gemini') {
    return callGemini({ apiKey: process.env.GEMINI_API_KEY, model: resolvedModel, system, messages });
  }

  const err = new Error(`Proveedor desconocido: ${provider}`);
  err.code = 'BAD_REQUEST';
  throw err;
}
