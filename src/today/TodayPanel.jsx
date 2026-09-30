import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useLocation } from '../context/LocationContext';
import { useSettings } from '../context/SettingsContext';
import { HudPanel, HudRow } from '../home/HudPanel';
import { usePlaceAndWeather } from '../home/usePlaceAndWeather';
import { TASKS_CHANGED_EVENT } from '../services/taskActions';
import { getTasks } from '../utils/storage';
import { useToday } from './useToday';
import './Today.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const API_LOAD_LIMIT = 6;

// What Eddie is asked when the user taps "Resumen del día": it answers with
// its own tools (agenda, mail, weather, tasks), by voice if voice is on.
const SUMMARY_PROMPT =
  'Dame mi resumen del día: qué tengo en mi agenda hoy y mañana, si hay correos importantes sin leer, mis tareas pendientes y el clima. Sé breve y dime por dónde empezar.';

const localDate = () => new Intl.DateTimeFormat('en-CA').format(new Date());
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return new Intl.DateTimeFormat('en-CA').format(d);
};

function greeting(name) {
  const h = new Date().getHours();
  const hello = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const first = (name || '').trim().split(/\s+/)[0];
  return first ? `${hello}, ${first}` : hello;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const senderName = (from) => (from || '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || from || '';

// Pending tasks, most urgent first: overdue, due today, then by priority.
function usePendingTasks() {
  const [tasks, setTasks] = useState(() => getTasks());
  useEffect(() => {
    const reload = () => setTasks(getTasks());
    window.addEventListener(TASKS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(TASKS_CHANGED_EVENT, reload);
  }, []);
  return useMemo(() => {
    const today = localDate();
    const rank = { alta: 0, media: 1, baja: 2 };
    return tasks
      .filter((t) => !t.done)
      .map((t) => ({ ...t, overdue: Boolean(t.dueDate) && t.dueDate < today, dueToday: t.dueDate === today }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.dueToday) - Number(a.dueToday) || (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1));
  }, [tasks]);
}

function dueLabel(task, tomorrow) {
  if (!task.dueDate) return null;
  if (task.overdue) return { text: 'vencida', tone: 'bad' };
  if (task.dueToday) return { text: 'hoy', tone: 'warn' };
  if (task.dueDate === tomorrow) return { text: 'mañana' };
  return { text: task.dueDate };
}

// Why a section is empty, with the one action that fixes it.
function SectionState({ section, loading, onLogin, onOpenConnectors, onRetry, emptyText }) {
  if (!section) return <p className="hud-empty">{loading ? 'Consultando…' : emptyText}</p>;
  switch (section.status) {
    case 'needs_login':
      return (
        <>
          <p className="hud-empty">Inicia sesión con Google para verlo aquí.</p>
          <div className="hud-actions">
            <button type="button" className="btn btn-primary" onClick={onLogin}>
              Iniciar sesión
            </button>
          </div>
        </>
      );
    case 'needs_connect':
      return (
        <>
          <p className="hud-empty">Conecta tu Gmail para ver aquí tus correos importantes.</p>
          <div className="hud-actions">
            <a className="btn btn-primary" href={`${API_BASE}/api/auth/google/start?scope=gmail`}>
              Conectar Gmail
            </a>
          </div>
        </>
      );
    case 'needs_setup':
      return <p className="hud-empty">Falta configurarlo en el servidor (Google y la base de datos; mira el README).</p>;
    case 'off':
      return (
        <>
          <p className="hud-empty">Lo apagaste en Conectores.</p>
          <div className="hud-actions">
            <button type="button" className="btn" onClick={onOpenConnectors}>
              Abrir Conectores
            </button>
          </div>
        </>
      );
    case 'error':
      return (
        <>
          <p className="hud-empty tone-bad">{section.message || 'No se pudo cargar.'}</p>
          <div className="hud-actions">
            <button type="button" className="btn" onClick={onRetry}>
              Reintentar
            </button>
          </div>
        </>
      );
    default:
      return null;
  }
}

function AgendaCard({ calendar, today, loading, state }) {
  const tomorrow = addDays(today, 1);
  const days = [
    { label: 'HOY', events: (calendar?.events || []).filter((e) => e.date === today) },
    { label: 'MAÑANA', events: (calendar?.events || []).filter((e) => e.date === tomorrow) },
  ];
  return (
    <HudPanel title="AGENDA" className="today-card">
      {calendar?.status === 'ok' ? (
        days.map((day) => (
          <div key={day.label} className="today-day">
            <h3 className="today-day__label">{day.label}</h3>
            {day.events.length === 0 ? (
              <p className="hud-empty">{day.label === 'HOY' ? 'Nada agendado para hoy.' : 'Nada agendado para mañana.'}</p>
            ) : (
              <ul className="today-list">
                {day.events.map((e) => (
                  <li key={e.id}>
                    <span className="today-list__time">{e.all_day ? 'Todo el día' : `${e.start}–${e.end}`}</span>
                    <span className="today-list__main">
                      {e.title}
                      {e.location && <small>{e.location}</small>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      ) : (
        <SectionState section={calendar} loading={loading} emptyText="Sin datos." {...state} />
      )}
    </HudPanel>
  );
}

function MailCard({ mail, loading, state }) {
  return (
    <HudPanel title="CORREOS" className="today-card">
      {mail?.status === 'ok' ? (
        mail.emails.length === 0 ? (
          <p className="hud-empty">Nada importante sin leer en los últimos 3 días.</p>
        ) : (
          <ul className="today-list">
            {mail.emails.map((m) => (
              <li key={m.id}>
                <span className="today-list__main">
                  <b>{senderName(m.from)}</b>
                  {m.subject}
                  {m.snippet && <small>{m.snippet}</small>}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <SectionState section={mail} loading={loading} emptyText="Sin datos." {...state} />
      )}
    </HudPanel>
  );
}

function TasksCard({ tasks, tomorrow, onOpenTasks }) {
  const shown = tasks.slice(0, 6);
  return (
    <HudPanel title="PENDIENTES" className="today-card">
      {tasks.length === 0 ? (
        <p className="hud-empty">Todo al día. Dile a Eddie «recuérdame…» para anotar algo.</p>
      ) : (
        <ul className="today-list">
          {shown.map((t) => {
            const due = dueLabel(t, tomorrow);
            return (
              <li key={t.id} className={t.priority === 'alta' ? 'today-list__item--high' : undefined}>
                <span className="today-list__time">{due ? <span className={due.tone ? `tone-${due.tone}` : undefined}>{due.text}</span> : '·'}</span>
                <span className="today-list__main">
                  {t.priority === 'alta' ? '! ' : ''}
                  {t.title}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {tasks.length > shown.length && <p className="hud-empty">y {tasks.length - shown.length} más…</p>}
      <div className="hud-actions">
        <button type="button" className="btn" onClick={onOpenTasks}>
          Abrir tareas
        </button>
      </div>
    </HudPanel>
  );
}

function WeatherCard() {
  const { location, status, requestLocation } = useLocation();
  const { place, weather, weatherError } = usePlaceAndWeather(location);
  return (
    <HudPanel title="CLIMA" className="today-card">
      {weather ? (
        <>
          <div className="hud-big">
            {weather.temperature}
            <small>°C</small>
          </div>
          <div className="hud-sub">{weather.condition.toUpperCase()}</div>
          <div className="hud-rows">
            {place && <HudRow label="LUGAR" value={place.toUpperCase()} />}
            <HudRow label="SENSACIÓN" value={`${weather.feelsLike} °C`} />
            <HudRow label="HUMEDAD" value={`${weather.humidity} %`} />
            <HudRow label="VIENTO" value={`${weather.wind} km/h`} />
          </div>
        </>
      ) : weatherError ? (
        <p className="hud-empty tone-bad">No se pudo consultar el clima ahora.</p>
      ) : location ? (
        <p className="hud-empty">Consultando…</p>
      ) : (
        <>
          <p className="hud-empty">Comparte tu ubicación para ver el clima de donde estás.</p>
          {status !== 'unsupported' && (
            <div className="hud-actions">
              <button type="button" className="btn" onClick={requestLocation} disabled={status === 'requesting'}>
                Activar GPS
              </button>
            </div>
          )}
        </>
      )}
    </HudPanel>
  );
}

function NewsCard({ news, loading, state }) {
  return (
    <HudPanel title="NOTICIAS" className="today-card">
      {news?.status === 'ok' ? (
        <ul className="today-list">
          {news.headlines.slice(0, 5).map((n) => (
            <li key={n.url || n.title}>
              <span className="today-list__main">
                {n.url ? (
                  <a href={n.url} target="_blank" rel="noopener noreferrer">
                    {n.title}
                  </a>
                ) : (
                  n.title
                )}
                {n.source && <small>{n.source}</small>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <SectionState section={news} loading={loading} emptyText="Sin datos." {...state} />
      )}
    </HudPanel>
  );
}

// The day at a glance: agenda, important mail, tasks, weather and headlines,
// with one button to have Eddie talk it through.
export default function TodayPanel({ onOpenTasks, onOpenConnectors, onOpenChat }) {
  const { user, login } = useAuth();
  const { settings } = useSettings();
  const { sendMessage, status: chatStatus } = useChat();
  const { location } = useLocation();
  const { weather } = usePlaceAndWeather(location);
  const off = settings.disabledConnectors || [];
  const { status, data, error, updatedAt, reload } = useToday(user?.id || null, off);
  const tasks = usePendingTasks();
  const loading = status === 'loading' && !data;
  const today = data?.today || localDate();
  const tomorrow = addDays(today, 1);

  const state = { loading, onLogin: login, onOpenConnectors, onRetry: reload };
  const todayEvents = (data?.calendar?.events || []).filter((e) => e.date === today).length;
  const emails = data?.mail?.status === 'ok' ? data.mail.emails.length : null;
  const parts = [];
  if (data?.calendar?.status === 'ok') parts.push(todayEvents ? plural(todayEvents, 'evento hoy', 'eventos hoy') : 'nada en la agenda');
  parts.push(tasks.length ? plural(tasks.length, 'pendiente', 'pendientes') : 'sin pendientes');
  if (emails != null) parts.push(emails ? `${emails >= API_LOAD_LIMIT ? `${API_LOAD_LIMIT}+` : emails} por leer` : 'sin correos importantes');
  if (weather) parts.push(`${weather.temperature} °C, ${weather.condition.toLowerCase()}`);

  function askSummary() {
    sendMessage(SUMMARY_PROMPT, { tag: 'HOY', display: 'Resumen del día' });
    onOpenChat?.();
  }

  const date = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <section className="today">
      <div className="glass-panel today__hero">
        <div className="today__hero-text">
          <p className="today__greeting">{greeting(data?.user?.name || user?.name)}</p>
          <h2 className="today__date">{date}</h2>
          <p className="today__summary">{parts.join(' · ')}</p>
        </div>
        <div className="today__hero-actions">
          <button type="button" className="btn btn-primary" onClick={askSummary} disabled={chatStatus === 'processing'}>
            Resumen del día con Eddie
          </button>
          <button type="button" className="btn" onClick={reload} disabled={status === 'loading'}>
            {status === 'loading' ? 'Actualizando…' : 'Actualizar'}
          </button>
          {updatedAt && <span className="today__updated">Actualizado {updatedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>}
        </div>
      </div>

      {status === 'error' && (
        <p className="glass-panel today__error" role="alert">
          No se pudo cargar tu agenda, correos y noticias: {error}
        </p>
      )}

      <div className="today__grid">
        <AgendaCard calendar={data?.calendar} today={today} loading={loading} state={state} />
        <MailCard mail={data?.mail} loading={loading} state={state} />
        <TasksCard tasks={tasks} tomorrow={tomorrow} onOpenTasks={onOpenTasks} />
        <WeatherCard />
        <NewsCard news={data?.news} loading={loading} state={state} />
      </div>
    </section>
  );
}
