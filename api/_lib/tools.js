// Real-time "tools" Eddie can call mid-conversation via Gemini's function
// calling, instead of guessing at current time/weather from training data.
// No API keys needed: Open-Meteo is free and keyless for both geocoding
// and forecasts.

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

async function geocodeCity(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es`;
  const res = await fetch(url);
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
  const res = await fetch(url);
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

export async function executeTool(name, args, context = {}) {
  if (name === 'get_current_datetime') return getCurrentDateTime(context);
  if (name === 'get_current_weather') return getCurrentWeather(args || {}, context);
  return { error: `Herramienta desconocida: ${name}` };
}
