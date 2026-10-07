import { lazySessionUser } from './session.js';
import { callProvider } from './providers.js';
import { queryFrom, recallBlock } from './episodes/recall.js';
import { knowledgeBlock } from './knowledge/recall.js';
import { parseLearnCommand } from '../../src/services/commands.js';
import { limitImages, sanitizeImages } from './images.js';

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_LENGTH = 12000;
const MEMORY_CATEGORIES = new Set(['profile', 'preferences', 'projects', 'decisions', 'knowledge', 'context']);
const ALLOWED_PROVIDERS = new Set(['gemini', 'claude', 'groq', 'openrouter']);

class ValidationError extends Error {}

// A model name goes into the provider's URL or request body, so only plain
// names pass: letters, digits and . _ : - (and a / for Groq's and OpenRouter's
// "vendor/model"), never ".." or anything that could change the address.
// Anything else is ignored and the provider's default model is used.
export function cleanModel(value, provider) {
  if (typeof value !== 'string') return undefined;
  const slash = provider === 'groq' || provider === 'openrouter' ? '/' : '';
  const ok = new RegExp(`^[A-Za-z0-9][A-Za-z0-9._:${slash}-]{0,98}$`).test(value) && !value.includes('..');
  return ok ? value : undefined;
}

// Strips the request down to only what the provider needs, validates shape
// and size so we never forward oversized or malformed payloads upstream.
function sanitizeRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Cuerpo de la solicitud inválido.');
  }

  const provider = body.provider;
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new ValidationError('El proveedor debe ser "gemini", "claude", "groq" u "openrouter".');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ValidationError('Se requiere al menos un mensaje.');
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw new ValidationError(`Demasiados mensajes (máximo ${MAX_MESSAGES}).`);
  }

  const messages = limitImages(body.messages.map((m) => {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) {
      throw new ValidationError('Cada mensaje debe incluir contenido de texto.');
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError('Un mensaje excede la longitud máxima permitida.');
    }
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const images = role === 'user' ? sanitizeImages(m.images) : [];
    return { role, content: m.content.trim(), ...(images.length ? { images } : {}) };
  }));

  const system = typeof body.system === 'string' ? body.system.slice(0, MAX_SYSTEM_LENGTH) : '';
  const model = cleanModel(body.model, provider);
  const context = sanitizeContext(body.context);
  const disabledConnectors = sanitizeConnectorIds(body.disabledConnectors);

  return { provider, model, system, messages, context, disabledConnectors };
}

// Connectors the user switched off in the hub. Unknown ids are harmless (the
// registry just never matches them), but shape and size are still checked.
export function sanitizeConnectorIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((id) => typeof id === 'string' && /^[a-z0-9_-]{1,40}$/.test(id)).slice(0, 50);
}

// Optional context (the user's timezone, coordinates and tasks) used by the
// connector tools (current time, weather, tasks) — never trusted blindly, since
// it comes straight from the browser.
export function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};

  const result = {};
  if (typeof context.timezone === 'string' && context.timezone.length < 100) {
    result.timezone = context.timezone;
  }
  const { location } = context;
  if (
    location &&
    typeof location.latitude === 'number' &&
    typeof location.longitude === 'number' &&
    Math.abs(location.latitude) <= 90 &&
    Math.abs(location.longitude) <= 180
  ) {
    result.location = { latitude: location.latitude, longitude: location.longitude };
  }
  // The user's task list, so the Tareas tools can find "the report task"
  // by name. Only what they need, size-capped.
  if (Array.isArray(context.tasks)) {
    result.tasks = context.tasks
      .filter((t) => t && typeof t.id === 'string' && typeof t.title === 'string')
      .slice(0, 50)
      .map((t) => ({ id: t.id.slice(0, 80), title: t.title.slice(0, 200), done: Boolean(t.done) }));
  }
  // What the user has saved in Memoria, flat and capped, so the memory tools
  // (recall, forget) can search it.
  if (Array.isArray(context.memory)) {
    result.memory = context.memory
      .filter((m) => m && typeof m.id === 'string' && MEMORY_CATEGORIES.has(m.c) && typeof m.t === 'string')
      .slice(0, 80)
      .map((m) => ({ id: m.id.slice(0, 40), c: m.c, t: m.t.slice(0, 220) }));
  }
  return result;
}

// `cookies` identify the signed-in user for account tools (Gmail); the
// session is only looked up if such a tool runs.
export async function handleChatRequest(body, onChunk, onStep, { cookies = {}, getUser: sharedGetUser } = {}) {
  const request = sanitizeRequest(body);
  // (chatStream.js already looked the user up for the allowance: reuse it.)
  const getUser = sharedGetUser || lazySessionUser(cookies);
  // Background for the answer, never allowed to make it fail or wait long:
  // notes from past conversations and what Eddie learned by researching (the
  // second brain) that fit what was just said. Each is skipped when the user
  // switched its connector off.
  let system = request.system;
  const wantEpisodes = !request.disabledConnectors.includes('conversations');
  const wantKnowledge = !request.disabledConnectors.includes('knowledge');
  // (A short message like "hola" has nothing to look for, so it doesn't even look the session up.)
  if ((wantEpisodes || wantKnowledge) && queryFrom(request.messages)) {
    const user = process.env.GEMINI_API_KEY && process.env.DATABASE_URL ? await getUser() : null;
    if (user) {
      const [recalled, learned] = await Promise.all([
        wantEpisodes ? recallBlock({ userId: user.id, messages: request.messages, timezone: request.context.timezone }) : '',
        wantKnowledge ? knowledgeBlock({ userId: user.id, messages: request.messages }) : '',
      ]);
      if (recalled) system = `${system}\n\n${recalled}`;
      if (learned) system = `${system}\n\n${learned}`;
    }
  }
  // "Investiga y aprende X": the model must run the research tool, not answer from memory.
  const toLearn = wantKnowledge ? parseLearnCommand(request.messages.at(-1)?.role === 'user' ? request.messages.at(-1).content : '') : null;
  if (toLearn) system = `${system}\n\nOrden explícita del usuario: investigar y aprender «${toLearn.slice(0, 300)}». Llama ahora mismo a la herramienta learn_topic con ese tema; no la respondas de memoria ni pidas confirmación. Cuando termine, cuéntale en 2 o 3 frases lo esencial que aprendiste.`;
  // A picture attached to the latest message, for the image tools (edit what the user just sent).
  const lastMessage = request.messages.at(-1);
  const attachedImage = lastMessage?.role === 'user' ? lastMessage.images?.[0] || null : null;
  return callProvider({ ...request, system, context: { ...request.context, getUser, attachedImage, toTelegram: body?.mirror === true }, onChunk, onStep });
}

export function errorToResponse(err) {
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: err.message } };
  }
  if (err.code === 'PROVIDER_UNAVAILABLE') {
    return { status: 503, body: { error: err.message } };
  }
  if (err.code === 'BAD_REQUEST') {
    return { status: 400, body: { error: err.message } };
  }
  return { status: 502, body: { error: err.message || 'Error inesperado al contactar al proveedor de IA.' } };
}
