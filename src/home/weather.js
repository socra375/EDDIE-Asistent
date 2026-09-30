// Client-side twin of the backend's get_current_weather tool: the HUD panels
// call these free, keyless APIs straight from the browser so the dashboard
// doesn't spend an AI request just to show the weather.
const WEATHER_CONDITIONS = {
  0: 'Despejado',
  1: 'Mayormente despejado',
  2: 'Parcialmente nublado',
  3: 'Nublado',
  45: 'Niebla',
  48: 'Niebla escarchada',
  51: 'Llovizna ligera',
  53: 'Llovizna',
  55: 'Llovizna intensa',
  56: 'Llovizna helada',
  57: 'Llovizna helada intensa',
  61: 'Lluvia ligera',
  63: 'Lluvia',
  65: 'Lluvia intensa',
  66: 'Lluvia helada',
  67: 'Lluvia helada intensa',
  71: 'Nieve ligera',
  73: 'Nieve',
  75: 'Nieve intensa',
  77: 'Granos de nieve',
  80: 'Chubascos ligeros',
  81: 'Chubascos',
  82: 'Chubascos violentos',
  85: 'Chubascos de nieve ligeros',
  86: 'Chubascos de nieve intensos',
  95: 'Tormenta eléctrica',
  96: 'Tormenta con granizo ligero',
  99: 'Tormenta con granizo intenso',
};

export async function fetchWeather({ latitude, longitude }, signal) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code&timezone=auto`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const { current } = await res.json();
  return {
    temperature: Math.round(current.temperature_2m),
    feelsLike: Math.round(current.apparent_temperature),
    humidity: current.relative_humidity_2m,
    wind: Math.round(current.wind_speed_10m),
    condition: WEATHER_CONDITIONS[current.weather_code] || `Código ${current.weather_code}`,
  };
}

export async function fetchPlaceName({ latitude, longitude }, signal) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=es`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Geocodificación respondió ${res.status}`);
  const data = await res.json();
  return [data.city || data.locality, data.principalSubdivision, data.countryCode].filter(Boolean).join(', ');
}
