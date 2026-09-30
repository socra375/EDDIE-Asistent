// Current weather for a city or for the user's shared location, via
// Open-Meteo: free and keyless for both geocoding and forecasts.
import { fetchWithRetry } from '../../fetchWithRetry.js';

// Open-Meteo occasionally drops a request or answers slowly enough to hit
// our own AbortSignal timeout; a single retry clears most of those without
// meaningfully eating into the chat request's overall time budget.
const FETCH_RETRIES = 1;

// Every tool call sits inside the chat request's own time budget, so a hung
// Open-Meteo request must fail fast rather than stall the whole response.
const FETCH_TIMEOUT_MS = 6000;

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

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es`;
  let res;
  try {
    res = await fetchWithRetry(url, () => ({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), { retries: FETCH_RETRIES });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const match = data?.results?.[0];
  if (!match) return null;
  return { latitude: match.latitude, longitude: match.longitude, name: match.name, country: match.country };
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
    res = await fetchWithRetry(url, () => ({ signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }), { retries: FETCH_RETRIES });
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

export default {
  id: 'weather',
  name: 'Clima',
  description: 'Eddie consulta el clima actual de cualquier ciudad, o el de tu ubicación si la compartes.',
  icon: 'cloud',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Consultar el clima actual',
      activity: 'Consultando el clima…',
      summarize: (result) => `${result.place}: ${result.temperature_celsius} °C, ${String(result.condition).toLowerCase()}`,
      sensitive: false,
      declaration: {
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
      run: (args, context) => getCurrentWeather(args, context),
    },
  ],
  webhook: null,
};
