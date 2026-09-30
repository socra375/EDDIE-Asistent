// Thin adapters around each AI provider's REST API.
// Both functions take a normalized shape and stream their answer out via
// an onChunk(text) callback as it's generated, instead of buffering the
// whole thing — see docs/javascript.md for why (perceived latency).
import { createToolset, intentFromMessages } from './connectors/registry.js';
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
// Groq retires models every few months (llama-3.3-70b-versatile stopped
// working on its free tier on 2026-08-16). The default is Groq's own
// recommended replacement, which supports tool calling; GROQ_MODEL overrides
// it from Vercel, and if Groq still answers "model not found", callGroq asks
// Groq for its live model list and switches on its own (see
// findAvailableGroqModel).
const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

// OpenRouter's free router picks, per request, a free model that supports
// what the request needs (tools included), so it works with no credits at
// all. OPENROUTER_MODEL (or the model picked in Configuración) overrides it
// with any model id from openrouter.ai/models.
const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';

export function defaultModelFor(provider) {
  if (provider === 'claude') return CLAUDE_DEFAULT_MODEL;
  if (provider === 'groq') return process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL;
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
  return GEMINI_DEFAULT_MODEL;
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
// safety ceiling).
const STREAM_IDLE_TIMEOUT_MS = 12000;
const STREAM_HARD_TIMEOUT_MS = 20000;

// callGemini can now make up to 4 HTTP attempts in the worst case (2 tool
// rounds + 1 forced text-only round, plus one empty-response retry spent on
// whichever round hits it first) — at STREAM_HARD_TIMEOUT_MS per attempt
// that's up to 80s, past Vercel's 60s maxDuration (see vercel.json). This is
// a wall-clock budget across the whole call: once it's spent, we fail with
// our own clear message instead of letting Vercel kill the function first
// with an opaque 504.
const OVERALL_TIME_BUDGET_MS = 45000;

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

// Gemini can ask to call one of the active connectors' tools (real time, weather…)
// instead of answering directly. When it does, we run the tool ourselves,
// hand the result back as a "function" turn, and let it try again — up to
// MAX_TOOL_ROUNDS times, so a chain of tool calls can't loop forever. Five
// lets Eddie work through a real multi-step request (look up the weather,
// search the web, then create a task…); tools asked for together run in
// parallel. Past TOOLS_CUTOFF_MS the tools are withdrawn anyway so the
// final answer still fits in the function's time budget. Groq's free tier
// counts every round's full prompt against 8K tokens a minute, so it gets
// fewer rounds.
const MAX_TOOL_ROUNDS = 5;
const GROQ_MAX_TOOL_ROUNDS = 3;
const TOOLS_CUTOFF_MS = 30000;

// Google's own quota-exceeded message is accurate but in English and full
// of jargon (RESOURCE_EXHAUSTED, links to rate-limit docs) — translate the
// one case a free-tier user will actually hit into something actionable.
function translateGeminiError(status, error, rawMessage) {
  if (status === 429 && error?.status === 'RESOURCE_EXHAUSTED') {
    return 'Se alcanzó el límite de solicitudes gratuitas de Gemini (el plan gratuito de Google permite pocas solicitudes por minuto). No es un error de Eddie: espera un minuto y vuelve a intentarlo, o activa facturación en tu proyecto de Google Cloud para un límite más alto.';
  }
  return rawMessage;
}

// Used when a request has no tools at all (every connector switched off).
const NO_TOOLS = { declarations: [], execute: async (name) => ({ error: `Herramienta desconocida: ${name}` }) };

export async function callGemini({ apiKey, model, system, messages, toolset = NO_TOOLS, onChunk }) {
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
  // model a lot of headroom (seen in practice: 4096 wasn't enough for a
  // longer explanatory answer under "explicativo" mode, which explicitly
  // asks for a step-by-step explanation and likely triggers more internal
  // reasoning than plain small talk does).
  const generationConfig = { temperature: 0.7, maxOutputTokens: 8192 };
  const systemInstruction = { role: 'system', parts: [{ text: system }] };

  // A genuinely empty response (no function call, no text) sometimes clears
  // on a plain retry of the exact same request — seen in practice even
  // though the request itself is well-formed. Retried once, outside of
  // MAX_TOOL_ROUNDS accounting, before giving up.
  let emptyRetried = false;
  const startedAt = Date.now();

  for (let round = 0; ; round += 1) {
    if (Date.now() - startedAt > OVERALL_TIME_BUDGET_MS) {
      const err = new Error('El proveedor de IA tardó demasiado en responder. Inténtalo de nuevo en unos segundos.');
      err.code = 'PROVIDER_UNAVAILABLE';
      throw err;
    }

    // Once MAX_TOOL_ROUNDS tool calls have already run, stop offering tools
    // at all instead of just ignoring a further functionCall after the fact
    // — that previously let Gemini keep "calling" a tool we'd never execute,
    // ending in the same empty-response error with no way to recover.
    // Omitting `tools` here forces a plain-text answer using whatever the
    // tool results already in `contents` gave it. Same when the user switched
    // every connector off: Gemini rejects an empty functionDeclarations list.
    const forceTextOnly = round >= MAX_TOOL_ROUNDS || toolset.declarations.length === 0 || Date.now() - startedAt > TOOLS_CUTOFF_MS;
    const body = forceTextOnly
      ? { systemInstruction, generationConfig, contents }
      : { systemInstruction, generationConfig, tools: [{ functionDeclarations: toolset.declarations }], contents };

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
      const functionCallParts = [];
      let text = '';
      let finishReason = null;
      let blockReason = null;
      let safetyRatings = null;
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
        safetyRatings = candidate?.safetyRatings || safetyRatings;
        const parts = candidate?.content?.parts || [];
        for (const part of parts) {
          if (part.functionCall) {
            functionCallParts.push(part);
          } else if (typeof part.text === 'string') {
            text += part.text;
            if (!functionCallParts.length) onChunk?.(part.text);
          }
        }
      }

      if (!functionCallParts.length || forceTextOnly) {
        if (!text) {
          // Logged server-side (visible in Vercel's function logs) instead
          // of just failing silently — the URL/apiKey are deliberately left
          // out, everything else here is Gemini's own response metadata.
          console.error(
            `[callGemini] empty response — model=${model} round=${round} finishReason=${finishReason} blockReason=${blockReason} safetyRatings=${JSON.stringify(safetyRatings)} retried=${emptyRetried}`,
          );
          if (!emptyRetried) {
            emptyRetried = true;
            round -= 1; // cancel this loop's round += 1, so the retry doesn't burn a tool round or force tools off early
            continue;
          }
          const err = new Error(describeEmptyGeminiResponse(blockReason, finishReason));
          err.code = 'PROVIDER_EMPTY';
          throw err;
        }
        return { provider: 'gemini', model };
      }

      // Gemini may ask for several tools at once ("weather and news");
      // they run in parallel and all answers go back in one turn, in order.
      const results = await Promise.all(functionCallParts.map((part) => toolset.execute(part.functionCall.name, part.functionCall.args)));

      contents = [
        ...contents,
        // Echo the whole parts back verbatim (not just { functionCall }) —
        // newer Gemini models attach a sibling `thoughtSignature` field the
        // API requires to see again on the next turn, or it errors with
        // "missing a thought_signature in functionCall parts".
        { role: 'model', parts: functionCallParts },
        // Google's own docs show role: 'function' here, but the live API
        // currently rejects it ("Role 'function' is not supported"), so we use
        // 'user' instead — a role it accepts unconditionally.
        {
          role: 'user',
          parts: functionCallParts.map((part, i) => {
            const { name } = part.functionCall;
            return { functionResponse: { name, response: { name, content: results[i] } } };
          }),
        },
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

// Gemini's tool schema uses upper-case types ("OBJECT", "STRING"); the
// OpenAI-style APIs (Groq) expect standard lower-case JSON Schema.
function toJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = { ...schema };
  if (typeof out.type === 'string') out.type = out.type.toLowerCase();
  if (out.properties) {
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  }
  if (out.items) out.items = toJsonSchema(out.items);
  return out;
}

function toOpenAITools(declarations) {
  return declarations.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: toJsonSchema(t.parameters) },
  }));
}

// Groq's free tier allows 8K tokens per minute per model and counts the
// whole request (prompt + max_tokens) against it, so a long conversation is
// rejected outright (413). The oldest turns are dropped to fit; the system
// prompt and the latest message always stay. ~3.5 characters per token is a
// deliberately pessimistic estimate for Spanish text.
const GROQ_MAX_OUTPUT_TOKENS = 3000;
const GROQ_REQUEST_TOKEN_BUDGET = 7500;

function estimateTokens(message) {
  return Math.ceil(JSON.stringify(message).length / 3.5);
}

// The tool definitions are sent with every request and count too.
function fitToGroqBudget(chat, tools) {
  const [system, ...rest] = chat;
  const budget = GROQ_REQUEST_TOKEN_BUDGET - GROQ_MAX_OUTPUT_TOKENS;
  let total = estimateTokens(system) + (tools?.length ? estimateTokens(tools) : 0);
  const kept = [];
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const cost = estimateTokens(rest[i]);
    if (kept.length > 0 && total + cost > budget) break;
    kept.unshift(rest[i]);
    total += cost;
  }
  // A tool result is only valid right after the assistant turn that asked
  // for it; never start the kept history with an orphaned one.
  while (kept.length > 1 && kept[0].role === 'tool') kept.shift();
  return [system, ...kept];
}

function groqRequestBody(model, chat, tools) {
  const body = { model, messages: fitToGroqBudget(chat, tools), stream: true, temperature: 0.7, max_tokens: GROQ_MAX_OUTPUT_TOKENS };
  // gpt-oss models reason before answering; "low" keeps replies fast and
  // leaves more of the per-minute token budget for the answer itself. Other
  // model families reject this parameter, so it's only sent to gpt-oss.
  if (model.startsWith('openai/gpt-oss')) body.reasoning_effort = 'low';
  if (tools?.length) body.tools = tools;
  return body;
}

// Preference order when the configured model is gone: exact ids first, then
// whole families (their exact names change between releases).
const GROQ_MODEL_PREFERENCES = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', /^qwen\//, /^meta-llama\/llama-4/, /^moonshotai\//];
const GROQ_NON_CHAT_MODELS = /whisper|tts|guard|embed|playai|orpheus|compound|distil/i;

// Remembers a replacement for the rest of this function instance's life, so
// only the first request after a retirement pays for the extra lookup.
const groqReplacements = new Map();

function isMissingGroqModel(status, data) {
  const code = data?.error?.code;
  return (
    status === 404 ||
    code === 'model_not_found' ||
    code === 'model_decommissioned' ||
    /does not exist|decommissioned|no longer supported/i.test(data?.error?.message || '')
  );
}

async function findAvailableGroqModel(apiKey, failedModel) {
  let res;
  try {
    res = await sharedFetchWithRetry(
      'https://api.groq.com/openai/v1/models',
      () => ({ headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(6000) }),
      { retries: 0 },
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const ids = (data?.data || [])
    .filter((m) => m?.id && m.active !== false && m.id !== failedModel && !GROQ_NON_CHAT_MODELS.test(m.id))
    .map((m) => m.id);
  for (const preference of GROQ_MODEL_PREFERENCES) {
    const match = ids.find((id) => (preference instanceof RegExp ? preference.test(id) : id === preference));
    if (match) return match;
  }
  return ids[0] || null;
}

function groqError(status, data, model) {
  let message;
  if (status === 429) {
    message = 'Se alcanzó el límite gratuito de Groq por ahora. Espera un momento y vuelve a intentarlo.';
  } else if (status === 413) {
    message = 'La conversación es demasiado larga para el límite gratuito de Groq. Empieza una conversación nueva o acorta el mensaje.';
  } else if (status === 401) {
    message = 'Groq rechazó la clave: GROQ_API_KEY no es válida o fue revocada. Revísala en Vercel.';
  } else if (isMissingGroqModel(status, data)) {
    message = `Groq ya no ofrece el modelo "${model}" y no se encontró otro disponible. Configura GROQ_MODEL en Vercel con un modelo vigente.`;
  } else {
    message = data?.error?.message || `Groq respondió con estado ${status}.`;
  }
  const err = new Error(message);
  err.code = 'PROVIDER_ERROR';
  err.status = status;
  return err;
}

// Groq and OpenRouter both speak the OpenAI Chat Completions protocol. Tool
// calls stream in as fragments (name first, then the JSON arguments piece by
// piece), so they're stitched back together by index before running them —
// same round limits and forced text-only last round as callGemini. What
// differs per service lives in a "flavor": endpoint and headers, the request
// body, how many tool rounds it can afford, and what to do about an HTTP
// error (Groq swaps a retired model; OpenRouter drops tools for a model that
// can't use them) — returning { model } or { dropTools } replays the round.
async function callOpenAICompatible(flavor, { apiKey, model, system, messages, toolset = NO_TOOLS, onChunk }) {
  if (!apiKey) {
    const err = new Error(`El proveedor ${flavor.name} no está configurado (falta ${flavor.envVar}).`);
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }

  let chat = [
    { role: 'system', content: system },
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
  ];
  const state = { model: flavor.startModel?.(model) || model, toolsOff: false, recovered: false };
  const startedAt = Date.now();
  const tools = toOpenAITools(toolset.declarations);

  for (let round = 0; ; round += 1) {
    const forceTextOnly = state.toolsOff || round >= flavor.maxToolRounds || Date.now() - startedAt > TOOLS_CUTOFF_MS || tools.length === 0;
    const body = flavor.requestBody(state.model, chat, forceTextOnly ? null : tools);

    const streamAbort = createStreamAbort();
    try {
      const res = await fetchWithRetry(flavor.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(flavor.headers?.() || {}) },
        body: JSON.stringify(body),
        signal: streamAbort.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const retry = await flavor.onHttpError({ status: res.status, data, apiKey, state, requestedModel: model });
        if (retry?.model) state.model = retry.model;
        if (retry?.dropTools) state.toolsOff = true;
        round -= 1; // the retry replays this same round
        continue;
      }

      let text = '';
      const toolCalls = [];
      for await (const payload of iterateSSE(res, () => streamAbort.touch())) {
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }
        if (data?.error) {
          const err = new Error(data.error.message || `${flavor.name} devolvió un error durante el streaming.`);
          err.code = 'PROVIDER_ERROR';
          throw err;
        }
        const delta = data?.choices?.[0]?.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          text += delta.content;
          onChunk?.(delta.content);
        }
        for (const call of delta.tool_calls || []) {
          const slot = (toolCalls[call.index ?? 0] ||= { id: '', name: '', arguments: '' });
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.arguments += call.function.arguments;
        }
      }

      const calls = toolCalls.filter((c) => c && c.name);
      if (calls.length === 0 || forceTextOnly) {
        if (!text) {
          const err = new Error(`${flavor.name} no devolvió contenido utilizable.`);
          err.code = 'PROVIDER_EMPTY';
          throw err;
        }
        return { provider: flavor.id, model: state.model };
      }

      const results = await Promise.all(
        calls.map(async (call) => {
          let args = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            // A malformed argument string just means "no arguments".
          }
          return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(await toolset.execute(call.name, args)) };
        }),
      );
      chat = [
        ...chat,
        {
          role: 'assistant',
          content: text || null,
          tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
        },
        ...results,
      ];
    } finally {
      streamAbort.clear();
    }
  }
}

const GROQ_FLAVOR = {
  id: 'groq',
  name: 'Groq',
  envVar: 'GROQ_API_KEY',
  url: 'https://api.groq.com/openai/v1/chat/completions',
  maxToolRounds: GROQ_MAX_TOOL_ROUNDS,
  startModel: (model) => groqReplacements.get(model),
  requestBody: groqRequestBody,
  async onHttpError({ status, data, apiKey, state, requestedModel }) {
    if (!state.recovered && isMissingGroqModel(status, data)) {
      state.recovered = true;
      const replacement = await findAvailableGroqModel(apiKey, state.model);
      if (replacement) {
        console.error(`[callGroq] model ${state.model} unavailable — switching to ${replacement}`);
        groqReplacements.set(requestedModel, replacement);
        return { model: replacement };
      }
    }
    throw groqError(status, data, state.model);
  },
};

export function callGroq(args) {
  return callOpenAICompatible(GROQ_FLAVOR, args);
}

// ---- OpenRouter ----
// One key, hundreds of models (openrouter.ai/models). The default is its
// free router, so Eddie works with no credits; free models allow 20 requests
// a minute and, below $10 of lifetime credits, 50 a day.
const OPENROUTER_MAX_OUTPUT_TOKENS = 4096;
const OPENROUTER_MAX_TOOL_ROUNDS = 4;

function openRouterError(status, data, model) {
  const raw = data?.error?.message || '';
  let message;
  if (status === 401) {
    message = 'OpenRouter rechazó la clave: OPENROUTER_API_KEY no es válida o fue revocada. Revísala en Vercel.';
  } else if (status === 402) {
    message = `OpenRouter no tiene créditos para el modelo "${model}". Elige un modelo gratuito (openrouter/free o uno que termine en ":free") o agrega créditos.`;
  } else if (status === 429) {
    message =
      'Se alcanzó el límite de OpenRouter (los modelos gratuitos permiten 20 solicitudes por minuto y 50 al día sin créditos). Espera un momento o agrega créditos.';
  } else if (status === 403) {
    message = 'OpenRouter bloqueó la solicitud (moderación del modelo). Reformula el mensaje o elige otro modelo.';
  } else if (status === 404) {
    message = `OpenRouter no tiene disponible el modelo "${model}" ahora mismo. Elige otro en Configuración.`;
  } else {
    message = raw || `OpenRouter respondió con estado ${status}.`;
  }
  const err = new Error(message);
  err.code = 'PROVIDER_ERROR';
  err.status = status;
  return err;
}

const OPENROUTER_FLAVOR = {
  id: 'openrouter',
  name: 'OpenRouter',
  envVar: 'OPENROUTER_API_KEY',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  maxToolRounds: OPENROUTER_MAX_TOOL_ROUNDS,
  // Optional headers that name the app on OpenRouter's side.
  headers: () => ({ 'HTTP-Referer': process.env.APP_URL || 'https://github.com/socra375/EDDIE-Asistent', 'X-Title': 'Eddie' }),
  requestBody(model, chat, tools) {
    const body = { model, messages: chat, stream: true, temperature: 0.7, max_tokens: OPENROUTER_MAX_OUTPUT_TOKENS };
    if (tools?.length) body.tools = tools;
    return body;
  },
  async onHttpError({ status, data, state }) {
    // A model with no tool support answers 404 "No endpoints found that
    // support tool use": answer without tools instead of failing.
    if ((status === 404 || status === 400) && !state.toolsOff && /tool/i.test(data?.error?.message || '')) {
      console.error(`[callOpenRouter] ${state.model} can't use tools — continuing without them`);
      return { dropTools: true };
    }
    throw openRouterError(status, data, state.model);
  },
};

export function callOpenRouter(args) {
  return callOpenAICompatible(OPENROUTER_FLAVOR, args);
}

function callSingleProvider({ provider, model, system, messages, toolset, onChunk }) {
  const resolvedModel = model || defaultModelFor(provider);
  if (provider === 'claude') {
    // Claude doesn't get the real-time tools yet — see docs/javascript.md.
    return callClaude({ apiKey: process.env.ANTHROPIC_API_KEY, model: resolvedModel, system, messages, onChunk });
  }
  if (provider === 'gemini') {
    return callGemini({ apiKey: process.env.GEMINI_API_KEY, model: resolvedModel, system, messages, toolset, onChunk });
  }
  if (provider === 'groq') {
    return callGroq({ apiKey: process.env.GROQ_API_KEY, model: resolvedModel, system, messages, toolset, onChunk });
  }
  if (provider === 'openrouter') {
    return callOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY, model: resolvedModel, system, messages, toolset, onChunk });
  }
  const err = new Error(`Proveedor desconocido: ${provider}`);
  err.code = 'BAD_REQUEST';
  throw err;
}

// Past this point the first provider has eaten too much of Vercel's 60s
// limit (vercel.json) for a second attempt to finish in time.
const FALLBACK_DEADLINE_MS = 40000;

// Who can step in when the chosen provider fails, in order: Groq (fast),
// then OpenRouter, each only if its key is set on the server.
const FALLBACKS = [
  { provider: 'groq', name: 'Groq', envVar: 'GROQ_API_KEY' },
  { provider: 'openrouter', name: 'OpenRouter', envVar: 'OPENROUTER_API_KEY' },
];

// When the chosen provider fails before saying anything (quota exceeded,
// overloaded, timeout, empty answer, missing key), the next available one
// answers instead. Once text has reached the user, switching would mix two
// answers, so a mid-stream failure is reported as-is.
// `disabledConnectors` lists the connectors the user switched off in the hub;
// their tools are never offered to the model.
// `onStep` hears every tool step as it starts and ends (see runTool).
export async function callProvider({ provider, model, system, messages, context = {}, disabledConnectors = [], onChunk, onStep }) {
  const startedAt = Date.now();
  const toolset = createToolset({ disabled: disabledConnectors, context, onStep, intent: intentFromMessages(messages) });
  const withToolOutput = (result) => ({ ...result, actions: toolset.actions, confirmations: toolset.confirmations, steps: toolset.steps });
  let started = false;
  const trackedChunk = (text) => {
    started = true;
    onChunk?.(text);
  };

  try {
    return withToolOutput(await callSingleProvider({ provider, model, system, messages, toolset, onChunk: trackedChunk }));
  } catch (firstErr) {
    let err = firstErr;
    const backups = FALLBACKS.filter((f) => f.provider !== provider && process.env[f.envVar]);
    const canTry = () => err.code !== 'BAD_REQUEST' && !started && Date.now() - startedAt < FALLBACK_DEADLINE_MS;

    for (const backup of backups) {
      if (!canTry()) break;
      console.error(`[callProvider] ${provider} failed (${firstErr.code || 'error'} ${firstErr.status || ''}): ${firstErr.message} — falling back to ${backup.name}`);
      // The backup starts over, so whatever the failed attempt's tools queued
      // (a task it created, a card to confirm) is dropped; the backup's own
      // calls queue it again if needed.
      toolset.reset();
      try {
        const result = await callSingleProvider({ provider: backup.provider, system, messages, toolset, onChunk: trackedChunk });
        return { ...withToolOutput(result), fallbackFrom: provider };
      } catch (backupErr) {
        backupErr.message = `${err.message} (El respaldo ${backup.name} también falló: ${backupErr.message})`;
        err = backupErr;
      }
    }
    throw err;
  }
}
