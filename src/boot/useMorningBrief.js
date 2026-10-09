import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { usePlaceAndWeather } from '../home/usePlaceAndWeather';
import { buildMorningBrief } from '../services/morningBrief';
import { getTasks } from '../utils/storage';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const CALENDAR_TIMEOUT_MS = 9000; // the agenda is the slow one: after this, the screen goes on without it
const WEATHER_WAIT_MS = 6000; // no position (or no answer) by then: the screen goes on without the weather

// The real data of the morning, for the start-up screen: the agenda (the same
// endpoint as the "Hoy" panel, so a connector switched off is not asked), the
// weather (the browser's position) and the local tasks. `ready` is true once
// the agenda and the weather have answered or been given up on; `brief` is then
// what Eddie says and shows (see services/morningBrief.js).
export function useMorningBrief(enabled = true) {
  const { location, status: locationStatus } = useLocation();
  const { place, weather, weatherError } = usePlaceAndWeather(location);
  const [calendar, setCalendar] = useState({ status: 'loading' });
  const [weatherWaited, setWeatherWaited] = useState(false);
  const [battery, setBattery] = useState(null);
  const [tasks] = useState(() => getTasks());
  const [name, setName] = useState('');

  // The agenda, once, and only when the start-up screen is going to show it.
  const asked = useRef(false);
  useEffect(() => {
    if (!enabled || asked.current) return undefined;
    asked.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CALENDAR_TIMEOUT_MS);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    fetch(`${API_BASE}/api/connectors/today?tz=${encodeURIComponent(timezone)}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        setName(data.user?.name || '');
        setCalendar(data.calendar || { status: 'off' });
      })
      .catch((err) => setCalendar({ status: 'error', message: err.name === 'AbortError' ? 'tardó demasiado' : 'no respondió' }))
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled]);

  // No weather after a while (no position, the service is down): go on without it.
  useEffect(() => {
    const timer = window.setTimeout(() => setWeatherWaited(true), WEATHER_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // The battery, for the gauge (where the browser has it).
  useEffect(() => {
    let alive = true;
    navigator.getBattery?.()
      .then((b) => alive && setBattery({ level: Math.round(b.level * 100), charging: b.charging }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Without a position (denied, not supported) there is no weather to wait for.
  const noPosition = locationStatus === 'denied' || locationStatus === 'unsupported';
  const weatherState = weather ? 'ok' : weatherError ? 'error' : weatherWaited || noPosition ? 'none' : 'loading';
  const calendarDone = calendar.status !== 'loading';
  const weatherDone = weatherState !== 'loading';
  const ready = calendarDone && weatherDone;
  const loaded = [calendarDone, weatherDone, true].filter(Boolean).length;

  const brief = useMemo(
    () => (ready ? buildMorningBrief({ now: new Date(), name, weather, place: place || '', tasks, calendar }) : null),
    // Built once, when the data is in; the screen does not rebuild it while talking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready],
  );

  return {
    ready,
    loaded,
    total: 3,
    sources: { calendar: calendar.status, weather: weatherState, tasks: 'ok' },
    brief,
    battery,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pendingTasks: tasks.filter((t) => !t.done).length,
  };
}
