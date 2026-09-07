// Thin adapters around each AI provider's REST API.
// Both functions take a normalized shape and return a normalized shape,
// so the route handler never has to know provider-specific details.
import { TOOL_DECLARATIONS, executeTool } from './tools.js';

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
// 429 is deliberately NOT in this list: Gemini's free tier uses it for
// per-minute quota exhaustion, which needs tens of seconds to clear — a
// ~1s retry can't fix that, and only burns more of an already-scarce quota.
const RETRYABLE_STATUS_CODES = [503, 529];

async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, options);
    if (res.ok || attempt >= retries || !RETRYABLE_STATUS_CODES.includes(res.status)) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
}

// Gemini can ask to call one of TOOL_DECLARATIONS (real current time/weather)
// instead of answering directly. When it does, we run the tool ourselves,
// hand the result back as a "function" turn, and let it try again — up to
// MAX_TOOL_ROUNDS times, so a chain of tool calls can't loop forever.
const MAX_TOOL_ROUNDS = 3;

// Google's own quota-exceeded message is accurate but in English and full
// of jargon (RESOURCE_EXHAUSTED, links to rate-limit docs) — translate the
// one case a free-tier user will actually hit into something actionable.
function translateGeminiError(status, error, rawMessage) {
  if (status === 429 && error?.status === 'RESOURCE_EXHAUSTED') {
    return 'Se alcanzó el límite de solicitudes gratuitas de Gemini (el plan gratuito de Google permite pocas solicitudes por minuto). No es un error de Eddie: espera un minuto y vuelve a intentarlo, o activa facturación en tu proyecto de Google Cloud para un límite más alto.';
  }
  return rawMessage;
}

export async function callGemini({ apiKey, model, system, messages, context = {} }) {
  if (!apiKey) {
    const err = new Error('El proveedor Gemini no está configurado (falta GEMINI_API_KEY).');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const baseBody = {
    systemInstruction: { role: 'system', parts: [{ text: system }] },
    tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  };

  for (let round = 0; ; round += 1) {
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...baseBody, contents }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const rawMessage = data?.error?.message || `Gemini respondió con estado ${res.status}.`;
      const err = new Error(translateGeminiError(res.status, data?.error, rawMessage));
      err.code = 'PROVIDER_ERROR';
      err.status = res.status;
      throw err;
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const functionCallPart = parts.find((p) => p.functionCall);

    if (!functionCallPart || round >= MAX_TOOL_ROUNDS) {
      const text = parts.map((p) => p.text || '').join('');
      if (!text) {
        const err = new Error('Gemini no devolvió contenido utilizable.');
        err.code = 'PROVIDER_EMPTY';
        throw err;
      }
      return { content: text.trim(), provider: 'gemini', model };
    }

    const { name, args } = functionCallPart.functionCall;
    const toolResult = await executeTool(name, args, context);

    contents = [
      ...contents,
      // Echo the whole part back verbatim (not just { functionCall }) —
      // newer Gemini models attach a sibling `thoughtSignature` field the
      // API requires to see again on the next turn, or it errors with
      // "missing a thought_signature in functionCall parts".
      { role: 'model', parts: [functionCallPart] },
      // Google's own docs show role: 'function' here, but the live API
      // currently rejects it ("Role 'function' is not supported"), so we use
      // 'user' instead — a role it accepts unconditionally.
      { role: 'user', parts: [{ functionResponse: { name, response: { name, content: toolResult } } }] },
    ];
  }
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

export async function callProvider({ provider, model, system, messages, context }) {
  const resolvedModel = model || defaultModelFor(provider);

  if (provider === 'claude') {
    // Claude doesn't get the real-time tools yet (Gemini-only for now) — see docs/javascript.md.
    return callClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: resolvedModel, system, messages });
  }
  if (provider === 'gemini') {
    return callGemini({ apiKey: process.env.GEMINI_API_KEY, model: resolvedModel, system, messages, context });
  }

  const err = new Error(`Proveedor desconocido: ${provider}`);
  err.code = 'BAD_REQUEST';
  throw err;
}
