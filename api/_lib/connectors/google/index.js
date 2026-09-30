// The user's Google account, connected through the Google login
// (api/_lib/authHandlers.js), which already grants calendar.events and
// drive.file. Eddie reads the agenda and creates events on its own; moving
// or deleting one goes through the confirmation card. Tasks also add events
// from the Tareas module, and chat replies can be saved to Drive. Gmail is
// its own connector (gmail/).
import { getGrantedScopes, getValidAccessToken, hasGoogleCredentials } from '../../googleCredentials.js';
import { addDays, dayLabel, localParts, resolveDate, resolveTime, todayIn, zonedInstant } from '../dates.js';
import { clip, fetchJson } from '../http.js';

const API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const MAX_EVENTS = 25;
const MAX_RANGE_DAYS = 31;
const DEFAULT_MINUTES = 60;

class CalendarError extends Error {}

async function calendarToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new CalendarError('Para usar tu Calendario, inicia sesión con Google (Configuración → Cuenta de Google).');
  const granted = await getGrantedScopes(user.id);
  if (!granted.includes(CALENDAR_SCOPE)) throw new CalendarError('Falta el permiso del Calendario: cierra sesión y vuelve a iniciarla con Google aceptando todas las casillas.');
  try {
    return await getValidAccessToken(user.id);
  } catch (err) {
    throw new CalendarError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a iniciar sesión.');
  }
}

async function calendar(token, path = '', options = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new CalendarError('Google rechazó el acceso al Calendario. Vuelve a iniciar sesión con Google.');
  if (status === 403) throw new CalendarError('Falta el permiso del Calendario. Vuelve a iniciar sesión con Google y acepta todas las casillas.');
  if (status === 404 || status === 410) throw new CalendarError('Ese evento ya no existe.');
  throw new CalendarError(data?.error?.message || 'Google Calendar no respondió en este momento.');
}

// "Comprueba": after writing, read the event back from Google and check it
// really is there as asked. true = confirmed, false = it doesn't match,
// null = couldn't check (the write itself still went through).
async function readBack(token, id, isRight) {
  try {
    return Boolean(isRight(await calendar(token, `/${encodeURIComponent(id)}`)));
  } catch {
    return null;
  }
}

// After a delete, Google answers 404/410, or returns the event as cancelled.
async function confirmGone(token, id) {
  try {
    return (await calendar(token, `/${encodeURIComponent(id)}`)).status === 'cancelled';
  } catch (err) {
    return err instanceof CalendarError && /ya no existe/.test(err.message) ? true : null;
  }
}

// One line for the receipt, stating whether the check passed.
function withCheck(text, verified) {
  if (verified === true) return `${text} Comprobado en tu Calendario.`;
  if (verified === false) return `${text} Pero al releerlo en tu Calendario no coincide: revísalo.`;
  return text;
}

function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof CalendarError) return { error: err.message };
      throw err;
    }
  };
}

// A Google event reduced to what the model needs, in the user's local time.
function describeEvent(e, timezone) {
  const allDay = Boolean(e.start?.date);
  const out = { id: e.id, title: e.summary || '(sin título)', all_day: allDay };
  if (allDay) {
    out.date = e.start.date;
    out.day = dayLabel(e.start.date);
    const last = addDays(e.end?.date || e.start.date, -1);
    if (last > e.start.date) out.until = last;
  } else {
    const start = localParts(e.start.dateTime, timezone);
    const end = localParts(e.end?.dateTime || e.start.dateTime, timezone);
    Object.assign(out, { date: start.date, day: dayLabel(start.date), start: start.time, end: end.time });
    if (end.date !== start.date) out.end_date = end.date;
  }
  if (e.location) out.location = clip(e.location, 120);
  return out;
}

async function listEvents(args, context) {
  const tz = context.timezone || 'UTC';
  const from = resolveDate(args.from || 'hoy', tz);
  if (!from) return { error: `No entendí la fecha "${args.from}".` };
  const to = args.to ? resolveDate(args.to, tz) : addDays(from, 6);
  if (!to) return { error: `No entendí la fecha "${args.to}".` };
  if (to < from) return { error: 'La fecha final es anterior a la inicial.' };
  const lastDay = to > addDays(from, MAX_RANGE_DAYS) ? addDays(from, MAX_RANGE_DAYS) : to;
  const token = await calendarToken(context);
  const params = new URLSearchParams({
    timeMin: zonedInstant(from, '00:00', tz),
    timeMax: zonedInstant(addDays(lastDay, 1), '00:00', tz),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_EVENTS),
  });
  if (args.query) params.set('q', clip(args.query, 100));
  const data = await calendar(token, `?${params}`);
  const events = (data?.items || []).filter((e) => e.status !== 'cancelled').map((e) => describeEvent(e, tz));
  return { from, to: lastDay, today: todayIn(tz), events, note: events.length ? undefined : 'No hay eventos en ese período.' };
}

// Start/end for a new or moved event. Timed events carry the user's zone so
// Google stores the right local hour; all-day events use Google's exclusive
// end date.
function eventTimes({ date, start, end, minutes }, tz) {
  if (!start) return { start: { date }, end: { date: addDays(date, 1) } };
  let endTime = end;
  let endDate = date;
  if (!endTime) {
    const [h, m] = start.split(':').map(Number);
    const total = h * 60 + m + (minutes || DEFAULT_MINUTES);
    endDate = total >= 1440 ? addDays(date, 1) : date;
    endTime = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  } else if (endTime <= start) {
    endDate = addDays(date, 1);
  }
  return {
    start: { dateTime: `${date}T${start}:00`, timeZone: tz },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: tz },
  };
}

function readTimes(args, tz) {
  const date = resolveDate(args.date, tz);
  if (date === undefined) return { error: `No entendí la fecha "${args.date}". Usa AAAA-MM-DD, "hoy", "mañana" o un día de la semana.` };
  const start = resolveTime(args.start_time);
  if (start === undefined) return { error: `No entendí la hora "${args.start_time}". Usa HH:MM (24 h).` };
  const end = resolveTime(args.end_time);
  if (end === undefined) return { error: `No entendí la hora "${args.end_time}". Usa HH:MM (24 h).` };
  if (end && !start) return { error: 'Si das hora de fin, falta la hora de inicio.' };
  return { date, start, end };
}

async function createEvent(args, context) {
  const tz = context.timezone || 'UTC';
  const title = clip(args.title, 200);
  if (!title) return { error: 'El evento necesita un título.' };
  const times = readTimes(args, tz);
  if (times.error) return times;
  if (!times.date) return { error: 'Falta la fecha del evento.' };
  const minutes = Number.isInteger(args.duration_minutes) && args.duration_minutes > 0 ? Math.min(args.duration_minutes, 1440) : undefined;
  const token = await calendarToken(context);
  const body = { summary: title, ...eventTimes({ ...times, minutes }, tz) };
  if (args.location) body.location = clip(args.location, 200);
  if (args.description) body.description = clip(args.description, 1000);
  const event = await calendar(token, '', { method: 'POST', body: JSON.stringify(body) });
  const verified = await readBack(token, event.id, (e) => e.status !== 'cancelled' && e.summary === title);
  return { created: true, event: describeEvent(event, tz), link: event.htmlLink, verified };
}

function whenText(e) {
  if (e.all_day) return `${e.day} (todo el día)`;
  return `${e.day}, ${e.start}–${e.end}`;
}

// Moving: new date and/or times, keeping what isn't given (same hour on a
// new day, same length with a new start). The card shows before → after
// and lets the user fix the date and times.
async function prepareUpdate(args, context) {
  const tz = context.timezone || 'UTC';
  const times = readTimes(args, tz);
  if (times.error) return times;
  const newTitle = args.title ? clip(args.title, 200) : null;
  if (!times.date && !times.start && !newTitle) return { error: 'Indica la nueva fecha, la nueva hora o el nuevo título.' };
  const token = await calendarToken(context);
  const event = await calendar(token, `/${encodeURIComponent(args.event_id)}`);
  const current = describeEvent(event, tz);

  const date = times.date || current.date;
  let { start, end } = times;
  if (!start && !current.all_day) {
    start = current.start;
    end = current.end;
  } else if (start && !end && !current.all_day) {
    const [sh, sm] = current.start.split(':').map(Number);
    const [eh, em] = current.end.split(':').map(Number);
    const length = (eh * 60 + em - (sh * 60 + sm) + 1440) % 1440 || DEFAULT_MINUTES;
    const [nh, nm] = start.split(':').map(Number);
    const total = nh * 60 + nm + length;
    end = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  const after = start ? `${dayLabel(date)}, ${start}–${end}` : `${dayLabel(date)} (todo el día)`;
  const prepared = { event_id: event.id, date };
  if (start) Object.assign(prepared, { start_time: start, end_time: end });
  if (newTitle) prepared.title = newTitle;
  return {
    args: prepared,
    preview: {
      title: 'Mover evento',
      confirmLabel: 'Mover',
      fields: [
        { key: 'event', label: 'Evento', value: newTitle ? `${current.title} → ${newTitle}` : current.title },
        { key: 'before', label: 'Antes', value: whenText(current) },
        { key: 'after', label: 'Después', value: after },
        { key: 'date', label: 'Fecha', value: date, editable: true },
        ...(start ? [{ key: 'start_time', label: 'Inicio', value: start, editable: true }, { key: 'end_time', label: 'Fin', value: end, editable: true }] : []),
      ],
    },
  };
}

async function updateEvent(args, context) {
  const tz = context.timezone || 'UTC';
  const token = await calendarToken(context);
  const body = eventTimes({ date: args.date, start: args.start_time || null, end: args.end_time || null }, tz);
  if (args.title) body.summary = args.title;
  const event = await calendar(token, `/${encodeURIComponent(args.event_id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  const moved = describeEvent(event, tz);
  const verified = await readBack(token, args.event_id, (e) => {
    const now = describeEvent(e, tz);
    return e.status !== 'cancelled' && now.date === moved.date && now.start === moved.start;
  });
  return { updated: true, event: moved, verified, summary: withCheck(`Listo: "${moved.title}" quedó el ${whenText(moved)}.`, verified) };
}

async function prepareDelete(args, context) {
  const tz = context.timezone || 'UTC';
  const token = await calendarToken(context);
  const event = describeEvent(await calendar(token, `/${encodeURIComponent(args.event_id)}`), tz);
  return {
    args: { event_id: event.id },
    preview: {
      title: 'Borrar evento',
      confirmLabel: 'Borrar',
      danger: true,
      fields: [
        { key: 'event', label: 'Evento', value: event.title },
        { key: 'when', label: 'Cuándo', value: whenText(event) },
      ],
    },
  };
}

async function deleteEvent(args, context) {
  const tz = context.timezone || 'UTC';
  const token = await calendarToken(context);
  const event = describeEvent(await calendar(token, `/${encodeURIComponent(args.event_id)}`), tz);
  await calendar(token, `/${encodeURIComponent(args.event_id)}`, { method: 'DELETE' });
  const verified = await confirmGone(token, args.event_id);
  return { deleted: true, verified, summary: withCheck(`Borré "${event.title}" del ${whenText(event)}.`, verified) };
}

const EVENT_ID = { event_id: { type: 'STRING', description: 'El id del evento que devolvió list_events.' } };
const DATE_TIME = {
  date: { type: 'STRING', description: 'Fecha: AAAA-MM-DD, "hoy", "mañana", "pasado mañana" o un día de la semana.' },
  start_time: { type: 'STRING', description: 'Hora de inicio HH:MM en 24 h (p. ej. "15:30"). Sin hora = evento de todo el día.' },
  end_time: { type: 'STRING', description: 'Hora de fin HH:MM en 24 h (opcional).' },
};

export default {
  id: 'google',
  name: 'Google Calendar y Drive',
  description: 'Eddie consulta tu agenda y crea eventos; los mueve o borra con tu confirmación. También guarda respuestas en Drive y pasa tareas al Calendario.',
  icon: 'calendar',
  auth: {
    type: 'google-login',
    isConnected: (user) => hasGoogleCredentials(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  note: 'Usa el Calendario principal de tu cuenta de Google.',
  tools: [
    {
      label: 'Ver tu agenda',
      activity: 'Revisando tu agenda…',
      summarize: (result) => `${result.events.length} evento${result.events.length === 1 ? '' : 's'} (${result.from}${result.to !== result.from ? ` a ${result.to}` : ''})`,
      sensitive: false,
      declaration: {
        name: 'list_events',
        description:
          'Lista los eventos del Calendario de Google del usuario entre dos fechas (por defecto, de hoy a 7 días). Úsala para "¿qué tengo hoy/mañana/esta semana?", para ver si hay tiempo libre y para encontrar el id de un evento antes de moverlo o borrarlo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            from: { type: 'STRING', description: 'Desde: AAAA-MM-DD, "hoy", "mañana" o un día de la semana (por defecto hoy).' },
            to: { type: 'STRING', description: 'Hasta (incluido), mismo formato (por defecto 6 días después de "from").' },
            query: { type: 'STRING', description: 'Texto para filtrar eventos, p. ej. "dentista".' },
          },
        },
      },
      run: guarded(listEvents),
    },
    {
      label: 'Crear eventos',
      activity: 'Creando el evento…',
      summarize: (result) => `Evento creado: ${result.event.title} · ${result.event.day}${result.event.start ? ` ${result.event.start}–${result.event.end}` : ''}`,
      sensitive: false,
      declaration: {
        name: 'create_event',
        description:
          'Crea un evento en el Calendario del usuario. Sin hora de inicio queda como evento de todo el día; con inicio y sin fin dura 1 hora (o duration_minutes). Confirma luego al usuario el día y la hora exactos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Título breve del evento.' },
            ...DATE_TIME,
            duration_minutes: { type: 'INTEGER', description: 'Duración en minutos si no hay hora de fin.' },
            location: { type: 'STRING', description: 'Lugar (opcional).' },
            description: { type: 'STRING', description: 'Notas (opcional).' },
          },
          required: ['title', 'date'],
        },
      },
      run: guarded(createEvent),
    },
    {
      label: 'Mover eventos',
      activity: 'Preparando el cambio…',
      sensitive: true,
      declaration: {
        name: 'update_event',
        description:
          'Mueve o renombra un evento existente (id de list_events). Si solo cambia el día, conserva la hora; si solo cambia la hora de inicio, conserva la duración. El usuario lo confirma en una tarjeta.',
        parameters: {
          type: 'OBJECT',
          properties: { ...EVENT_ID, ...DATE_TIME, title: { type: 'STRING', description: 'Nuevo título (opcional).' } },
          required: ['event_id'],
        },
      },
      prepare: guarded(prepareUpdate),
      run: guarded(updateEvent),
    },
    {
      label: 'Borrar eventos',
      activity: 'Preparando la confirmación…',
      sensitive: true,
      declaration: {
        name: 'delete_event',
        description: 'Borra un evento del Calendario (id de list_events). El usuario lo confirma en una tarjeta.',
        parameters: { type: 'OBJECT', properties: EVENT_ID, required: ['event_id'] },
      },
      prepare: guarded(prepareDelete),
      run: guarded(deleteEvent),
    },
  ],
  webhook: null,
};
