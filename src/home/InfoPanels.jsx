import { useEffect, useMemo, useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { getTasks } from '../utils/storage';
import { HudPanel, HudRow } from './HudPanel';
import { fetchPlaceName, fetchWeather } from './weather';

const pad = (n) => String(n).padStart(2, '0');
const sessionStart = Date.now();
const WEATHER_REFRESH_MS = 10 * 60 * 1000;

function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function TimePanel() {
  const now = useNow();
  const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 864e5);
  const offset = -now.getTimezoneOffset() / 60;
  const uptime = Math.floor((now - sessionStart) / 1000);

  return (
    <HudPanel title="TIEMPO">
      <div className="hud-big">
        {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
      </div>
      <div className="hud-sub">{date.toUpperCase()}</div>
      <div className="hud-rows">
        <HudRow label="ZONA" value={`${Intl.DateTimeFormat().resolvedOptions().timeZone} UTC${offset >= 0 ? '+' : ''}${offset}`} />
        <HudRow label="DÍA DEL AÑO" value={dayOfYear} />
        <HudRow label="SEMANA" value={`S${pad(isoWeek(now))}`} />
        <HudRow label="SESIÓN" value={`${pad(Math.floor(uptime / 3600))}:${pad(Math.floor(uptime / 60) % 60)}:${pad(uptime % 60)}`} />
      </div>
    </HudPanel>
  );
}

// Weather and place name refetch when the position moves or every 10 min.
function usePlaceAndWeather(location) {
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

const LOCATION_STATUS = {
  requesting: 'BUSCANDO…',
  denied: 'PERMISO DENEGADO',
  unsupported: 'NO DISPONIBLE',
  idle: 'SIN SEÑAL',
};

export function LocationAndWeather() {
  const { location, status, requestLocation } = useLocation();
  const { place, weather, weatherError } = usePlaceAndWeather(location);

  let placeLabel = LOCATION_STATUS[status] || 'SIN SEÑAL';
  if (location) placeLabel = place === null ? 'IDENTIFICANDO…' : (place || 'SIN NOMBRE').toUpperCase();

  return (
    <>
      <HudPanel title="UBICACIÓN">
        <div className="hud-rows">
          <HudRow label="LUGAR" value={placeLabel} tone={status === 'denied' ? 'bad' : undefined} />
          <HudRow label="LAT" value={location ? `${location.latitude.toFixed(5)}°` : '—'} />
          <HudRow label="LON" value={location ? `${location.longitude.toFixed(5)}°` : '—'} />
          <HudRow label="PRECISIÓN" value={location?.accuracy ? `±${Math.round(location.accuracy)} m` : '—'} />
        </div>
        {status !== 'granted' && status !== 'unsupported' && (
          <div className="hud-actions">
            <button type="button" className="btn" onClick={requestLocation} disabled={status === 'requesting'}>
              Activar GPS
            </button>
          </div>
        )}
      </HudPanel>

      <HudPanel title="CLIMA">
        <div className="hud-big">
          {weather ? weather.temperature : '--'}
          <small>°C</small>
        </div>
        <div className="hud-sub">
          {weather ? weather.condition.toUpperCase() : weatherError ? 'CLIMA NO DISPONIBLE' : location ? 'CARGANDO…' : 'REQUIERE UBICACIÓN'}
        </div>
        <div className="hud-rows">
          <HudRow label="SENSACIÓN" value={weather ? `${weather.feelsLike} °C` : '—'} />
          <HudRow label="HUMEDAD" value={weather ? `${weather.humidity} %` : '—'} />
          <HudRow label="VIENTO" value={weather ? `${weather.wind} km/h` : '—'} />
        </div>
      </HudPanel>
    </>
  );
}

function readSystemInfo(battery) {
  return {
    battery: battery ? { level: Math.round(battery.level * 100), charging: battery.charging } : null,
    online: navigator.onLine,
    screen: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
  };
}

function useSystemInfo() {
  const [info, setInfo] = useState(() => readSystemInfo(null));

  useEffect(() => {
    let battery;
    const read = () => setInfo(readSystemInfo(battery));
    navigator.getBattery?.().then((b) => {
      battery = b;
      b.addEventListener('levelchange', read);
      b.addEventListener('chargingchange', read);
      read();
    });
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    window.addEventListener('resize', read);
    return () => {
      battery?.removeEventListener('levelchange', read);
      battery?.removeEventListener('chargingchange', read);
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
      window.removeEventListener('resize', read);
    };
  }, []);

  return info;
}

export function SystemPanel() {
  const { battery, online, screen } = useSystemInfo();
  const connection = navigator.connection;
  const network = online
    ? [connection?.effectiveType?.toUpperCase(), connection?.downlink ? `${connection.downlink} Mb/s` : null].filter(Boolean).join(' ') || 'EN LÍNEA'
    : 'SIN RED';

  return (
    <HudPanel title="SISTEMA">
      <div className="hud-rows">
        <HudRow
          label="BATERÍA"
          value={battery ? `${battery.level}%${battery.charging ? ' · CARGANDO' : ''}` : 'N/D'}
          tone={battery && battery.level < 20 && !battery.charging ? 'bad' : undefined}
        />
        <HudRow label="RED" value={network} tone={online ? undefined : 'bad'} />
        <HudRow label="NÚCLEOS CPU" value={navigator.hardwareConcurrency || 'N/D'} />
        <HudRow label="MEMORIA" value={navigator.deviceMemory ? `≈${navigator.deviceMemory} GB` : 'N/D'} />
        <HudRow label="PANTALLA" value={screen} />
      </div>
    </HudPanel>
  );
}

const PRIORITY_RANK = { alta: 3, media: 2, baja: 1 };

export function TasksSummary({ onOpenTasks }) {
  // Read once per visit; the Tasks module owns editing and server sync.
  const tasks = useMemo(() => getTasks(), []);
  const done = tasks.filter((t) => t.done).length;
  const pending = tasks
    .filter((t) => !t.done)
    .sort((a, b) => (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0))
    .slice(0, 6);

  return (
    <HudPanel title="TAREAS">
      {tasks.length === 0 ? (
        <p className="hud-empty">Sin tareas registradas.</p>
      ) : (
        <ul className="hud-tasks">
          {pending.map((t) => (
            <li key={t.id} className={t.priority === 'alta' ? 'hud-tasks__item--high' : undefined}>
              <span className="hud-tasks__box" aria-hidden="true" />
              <span>
                {t.priority === 'alta' ? '! ' : ''}
                {t.title}
              </span>
            </li>
          ))}
          {pending.length === 0 && <li className="hud-empty">Todo al día.</li>}
        </ul>
      )}
      <div className="hud-bar" aria-hidden="true">
        <i style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
      </div>
      <div className="hud-rows">
        <HudRow label="COMPLETADAS" value={`${done}/${tasks.length}`} />
      </div>
      <div className="hud-actions">
        <button type="button" className="btn" onClick={onOpenTasks}>
          Abrir tareas
        </button>
      </div>
    </HudPanel>
  );
}
