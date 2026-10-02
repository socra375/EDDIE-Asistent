import { useEffect, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useLocation } from '../context/LocationContext';
import { getTasks } from '../utils/storage';
import { TASKS_CHANGED_EVENT } from '../services/taskActions';
import { HudPanel, HudRow } from './HudPanel';
import { usePlaceAndWeather } from './usePlaceAndWeather';

const pad = (n) => String(n).padStart(2, '0');
const sessionStart = Date.now();

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const clock = (seconds) => `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;

// Share of the JavaScript heap this tab uses (Chrome only), as a rough "load"
// of Eddie itself — a browser can't see the computer's real CPU.
function readHeap() {
  const m = performance.memory;
  return m?.jsHeapSizeLimit ? Math.min(100, Math.round((m.usedJSHeapSize / m.jsHeapSizeLimit) * 100)) : null;
}

function loadLabel(percent) {
  if (percent === null) return 'N/D';
  if (percent < 35) return 'Baja';
  if (percent < 70) return 'Moderada';
  return 'Alta';
}

export function UptimePanel() {
  const now = useNow();
  const { messages } = useChat();
  const uptime = Math.floor((now - sessionStart) / 1000);
  const commands = messages.filter((m) => m.role === 'user' && !m.local).length;
  const heap = readHeap();

  return (
    <HudPanel title="TIEMPO ACTIVO" aside={clock(uptime)}>
      <div className="hud-stats">
        <div className="hud-stat">
          <span>SESIÓN</span>
          <b>{clock(uptime)}</b>
        </div>
        <div className="hud-stat">
          <span>COMANDOS</span>
          <b>{commands}</b>
        </div>
      </div>
      <div className="hud-meter">
        <span>CARGA DE EDDIE</span>
        <b className={heap !== null && heap >= 70 ? 'tone-bad' : heap !== null && heap >= 35 ? 'tone-warn' : undefined}>{loadLabel(heap)}</b>
      </div>
      <div className="hud-bar" aria-hidden="true">
        <i style={{ width: `${heap ?? 0}%` }} />
      </div>
    </HudPanel>
  );
}

const LOCATION_STATUS = {
  requesting: 'BUSCANDO…',
  denied: 'PERMISO DENEGADO',
  unsupported: 'NO DISPONIBLE',
  idle: 'SIN SEÑAL',
};

export function WeatherPanel() {
  const { location, status, requestLocation } = useLocation();
  const { place, weather, weatherError } = usePlaceAndWeather(location);

  let placeLabel = LOCATION_STATUS[status] || 'SIN SEÑAL';
  if (location) placeLabel = place === null ? 'IDENTIFICANDO…' : (place || 'SIN NOMBRE').toUpperCase();

  return (
    <HudPanel title="CLIMA">
      <div className="hud-weather">
        <div>
          <div className="hud-big">
            {weather ? weather.temperature : '--'}
            <small>°C</small>
          </div>
          <div className={`hud-place ${status === 'denied' ? 'tone-bad' : ''}`}>{placeLabel}</div>
          <div className="hud-sub">
            {weather ? weather.condition.toUpperCase() : weatherError ? 'CLIMA NO DISPONIBLE' : location ? 'CARGANDO…' : 'REQUIERE UBICACIÓN'}
          </div>
        </div>
      </div>
      <div className="hud-stats hud-stats--3">
        <div className="hud-stat">
          <span>HUMEDAD</span>
          <b>{weather ? `${weather.humidity}%` : '—'}</b>
        </div>
        <div className="hud-stat">
          <span>VIENTO</span>
          <b>{weather ? `${weather.wind} km/h` : '—'}</b>
        </div>
        <div className="hud-stat">
          <span>SENSACIÓN</span>
          <b>{weather ? `${weather.feelsLike}°C` : '—'}</b>
        </div>
      </div>
      {status !== 'granted' && status !== 'unsupported' && (
        <div className="hud-actions">
          <button type="button" className="btn" onClick={requestLocation} disabled={status === 'requesting'}>
            Activar GPS
          </button>
        </div>
      )}
    </HudPanel>
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
  const lowBattery = battery && battery.level < 20 && !battery.charging;

  return (
    <HudPanel title="SISTEMA">
      <div className="hud-stats hud-stats--3">
        <div className="hud-stat">
          <span>NÚCLEOS</span>
          <b>{navigator.hardwareConcurrency || 'N/D'}</b>
        </div>
        <div className="hud-stat">
          <span>MEMORIA</span>
          <b>{navigator.deviceMemory ? `≈${navigator.deviceMemory} GB` : 'N/D'}</b>
        </div>
        <div className="hud-stat">
          <span>RED</span>
          <b className={online ? undefined : 'tone-bad'}>{online ? 'OK' : 'OFF'}</b>
        </div>
      </div>
      <div className="hud-meter">
        <span>BATERÍA</span>
        <b className={lowBattery ? 'tone-bad' : undefined}>{battery ? `${battery.level}%${battery.charging ? ' · CARGANDO' : ''}` : 'N/D'}</b>
      </div>
      <div className="hud-bar" aria-hidden="true">
        <i style={{ width: `${battery ? battery.level : 0}%` }} />
      </div>
      <div className="hud-rows">
        <HudRow label="CONEXIÓN" value={network} tone={online ? undefined : 'bad'} />
        <HudRow label="PANTALLA" value={screen} />
      </div>
    </HudPanel>
  );
}

const PRIORITY_RANK = { alta: 3, media: 2, baja: 1 };

export function TasksSummary({ onOpenTasks }) {
  // Read on each visit and whenever Eddie changes the list from the chat;
  // the Tasks module owns editing and server sync.
  const [tasks, setTasks] = useState(() => getTasks());
  useEffect(() => {
    const reload = () => setTasks(getTasks());
    window.addEventListener(TASKS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, reload);
  }, []);
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
