import { useEffect, useState } from 'react';
import { fetchPlaceName, fetchWeather } from './weather';

const WEATHER_REFRESH_MS = 10 * 60 * 1000;

// Weather and place name refetch when the position moves or every 10 min.
export function usePlaceAndWeather(location) {
  const [place, setPlace] = useState(null);
  const [weather, setWeather] = useState(null);
  const [weatherError, setWeatherError] = useState(false);
  const lat = location?.latitude;
  const lon = location?.longitude;

  useEffect(() => {
    if (lat == null || lon == null) return undefined;
    const controller = new AbortController();
    const coords = { latitude: lat, longitude: lon };
    const load = () => {
      fetchWeather(coords, controller.signal)
        .then((w) => {
          setWeather(w);
          setWeatherError(false);
        })
        .catch((err) => err.name !== 'AbortError' && setWeatherError(true));
    };
    load();
    fetchPlaceName(coords, controller.signal)
      .then(setPlace)
      .catch((err) => err.name !== 'AbortError' && setPlace(''));
    const id = setInterval(load, WEATHER_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, [lat, lon]);

  return { place, weather, weatherError };
}
