// Real-time "tools" Eddie can call mid-conversation via Gemini's function
// calling, instead of guessing at current time/weather from training data.
// No API keys needed: Open-Meteo is free and keyless for both geocoding
// and forecasts.
import { fetchWithRetry } from './fetchWithRetry.js';

// Open-Meteo occasionally drops a request or answers slowly enough to hit
// our own AbortSignal timeout; a single retry clears most of those without
// meaningfully eating into the chat request's overall time budget.
const TOOL_FETCH_RETRIES = 1;

export const TOOL_DECLARATIONS = [
  {
    name: 'get_current_datetime',
    description:
      'Devuelve la fecha y hora actuales en la zona horaria del usuario. Úsala siempre que el usuario pregunte qué hora es, qué día es hoy, o cuando necesites la fecha/hora actual para tu respuesta.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'get_current_weather',
    description:
      'Devuelve el clima actual (temperatura, condición, humedad, viento) de una ciudad. Si el usuario no menciona una ciudad, omite el parámetro "city" para usar automáticamente su ubicación actual (si la ha compartido).',
    parameters: {
      type: 'OBJECT',
      properties: {
        city: {
          type: 'STRING',
          description: 'Nombre de la ciudad, p. ej. "Madrid" o "Santo Domingo". Omite este parámetro para usar la ubicación actual del usuario.',
        },
      },
    },
  },
];

const WEATHER_CONDITIONS = {
  0: 'despejado',
  1: 'mayormente despejado',
  2: 'parcialmente nublado',
  3: 'nublado',
  45: 'niebla',
  48: 'niebla escarchada',
  51: 'llovizna ligera',
  53: 'llovizna',
  55: 'llovizna intensa',
  56: 'llovizna helada',
  57: 'llovizna helada intensa',
  61: 'lluvia ligera',
  63: 'lluvia',
  65: 'lluvia intensa',
  66: 'lluvia helada',
  67: 'lluvia helada intensa',
  71: 'nieve ligera',
  73: 'nieve',
  75: 'nieve intensa',
  77: 'granos de nieve',
  80: 'chubascos ligeros',
  81: 'chubascos',
  82: 'chubascos violentos',
  85: 'chubascos de nieve ligeros',
  86: 'chubascos de nieve intensos',
  95: 'tormenta eléctrica',
  96: 'tormenta con granizo ligero',
  99: 'tormenta con granizo intenso',
};

// Every tool call sits inside the chat request's own time budget, so a
// hung Open-Meteo request must fail fast rather than stall the whole
// response — an unbounded fetch here previously risked the caller (Vercel)
// timing the entire function out with an opaque 504.
const TOOL_FETCH_TIMEOUT_MS = 6000;

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es`;
  let res;
  try {
    res = await fetchWithRetry(url, () => ({ signal: AbortSignal.timeout(TOOL_FETCH_TIMEOUT_MS) }), { retries: TOOL_FETCH_RETRIES });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const match = data?.results?.[0];
  if (!match) return null;
  return { latitude: match.latitude, longitude: match.longitude, name: match.name, country: match.country };
}

async function getCurrentDateTime(context) {
  const timezone = context.timezone || 'UTC';
  const now = new Date();
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'medium', timeZone: timezone }).format(now);
  } catch {
    formatted = now.toISOString();
  }
  return { datetime_iso: now.toISOString(), formatted, timezone };
}

async function getCurrentWeather(args, context) {
  let coords;
  let place;

  if (args?.city) {
    const geo = await geocodeCity(args.city);
    if (!geo) return { error: `No se encontró la ciudad "${args.city}".` };
    coords = geo;
    place = `${geo.name}, ${geo.country}`;
  } else if (context.location?.latitude != null && context.location?.longitude != null) {
    coords = context.location;
    place = 'la ubicación actual del usuario';
  } else {
    return { error: 'No se especificó una ciudad y el usuario no ha compartido su ubicación actual.' };
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
  let res;
  try {
    res = await fetchWithRetry(url, () => ({ signal: AbortSignal.timeout(TOOL_FETCH_TIMEOUT_MS) }), { retries: TOOL_FETCH_RETRIES });
  } catch {
    return { error: 'No se pudo obtener el clima en este momento (el servicio no respondió a tiempo).' };
  }
  if (!res.ok) return { error: 'No se pudo obtener el clima en este momento.' };
  const data = await res.json().catch(() => null);
  const current = data?.current;
  if (!current) return { error: 'El servicio de clima no devolvió datos utilizables.' };

  return {
    place,
    temperature_celsius: current.temperature_2m,
    humidity_percent: current.relative_humidity_2m,
    wind_kmh: current.wind_speed_10m,
    condition: WEATHER_CONDITIONS[current.weather_code] ?? 'desconocido',
  };
}

const JSON_SCHEMA_TYPE_CHECKS = {
  STRING: (v) => typeof v === 'string',
  NUMBER: (v) => typeof v === 'number' && Number.isFinite(v),
  INTEGER: (v) => typeof v === 'number' && Number.isInteger(v),
  BOOLEAN: (v) => typeof v === 'boolean',
  OBJECT: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  ARRAY: (v) => Array.isArray(v),
};

// The model can hallucinate arguments with the wrong shape (a number where
// a city name is expected, an object instead of a string) — validate against
// the tool's own declared schema before ever running it, rather than letting
// a malformed value reach the tool body and fail in some less obvious way.
function validateArgs(declaration, args) {
  const properties = declaration.parameters?.properties || {};
  const required = declaration.parameters?.required || [];
  const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

  for (const key of required) {
    if (!(key in safeArgs)) {
      return `Falta el argumento requerido "${key}" para la herramienta "${declaration.name}".`;
    }
  }

  for (const [key, value] of Object.entries(safeArgs)) {
    const schema = properties[key];
    if (!schema) {
      return `Argumento desconocido "${key}" para la herramienta "${declaration.name}".`;
    }
    const check = JSON_SCHEMA_TYPE_CHECKS[schema.type];
    if (check && value != null && !check(value)) {
      return `El argumento "${key}" de "${declaration.name}" debe ser de tipo ${schema.type}.`;
    }
  }

  return null;
}

const TOOL_IMPLEMENTATIONS = {
  get_current_datetime: (args, context) => getCurrentDateTime(context),
  get_current_weather: (args, context) => getCurrentWeather(args || {}, context),
};

// Never lets a tool crash the whole chat request: an unknown tool, invalid
// arguments, or an unexpected exception inside a tool all become a graceful
// { error } result fed back to the model instead of propagating and aborting
// the request Gemini is waiting on.
export async function executeTool(name, args, context = {}) {
  const declaration = TOOL_DECLARATIONS.find((t) => t.name === name);
  const implementation = TOOL_IMPLEMENTATIONS[name];
  if (!declaration || !implementation) {
    return { error: `Herramienta desconocida: ${name}` };
  }

  const validationError = validateArgs(declaration, args);
  if (validationError) {
    return { error: validationError };
  }

  try {
    return await implementation(args, context);
  } catch (err) {
    return { error: `La herramienta "${name}" falló inesperadamente: ${err?.message || 'error desconocido'}.` };
  }
}
