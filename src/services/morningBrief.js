// The morning summary Eddie gives as the start-up screen opens: the date, the
// weather, today's agenda and the pending tasks, all from real data. Pure (no
// browser APIs) so it can be tested in Node. The start-up screen
// (src/boot/BootSplash.jsx) reads `pieces` aloud, one at a time, and shows each
// piece's part of `view` as it is spoken.
import { MONTHS, WEEKDAYS, spokenTime, tasksPiece, weatherPiece } from './briefing.js';

export const MAX_AGENDA = 5;
export const MAX_TASKS = 3;
const TASK_RANK = { alta: 3, media: 2, baja: 1 };

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// "09:30" → "las 9 y 30"; "17:00" → "las 5 en punto". Empty when it is not a time.
export function spokenClock(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return '';
  const h12 = Number(m[1]) % 12 || 12;
  const minutes = Number(m[2]);
  const hour = `${h12 === 1 ? 'la' : 'las'} ${h12}`;
  return minutes === 0 ? `${hour} en punto` : `${hour} y ${minutes}`;
}

// "09:30" → 570, the minutes since midnight (NaN when it is not a time).
export function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

// The local calendar date, "2026-10-08", of a Date (the calendar's dates are local too).
export function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The events that fall on `today`: a timed one starting today, or an all-day one covering it.
// Sorted: all-day first, then by start time.
export function todaysEvents(calendar, today) {
  if (calendar?.status !== 'ok') return [];
  return (calendar.events || [])
    .filter((e) => e.date === today || (e.all_day && e.date <= today && (e.until || e.date) >= today))
    .map((e) => ({
      title: String(e.title || '(sin título)'),
      allDay: Boolean(e.all_day),
      start: e.all_day ? '' : e.start || '',
      end: e.all_day ? '' : e.end || '',
      location: e.location || '',
    }))
    .sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1));
}

// What Eddie says about the agenda, whatever the state of the calendar.
function agendaPiece(calendar, events) {
  switch (calendar?.status) {
    case 'ok':
      if (!events.length) return 'Nada en tu calendario para hoy.';
      return `Hoy tienes ${plural(events.length, 'evento', 'eventos')}. ${events
        .slice(0, MAX_AGENDA)
        .map((e) => (e.allDay ? `${e.title}, todo el día` : `A ${spokenClock(e.start)}, ${e.title}`))
        .join('. ')}${events.length > MAX_AGENDA ? `. Y ${events.length - MAX_AGENDA} más` : ''}.`;
    case 'needs_login':
      return 'Para ver tu agenda, inicia sesión con Google.';
    case 'needs_connect':
      return 'Conecta tu Google Calendar en Conectores para ver tu agenda.';
    case 'error':
      return 'No pude leer tu agenda ahora.';
    default:
      return '';
  }
}

function topTasks(tasks) {
  return tasks
    .filter((t) => !t.done)
    .sort((a, b) => (TASK_RANK[b.priority] || 0) - (TASK_RANK[a.priority] || 0))
    .slice(0, MAX_TASKS)
    .map((t) => ({ title: String(t.title || ''), high: t.priority === 'alta' }));
}

// → { pieces: [{ key, panel, text }], view }
//   pieces: what is said, in order; `panel` is the card that goes with it (null for none).
//   view:   the same data as it is shown: date, weather, agenda (with a timeline), tasks.
export function buildMorningBrief({ now = new Date(), name = '', weather = null, place = '', tasks = [], calendar = null } = {}) {
  const today = localDate(now);
  const first = String(name || '').trim().split(/\s+/)[0];
  const hour = now.getHours();
  const greeting = hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const dateText = `${WEEKDAYS[now.getDay()]} ${now.getDate()} de ${MONTHS[now.getMonth()]}`;
  const events = todaysEvents(calendar, today);
  const pending = tasks.filter((t) => !t.done).length;

  const pieces = [
    { key: 'date', panel: 'date', text: `${greeting}${first ? `, ${first}` : ''}. Hoy es ${dateText}, y son ${spokenTime(now)}.` },
    { key: 'weather', panel: 'weather', text: weatherPiece(weather, place) },
    { key: 'agenda', panel: 'agenda', text: agendaPiece(calendar, events) },
    { key: 'tasks', panel: 'tasks', text: tasksPiece(tasks) },
    { key: 'close', panel: null, text: 'Eso es todo por ahora.' },
  ];

  const view = {
    date: { line: `${dateText.charAt(0).toUpperCase()}${dateText.slice(1)}`, greeting },
    weather: weather ? { temperature: weather.temperature, condition: weather.condition, humidity: weather.humidity, wind: weather.wind, place } : null,
    agenda: {
      status: calendar?.status || 'loading',
      items: events.slice(0, MAX_AGENDA),
      more: Math.max(0, events.length - MAX_AGENDA),
      // Where the timed events sit in the day (0 to 1440 minutes), for the timeline.
      timeline: events
        .filter((e) => !e.allDay && Number.isFinite(minutesOf(e.start)))
        .map((e) => ({ from: minutesOf(e.start), to: Math.max(minutesOf(e.start) + 15, minutesOf(e.end) || minutesOf(e.start) + 30), title: e.title })),
    },
    tasks: { items: topTasks(tasks), pending },
  };
  return { pieces, view };
}
