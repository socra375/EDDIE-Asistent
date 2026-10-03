// "Modo Vigilancia": the browser sends one camera frame at a time
// (POST /api/chat?action=vision) and gets back what is in it — objects,
// people, animals and materials — as plain data. Nothing is stored.
//
// The answer of the model is treated as untrusted: it is cut down to a fixed
// shape (a few short labels, categories from a list, numbers in range) before
// it reaches the page, which only ever shows it as text.
import { nextThinking, rejectsThinking, thinkingFor } from './geminiThinking.js';
import { sanitizeImages } from './images.js';
import { fetchWithRetry } from './fetchWithRetry.js';
import { createRateLimiter, tooMany } from './rateLimit.js';
import { isTrustedRequest } from './requestGuard.js';

export const VISION_CATEGORIES = ['persona', 'animal', 'objeto', 'material', 'vehículo', 'otro'];
const MAX_OBJECTS = 12;
const MAX_LABEL = 40;
const MAX_DETAIL = 90;
const MAX_SUMMARY = 160;
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
// Free on Groq's plan, and it takes images. If Groq retires it, another vision
// model from their list is found and used instead (see findGroqVisionModel).
const DEFAULT_GROQ_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GROQ_VISION_PREFERENCE = [/llama-4-scout/i, /llama-4-maverick/i, /vision/i, /llama-4/i];
const REQUEST_TIMEOUT_MS = 25000;
const DEFAULT_PER_MINUTE = 20;

const PROMPT = `Eres el sistema de visión de Eddie y analizas un fotograma de una cámara.
Devuelve SOLO un JSON con:
- summary: una frase corta (máx. 140 caracteres) de lo que se ve.
- objects: lista de lo que se distingue (máx. 12), agrupando lo repetido con count. Cada elemento: label (nombre corto en español), category (persona | animal | objeto | material | vehículo | otro), count (entero), material (el material principal si se distingue: vidrio, madera, metal, plástico, tela, papel, cerámica, piedra, cuero, otro; si no, vacío), detail (máx. 80 caracteres), confidence (0 a 1) y box ([ymin, xmin, ymax, xmax], enteros de 0 a 1000).
Para las personas usa label "persona" y en detail lo que hacen y la ropa visible. Para los animales, la especie en label.
No identifiques a nadie por su rostro ni deduzcas nombre, edad, etnia, salud o emociones. Si la imagen está oscura o borrosa, dilo en summary y lista solo lo que se distinga.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    objects: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          category: { type: 'STRING', enum: VISION_CATEGORIES },
          count: { type: 'INTEGER' },
          material: { type: 'STRING' },
          detail: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          box: { type: 'ARRAY', items: { type: 'INTEGER' } },
        },
        required: ['label', 'category'],
      },
    },
  },
  required: ['summary', 'objects'],
};

function visionError(message, status, code = 'VISION_ERROR') {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\p{Cc}<>]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function normalizeBox(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const [ymin, xmin, ymax, xmax] = raw.map((v) => clamp(Math.round(Number(v)), 0, 1000));
  if ([ymin, xmin, ymax, xmax].some((v) => !Number.isFinite(v)) || ymax - ymin < 5 || xmax - xmin < 5) return undefined;
  return [ymin, xmin, ymax, xmax];
}

// Whatever the model sent → { summary, objects } in the fixed shape.
export function normalizeScene(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(source.objects) ? source.objects : [];
  const objects = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const label = clean(item.label, MAX_LABEL);
    if (!label) continue;
    const category = VISION_CATEGORIES.includes(item.category) ? item.category : 'otro';
    const count = clamp(Math.round(Number(item.count)) || 1, 1, 99);
    const confidence = Number.isFinite(Number(item.confidence)) ? clamp(Number(item.confidence), 0, 1) : 0.5;
    const object = { label, category, count, confidence: Math.round(confidence * 100) / 100 };
    const material = clean(item.material, MAX_LABEL);
    if (material) object.material = material;
    const detail = clean(item.detail, MAX_DETAIL);
    if (detail) object.detail = detail;
    const box = normalizeBox(item.box);
    if (box) object.box = box;
    objects.push(object);
    if (objects.length >= MAX_OBJECTS) break;
  }
  return { summary: clean(source.summary, MAX_SUMMARY), objects };
}

// The model's text → JSON, tolerating ``` fences and text around the object.
export function parseSceneText(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw visionError('La visión no devolvió un resultado legible.', 502);
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw visionError('La visión devolvió un resultado dañado. Se reintentará en el próximo análisis.', 502);
  }
}

async function callGeminiVision(image, { apiKey, model }) {
  // As little invisible thinking as the model allows: the picture is waiting (see geminiThinking.js).
  const thinking = thinkingFor(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetchWithRetry(
    url,
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inline_data: { mime_type: image.mimeType, data: image.data } }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, ...thinking },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    { retries: 1, retryableStatusCodes: [500, 502, 503] },
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (rejectsThinking(res.status, data?.error?.message) && 'thinkingConfig' in thinking && nextThinking(model)) return callGeminiVision(image, { apiKey, model });
    if (res.status === 429) throw visionError('Se alcanzó el límite de solicitudes de Gemini para la visión. Eddie lo reintenta enseguida.', 429, 'RATE_LIMITED');
    throw visionError(data?.error?.message || `Gemini respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'VISION_ERROR');
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return parseSceneText(text);
}

const groqReplacements = new Map();

function isMissingGroqModel(status, data) {
  const code = data?.error?.code;
  return status === 404 || code === 'model_not_found' || code === 'model_decommissioned' || /does not exist|decommissioned|no longer supported|not support/i.test(data?.error?.message || '');
}

async function findGroqVisionModel(apiKey, failedModel) {
  try {
    const res = await fetchWithRetry('https://api.groq.com/openai/v1/models', () => ({ headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(6000) }), { retries: 0 });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const ids = (data?.data || []).filter((m) => m?.id && m.active !== false && m.id !== failedModel).map((m) => m.id);
    for (const preference of GROQ_VISION_PREFERENCE) {
      const match = ids.find((id) => preference.test(id));
      if (match) return match;
    }
  } catch {
    // No list, no replacement.
  }
  return null;
}

async function callGroqVision(image, { apiKey, model }, retried = false) {
  const useModel = groqReplacements.get(model) || model;
  const res = await fetchWithRetry(
    'https://api.groq.com/openai/v1/chat/completions',
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: useModel,
        temperature: 0.2,
        max_completion_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${PROMPT}\nResponde únicamente con el JSON, sin texto antes ni después.` },
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
    if (!retried && isMissingGroqModel(res.status, data)) {
      const replacement = await findGroqVisionModel(apiKey, useModel);
      if (replacement) {
        groqReplacements.set(model, replacement);
        return callGroqVision(image, { apiKey, model }, true);
      }
    }
    if (res.status === 429) throw visionError('Se alcanzó el límite de solicitudes de Groq para la visión.', 429, 'RATE_LIMITED');
    throw visionError(data?.error?.message || `Groq respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'VISION_ERROR');
  }
  return parseSceneText(data?.choices?.[0]?.message?.content || '');
}

async function callClaudeVision(image, { apiKey, model }) {
  const res = await fetchWithRetry(
    'https://api.anthropic.com/v1/messages',
    () => ({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
              { type: 'text', text: `${PROMPT}\nResponde únicamente con el JSON, sin texto antes ni después.` },
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
    if (res.status === 429) throw visionError('Se alcanzó el límite de solicitudes de Claude para la visión.', 429, 'RATE_LIMITED');
    throw visionError(data?.error?.message || `Claude respondió con estado ${res.status}.`, res.status >= 500 ? 502 : 400, res.status >= 500 ? 'UPSTREAM' : 'VISION_ERROR');
  }
  const text = (data?.content || []).map((p) => p.text || '').join('');
  return parseSceneText(text);
}

// One frame → { summary, objects, provider, model }. Tries, in order, the
// providers that are set up: Gemini, Groq (free, Llama 4 with vision) and Claude.
// When one is busy, down or retired the next one answers.
export async function analyzeFrame(image, env = process.env) {
  const providers = [];
  if (env.GEMINI_API_KEY) providers.push({ id: 'gemini', apiKey: env.GEMINI_API_KEY, model: env.GEMINI_VISION_MODEL || DEFAULT_GEMINI_MODEL, call: callGeminiVision });
  if (env.GROQ_API_KEY) providers.push({ id: 'groq', apiKey: env.GROQ_API_KEY, model: env.GROQ_VISION_MODEL || DEFAULT_GROQ_MODEL, call: callGroqVision });
  if (env.ANTHROPIC_API_KEY) providers.push({ id: 'claude', apiKey: env.ANTHROPIC_API_KEY, model: env.CLAUDE_VISION_MODEL || DEFAULT_CLAUDE_MODEL, call: callClaudeVision });
  if (!providers.length) {
    throw visionError('La visión por IA necesita GEMINI_API_KEY, GROQ_API_KEY (gratis) o ANTHROPIC_API_KEY en las variables de entorno de Vercel.', 503, 'NOT_CONFIGURED');
  }
  let firstError = null;
  for (const [i, provider] of providers.entries()) {
    try {
      const raw = await provider.call(image, { apiKey: provider.apiKey, model: provider.model });
      return { ...normalizeScene(raw), provider: provider.id, model: provider.model };
    } catch (err) {
      // A malformed request won't be fixed by asking another one; busy or down will.
      const next = i < providers.length - 1;
      const retryable = err.code === 'RATE_LIMITED' || err.code === 'UPSTREAM' || err.name === 'TimeoutError' || err.name === 'TypeError';
      if (!next || !retryable) throw firstError && err.code !== 'RATE_LIMITED' ? firstError : err;
      firstError ||= err;
    }
  }
  throw firstError;
}

export { createRateLimiter };

// Shared by api/chat.js (Vercel) and server/dev-server.js (Express).
export async function runVision(req, res, env = process.env) {
  // Only Eddie's own pages may spend the AI quota.
  if (!isTrustedRequest(req, env)) {
    res.status(403).json({ error: 'Origen no permitido.' });
    return;
  }
  if (tooMany(req, res, 'vision', DEFAULT_PER_MINUTE, 'VISION_MAX_PER_MINUTE', env)) return;
  try {
    let image;
    try {
      [image] = sanitizeImages(req.body?.image ? [req.body.image] : []);
    } catch (err) {
      throw visionError(err.message, 400, 'BAD_REQUEST');
    }
    if (!image) throw visionError('Falta el fotograma de la cámara.', 400, 'BAD_REQUEST');
    const scene = await analyzeFrame(image, env);
    res.status(200).json(scene);
  } catch (err) {
    if (!err.status) console.error('[vision] unexpected error:', err);
    res.status(err.status || 502).json({ error: err.message || 'No se pudo analizar el fotograma.', ...(err.code === 'RATE_LIMITED' ? { retryAfter: 15 } : {}) });
  }
}
