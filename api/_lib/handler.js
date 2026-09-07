import { callProvider } from './providers.js';

const MAX_MESSAGES = 40;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_SYSTEM_LENGTH = 4000;
const ALLOWED_PROVIDERS = new Set(['gemini', 'claude']);

class ValidationError extends Error {}

// Strips the request down to only what the provider needs, validates shape
// and size so we never forward oversized or malformed payloads upstream.
function sanitizeRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Cuerpo de la solicitud inválido.');
  }

  const provider = body.provider;
  if (!ALLOWED_PROVIDERS.has(provider)) {
    throw new ValidationError('El proveedor debe ser "gemini" o "claude".');
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

  return { provider, model, system, messages, context };
}

// Optional real-time context (the user's timezone/coordinates) used by
// Gemini's tools (current time, weather) — never trusted blindly, since
// it comes straight from the browser.
function sanitizeContext(context) {
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
  return result;
}

export async function handleChatRequest(body) {
  const request = sanitizeRequest(body);
  return callProvider(request);
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
