import { lazySessionUser } from './session.js';
import { callProvider } from './providers.js';

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_LENGTH = 8000;
const ALLOWED_PROVIDERS = new Set(['gemini', 'claude', 'groq']);

class ValidationError extends Error {}

// Strips the request down to only what the provider needs, validates shape
// and size so we never forward oversized or malformed payloads upstream.
function sanitizeRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Cuerpo de la solicitud inválido.');
  }

  const provider = body.provider;
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new ValidationError('El proveedor debe ser "gemini", "claude" o "groq".');
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ValidationError('Se requiere al menos un mensaje.');
  }
  if (body.messages.length > MAX_MESSAGES) {
    throw new ValidationError(`Demasiados mensajes (máximo ${MAX_MESSAGES}).`);
  }

  const messages = body.messages.map((m) => {
    if (!m || typeof m.content !== 'string' || !m.content.trim()) {
      throw new ValidationError('Cada mensaje debe incluir contenido de texto.');
    }
    if (m.content.length > MAX_MESSAGE_LENGTH) {
      throw new ValidationError('Un mensaje excede la longitud máxima permitida.');
    }
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.trim(),
    };
  });

  const system = typeof body.system === 'string' ? body.system.slice(0, MAX_SYSTEM_LENGTH) : '';
  const model = typeof body.model === 'string' && body.model.length < 100 ? body.model : undefined;
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
  return result;
}

// `cookies` identify the signed-in user for account tools (Gmail); the
// session is only looked up if such a tool runs.
export async function handleChatRequest(body, onChunk, onActivity, { cookies = {} } = {}) {
  const request = sanitizeRequest(body);
  return callProvider({ ...request, context: { ...request.context, getUser: lazySessionUser(cookies) }, onChunk, onActivity });
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
