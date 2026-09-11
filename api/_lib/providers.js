// Thin adapters around each AI provider's REST API.
// Both functions take a normalized shape and stream their answer out via
// an onChunk(text) callback as it's generated, instead of buffering the
// whole thing — see docs/javascript.md for why (perceived latency).
import { TOOL_DECLARATIONS, executeTool } from './tools.js';
import { fetchWithRetry as sharedFetchWithRetry } from './fetchWithRetry.js';

// "-latest" is Google's own rolling alias: it always resolves to Google's
// current recommended Flash/Pro/Flash-Lite model, so this never goes stale
// the way a dated snapshot id (e.g. "gemini-1.5-flash") eventually does as
// Google retires older models.
//
// Flash-Lite is the default rather than plain Flash because its free-tier
// quota is far more generous (1,500 requests/day vs. the ~20/minute cap
// that plain Flash hit in practice) — see PROVIDER_MODELS in
// SettingsPanel.jsx for the other options a user can pick instead.
const GEMINI_DEFAULT_MODEL = 'gemini-flash-lite-latest';
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

async function fetchWithRetry(url, options, retries = 1) {
  try {
    return await sharedFetchWithRetry(url, options, { retries, retryableStatusCodes: RETRYABLE_STATUS_CODES });
  } catch (err) {
    const timeoutErr = new Error('El proveedor de IA tardó demasiado en responder. Inténtalo de nuevo en unos segundos.');
    timeoutErr.code = 'PROVIDER_UNAVAILABLE';
    timeoutErr.cause = err;
    throw timeoutErr;
  }
}

// A hung upstream connection previously had no ceiling — it could sit there
// until Vercel's own function timeout killed the whole request, surfacing
// as an opaque "server responded with error (504)" instead of a clean,
// actionable message. Now that responses stream, a single fixed deadline
// would also cut off a long-but-healthy answer, so instead we track two
// independent limits per HTTP attempt: abort if no new data arrives for
// STREAM_IDLE_TIMEOUT_MS (a genuinely dead connection), or if the attempt
// runs past STREAM_HARD_TIMEOUT_MS in total regardless of activity (a
// safety ceiling). With MAX_TOOL_ROUNDS = 2, two rounds at the hard limit
// plus one tool-fetch comfortably fit inside Vercel's 60s maxDuration
// (see vercel.json).
const STREAM_IDLE_TIMEOUT_MS = 12000;
const STREAM_HARD_TIMEOUT_MS = 20000;

function createStreamAbort() {
  const controller = new AbortController();
  const abort = () => controller.abort(new DOMException('Tiempo de espera agotado.', 'TimeoutError'));
  let idleTimer = setTimeout(abort, STREAM_IDLE_TIMEOUT_MS);
  const hardTimer = setTimeout(abort, STREAM_HARD_TIMEOUT_MS);
  return {
    signal: controller.signal,
    touch() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(abort, STREAM_IDLE_TIMEOUT_MS);
    },
    clear() {
      clearTimeout(idleTimer);
      clearTimeout(hardTimer);
    },
  };
}

// Both Gemini and Claude stream their response as Server-Sent Events —
// lines starting with "data: ", events separated by a blank line. Yields
// each event's raw JSON payload (skipping Anthropic's "event: ..." lines
// and OpenAI-style "[DONE]" sentinels, neither of which either provider's
// SSE stream strictly needs parsed here). Calls onActivity() on every raw
// read so the caller can reset an idle timeout.
async function* iterateSSE(res, onActivity) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity?.();
      buffer += decoder.decode(value, { stream: true });
      let sepIndex;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload && payload !== '[DONE]') yield payload;
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }
}

// Gemini can ask to call one of TOOL_DECLARATIONS (real current time/weather)
// instead of answering directly. When it does, we run the tool ourselves,
// hand the result back as a "function" turn, and let it try again — up to
// MAX_TOOL_ROUNDS times, so a chain of tool calls can't loop forever. Kept
// low (our two tools never legitimately need a 3rd round) since each round
// is a full extra network round-trip against the function's time budget.
const MAX_TOOL_ROUNDS = 2;

// Google's own quota-exceeded message is accurate but in English and full
// of jargon (RESOURCE_EXHAUSTED, links to rate-limit docs) — translate the
// one case a free-tier user will actually hit into something actionable.
function translateGeminiError(status, error, rawMessage) {
  if (status === 429 && error?.status === 'RESOURCE_EXHAUSTED') {
    return 'Se alcanzó el límite de solicitudes gratuitas de Gemini (el plan gratuito de Google permite pocas solicitudes por minuto). No es un error de Eddie: espera un minuto y vuelve a intentarlo, o activa facturación en tu proyecto de Google Cloud para un límite más alto.';
  }
  return rawMessage;
}

export async function callGemini({ apiKey, model, system, messages, context = {}, onChunk }) {
  if (!apiKey) {
    const err = new Error('El proveedor Gemini no está configurado (falta GEMINI_API_KEY).');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
  let contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // These "-latest" models have thinking enabled internally, and its tokens
  // count against maxOutputTokens — a short chat reply can end up entirely
  // consumed by invisible thinking, leaving finishReason: MAX_TOKENS and no
  // visible text at all ("Gemini no devolvió contenido utilizable."). We'd
  // rather disable thinking outright (thinkingBudget: 0), but the exact
  // config field/shape for it isn't stable across model snapshots behind
  // the "-latest" alias — sending the wrong one made Gemini reject every
  // request with "Request contains an invalid argument" instead, which is
  // strictly worse than the original bug. So instead we just give every
  // model more headroom, generous enough that thinking is unlikely to
  // consume the whole budget before an answer is produced.
  const generationConfig = { temperature: 0.7, maxOutputTokens: 4096 };
  const systemInstruction = { role: 'system', parts: [{ text: system }] };

  for (let round = 0; ; round += 1) {
    // Once MAX_TOOL_ROUNDS tool calls have already run, stop offering tools
    // at all instead of just ignoring a further functionCall after the fact
    // — that previously let Gemini keep "calling" a tool we'd never execute,
    // ending in the same empty-response error with no way to recover.
    // Omitting `tools` here forces a plain-text answer using whatever the
    // tool results already in `contents` gave it.
    const forceTextOnly = round >= MAX_TOOL_ROUNDS;
    const body = forceTextOnly
      ? { systemInstruction, generationConfig, contents }
      : { systemInstruction, generationConfig, tools: [{ functionDeclarations: TOOL_DECLARATIONS }], contents };

    const streamAbort = createStreamAbort();
    let res;
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: streamAbort.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const rawMessage = data?.error?.message || `Gemini respondió con estado ${res.status}.`;
        const err = new Error(translateGeminiError(res.status, data?.error, rawMessage));
        err.code = 'PROVIDER_ERROR';
        err.status = res.status;
        throw err;
      }

      // Gemini doesn't stream a function call token-by-token — it arrives
      // whole in one event. Only the last round (no function call at all)
      // is meant for the user, so we only forward chunks once we're not
      // aware of a pending function call yet this round.
      let functionCallPart = null;
      let text = '';
      let finishReason = null;
      let blockReason = null;
      for await (const payload of iterateSSE(res, () => streamAbort.touch())) {
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        blockReason = data?.promptFeedback?.blockReason || blockReason;
        const candidate = data?.candidates?.[0];
        finishReason = candidate?.finishReason || finishReason;
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part.functionCall) {
            functionCallPart = part;
          } else if (typeof part.text === 'string') {
            text += part.text;
            if (!functionCallPart) onChunk?.(part.text);
          }
        }
      }

      if (!functionCallPart || forceTextOnly) {
        if (!text) {
          const err = new Error(describeEmptyGeminiResponse(blockReason, finishReason));
          err.code = 'PROVIDER_EMPTY';
          throw err;
        }
        return { provider: 'gemini', model };
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
    } finally {
      streamAbort.clear();
    }
  }
}

function describeEmptyGeminiResponse(blockReason, finishReason) {
  if (blockReason || finishReason === 'SAFETY' || finishReason === 'RECITATION') {
    return 'Gemini bloqueó la respuesta por sus políticas de contenido. Intenta reformular tu mensaje.';
  }
  if (finishReason === 'MAX_TOKENS') {
    return 'Gemini alcanzó su límite de tokens antes de generar una respuesta visible. Intenta con un mensaje más corto o vuelve a intentarlo.';
  }
  return 'Gemini no devolvió contenido utilizable. Inténtalo de nuevo.';
}

export async function callClaude({ apiKey, model, system, messages, onChunk }) {
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
    stream: true,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  };

  const streamAbort = createStreamAbort();
  try {
    const res = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: streamAbort.signal,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error(data?.error?.message || `Claude respondió con estado ${res.status}.`);
      err.code = 'PROVIDER_ERROR';
      err.status = res.status;
      throw err;
    }

    let text = '';
    for await (const payload of iterateSSE(res, () => streamAbort.touch())) {
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        text += data.delta.text;
        onChunk?.(data.delta.text);
      } else if (data?.type === 'error') {
        const err = new Error(data.error?.message || 'Claude devolvió un error durante el streaming.');
        err.code = 'PROVIDER_ERROR';
        throw err;
      }
    }

    if (!text) {
      const err = new Error('Claude no devolvió contenido utilizable.');
      err.code = 'PROVIDER_EMPTY';
      throw err;
    }

    return { provider: 'claude', model };
  } finally {
    streamAbort.clear();
  }
}

export async function callProvider({ provider, model, system, messages, context, onChunk }) {
  const resolvedModel = model || defaultModelFor(provider);

  if (provider === 'claude') {
    // Claude doesn't get the real-time tools yet (Gemini-only for now) — see docs/javascript.md.
    return callClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: resolvedModel, system, messages, onChunk });
  }
  if (provider === 'gemini') {
    return callGemini({ apiKey: process.env.GEMINI_API_KEY, model: resolvedModel, system, messages, context, onChunk });
  }

  const err = new Error(`Proveedor desconocido: ${provider}`);
  err.code = 'BAD_REQUEST';
  throw err;
}
