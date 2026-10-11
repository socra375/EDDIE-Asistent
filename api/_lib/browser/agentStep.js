// One step of a browser task: given a screenshot of the tab and the goal,
// decide exactly one next action — never more, never a whole plan — so the
// extension can act, take a fresh screenshot, and ask again. Same shape as
// vision.js's analyzeFrame (image in, a fixed JSON shape out, Gemini → Groq →
// Claude in order), because it's the same problem: an untrusted model answer,
// cut down to a strict schema before anything downstream trusts it.
import { nextThinking, rejectsThinking, thinkingFor } from '../geminiThinking.js';
import { fetchWithRetry } from '../fetchWithRetry.js';
import { parseSceneText } from '../vision.js';

const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REQUEST_TIMEOUT_MS = 25000;
const MAX_HISTORY = 6;

export const ACTIONS = ['click', 'type', 'key', 'scroll', 'done', 'blocked'];
export const KEYS = ['Enter', 'Tab', 'Escape', 'Backspace'];

function stepError(message, status, code = 'STEP_ERROR') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function promptFor(goal, history, width, height, messagingSafe) {
  const recent = history.slice(-MAX_HISTORY);
  return `Eres el piloto de una tarea de navegador para el asistente Eddie: controlas UNA pestaña, paso a paso, para cumplir el objetivo del usuario.
Objetivo: "${goal}"
La imagen es una captura de la pestaña activa ahora mismo, de ${width}x${height} píxeles.
Últimos pasos (el más reciente al final): ${recent.length ? recent.join(' · ') : '(ninguno todavía, es el primer paso)'}

Decide EXACTAMENTE una acción, la mínima para avanzar. Devuelve SOLO un JSON con:
- action: "click" | "type" | "key" | "scroll" | "done" | "blocked"
- x, y: enteros en píxeles de la imagen, el punto exacto donde hacer clic o desplazar (solo para click y scroll)
- text: el texto exacto a escribir, nada más (solo para type; antes haz click en el campo en un paso previo)
- key: una de ${KEYS.join(', ')} (solo para key)
- deltaY: cuánto desplazar verticalmente en píxeles, positivo hacia abajo (solo para scroll)
- reason: una frase muy corta en español de qué haces y por qué

Usa "done" solo cuando el objetivo ya se ve cumplido en la imagen. Usa "blocked" (y explica el motivo en reason, sin inventar datos) si la pantalla pide una contraseña, iniciar sesión, datos de pago o cualquier dato personal del usuario: nunca hagas clic ni escribas ahí, para eso el usuario tiene que hacerlo él mismo.${
    messagingSafe
      ? `
Esta página es una red social o app de mensajería (Instagram, WhatsApp, Messenger…). Puedes leer lo que hay en pantalla y escribir (type) una respuesta en el cuadro de mensaje, pero NUNCA la envíes tú: no hagas clic en ningún botón de enviar ni pulses la tecla Enter dentro del campo de mensaje. En cuanto termines de escribir la respuesta, responde "done" (en reason, copia la respuesta que escribiste) para que el usuario la revise y la envíe él mismo. Si el objetivo pide vigilar la conversación o contestar mensajes de forma continua o automática, responde "blocked" explicando que esto solo redacta una respuesta por tarea confirmada.`
      : ''
  }`;
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ACTIONS },
    x: { type: 'NUMBER' },
    y: { type: 'NUMBER' },
    text: { type: 'STRING' },
    key: { type: 'STRING', enum: KEYS },
    deltaY: { type: 'NUMBER' },
    reason: { type: 'STRING' },
  },
  required: ['action', 'reason'],
};

const clip = (value, max) => String(value ?? '').replace(/[\p{Cc}<>]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const finiteInt = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)) : null);

// Whatever the model answered → a safe, fixed shape. An action missing what
// it needs (no x/y for a click, no text for a type…) falls back to "blocked":
// better a stalled task than a click or keystroke aimed at nothing.
export function normalizeAction(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const reason = clip(source.reason, 160);
  const action = ACTIONS.includes(source.action) ? source.action : 'blocked';
  const base = { action, reason: reason || 'Sin motivo dado.' };
  if (action === 'click') {
    const x = finiteInt(source.x);
    const y = finiteInt(source.y);
    if (x == null || y == null) return { action: 'blocked', reason: 'No dio dónde hacer clic.' };
    return { ...base, x, y };
  }
  if (action === 'scroll') {
    const x = finiteInt(source.x) ?? 0;
    const y = finiteInt(source.y) ?? 0;
    const deltaY = finiteInt(source.deltaY);
    if (deltaY == null) return { action: 'blocked', reason: 'No dio cuánto desplazar.' };
    return { ...base, x, y, deltaY: Math.max(-4000, Math.min(4000, deltaY)) };
  }
  if (action === 'type') {
    const text = clip(source.text, 500);
    if (!text) return { action: 'blocked', reason: 'No dio qué escribir.' };
    return { ...base, text };
  }
  if (action === 'key') {
    if (!KEYS.includes(source.key)) return { action: 'blocked', reason: 'Pidió una tecla no permitida.' };
    return { ...base, key: source.key };
  }
  return base; // done | blocked: reason is all they carry
}

async function callGeminiStep(image, prompt, { apiKey, model }) {
  const thinking = thinkingFor(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchWithRetry(
    url,
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.data } }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1024, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, ...thinking },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    { retries: 1, retryableStatusCodes: [500, 502, 503] },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (rejectsThinking(res.status, data?.error?.message) && 'thinkingConfig' in thinking && nextThinking(model)) return callGeminiStep(image, prompt, { apiKey, model });
    if (res.status === 429) throw stepError('Se alcanzó el límite de solicitudes de Gemini.', 429, 'RATE_LIMITED');
    throw stepError(data?.error?.message || `Gemini respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'STEP_ERROR');
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseSceneText(text);
}

async function callGroqStep(image, prompt, { apiKey, model }) {
  const res = await fetchWithRetry(
    'https://api.groq.com/openai/v1/chat/completions',
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: 600,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${prompt}\nResponde únicamente con el JSON, sin texto antes ni después.` },
              { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    { retries: 1, retryableStatusCodes: [500, 502, 503] },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) throw stepError('Se alcanzó el límite de solicitudes de Groq.', 429, 'RATE_LIMITED');
    throw stepError(data?.error?.message || `Groq respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'STEP_ERROR');
  }
  return parseSceneText(data?.choices?.[0]?.message?.content || '');
}

async function callClaudeStep(image, prompt, { apiKey, model }) {
  const res = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
              { type: 'text', text: `${prompt}\nResponde únicamente con el JSON, sin texto antes ni después.` },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    { retries: 1, retryableStatusCodes: [500, 502, 503, 529] },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 429) throw stepError('Se alcanzó el límite de solicitudes de Claude.', 429, 'RATE_LIMITED');
    throw stepError(data?.error?.message || `Claude respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'STEP_ERROR');
  }
  const text = (data?.content || []).map((p) => p.text || '').join('');
  return parseSceneText(text);
}

// The last drafted reply in the history the extension sent back, so a reply
// Eddie is stopped from sending (see decideNextAction below) can still tell
// the user what it wrote instead of just "I stopped".
function lastDraftedReply(history) {
  const entry = [...history].reverse().find((h) => /^type:\s*"/.test(h));
  if (!entry) return null;
  const text = entry.replace(/^type:\s*"/, '').replace(/"$/, '');
  return text || null;
}

// One screenshot + the goal → one normalized action. Tries, in order, the
// providers that are set up: Gemini, Groq (free, vision), Claude.
export async function decideNextAction(image, { goal, history = [], width, height, messagingSafe = false }, env = process.env) {
  const prompt = promptFor(goal, history, width || 0, height || 0, messagingSafe);
  const providers = [];
  if (env.GEMINI_API_KEY) providers.push({ id: 'gemini', apiKey: env.GEMINI_API_KEY, model: env.GEMINI_VISION_MODEL || DEFAULT_GEMINI_MODEL, call: callGeminiStep });
  if (env.GROQ_API_KEY) providers.push({ id: 'groq', apiKey: env.GROQ_API_KEY, model: env.GROQ_VISION_MODEL || DEFAULT_GROQ_MODEL, call: callGroqStep });
  if (env.ANTHROPIC_API_KEY) providers.push({ id: 'claude', apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_VISION_MODEL || DEFAULT_CLAUDE_MODEL, call: callClaudeStep });
  if (!providers.length) throw stepError('La automatización del navegador necesita GEMINI_API_KEY, GROQ_API_KEY o ANTHROPIC_API_KEY en el servidor.', 503, 'NOT_CONFIGURED');
  let firstError = null;
  for (const [i, provider] of providers.entries()) {
    try {
      const raw = await provider.call(image, prompt, { apiKey: provider.apiKey, model: provider.model });
      const decision = { ...normalizeAction(raw), provider: provider.id, model: provider.model };
      // Belt and suspenders: even if the model ignores the instruction above,
      // Eddie itself never submits a message on a messaging site — pressing
      // Enter in a compose box is how almost every one of them sends.
      if (messagingSafe && decision.action === 'key' && decision.key === 'Enter') {
        const drafted = lastDraftedReply(history);
        return {
          provider: decision.provider,
          model: decision.model,
          action: 'done',
          reason: drafted ? `Escribí esta respuesta y la dejé sin enviar para que la revises: "${drafted}"` : 'Escribí una respuesta y la dejé sin enviar para que la revises y la envíes tú mismo.',
        };
      }
      return decision;
    } catch (err) {
      const next = i < providers.length - 1;
      const retryable = err.code === 'RATE_LIMITED' || err.code === 'UPSTREAM' || err.name === 'TimeoutError' || err.name === 'TypeError';
      if (!next || !retryable) throw firstError && err.code !== 'RATE_LIMITED' ? firstError : err;
      firstError ||= err;
    }
  }
  throw firstError;
}
