// Eddie as the business's receptionist, working for the user: he knows the opening
// hours, says when there is room in the agenda, books an appointment inside those
// hours (after the user's OK on a card; the appointment lives in Google Calendar) and
// takes a message for the user when someone cannot be reached («recados»). He never
// answers third parties on his own: he works for the user, who asks him («Ana quiere cita
// el jueves»), and the confirmation to the client is a draft the user sends himself
// (Contactos → prepare_message). Free time is always checked against the real Calendar.
import { calendarApi } from '../google/index.js';
import { addMessage, getSettings, listMessages, markHandled, saveSettings } from '../../reception/store.js';
import { MAX_MESSAGES, MAX_SLOT, MIN_SLOT, busyOnDay, dayWindows, describeHours, foldSlots, freeSlots, hasHours, parseDays, toMinutes, withDays } from '../../../../src/services/reception.js';
import { addDays, dayLabel, localParts, resolveDate, resolveTime, todayIn } from '../dates.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para usar la recepción inicia sesión con Google (Configuración → Cuenta de Google).';
const NO_HOURS = 'Todavía no sé tu horario de atención. Pregúntale al usuario qué días y a qué horas atiende y guárdalo con reception_set_hours.';
const MAX_DAYS = 7;
const MAX_DURATION = 480;
const MAX_FREE_SHOWN = 6;
const DUPLICATE_WINDOW_MS = 3 * 60 * 1000;

const getUser = async (context) => context.getUser?.();
const tzOf = (context) => context.timezone || 'UTC';
const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nowMinutes = (tz) => toMinutes(localParts(new Date().toISOString(), tz).time);

function durationOf(value, settings) {
  const n = value == null ? settings.slotMinutes : Number(value);
  if (!Number.isFinite(n) || n < 5 || n > MAX_DURATION) return { error: `La duración debe estar entre 5 y ${MAX_DURATION} minutos.` };
  return { minutes: Math.round(n) };
}

// Each day from `from`, `days` long, with its opening windows and busy times from the real Calendar.
async function calendarDays({ settings, from, days, context }) {
  const tz = tzOf(context);
  const data = await calendarApi.list({ from, to: addDays(from, days - 1), max: 250 }, context);
  if (data.error) return { error: data.error };
  const today = todayIn(tz);
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const date = addDays(from, i);
    out.push({ date, windows: settings.hours[weekdayOf(date)] || [], past: date < today, busy: busyOnDay(data.events, date), notBefore: date === today ? nowMinutes(tz) : 0, events: data.events });
  }
  return { days: out, truncated: (data.events || []).length >= 250 };
}

// Start times (HH:MM) free in one day for an appointment of `duration`, one every `step` minutes.
const slotsOf = (day, duration, step) => (day.past || !day.windows.length ? [] : freeSlots({ windows: day.windows, busy: day.busy, duration, step, notBefore: day.notBefore }));

async function availability(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const settings = await getSettings(user.id);
  if (!hasHours(settings.hours)) return { error: NO_HOURS };
  const tz = tzOf(context);
  const from = resolveDate(args.date || 'hoy', tz);
  if (!from) return { error: `No entendí la fecha «${args.date}». Usa AAAA-MM-DD, «hoy», «mañana» o un día de la semana.` };
  const days = Math.min(Math.max(Math.round(Number(args.days) || 1), 1), MAX_DAYS);
  const dur = durationOf(args.duration_minutes, settings);
  if (dur.error) return dur;
  const free = await calendarDays({ settings, from, days, context });
  if (free.error) return free;
  const list = free.days.map((d) => {
    const slots = slotsOf(d, dur.minutes, settings.slotMinutes);
    return { date: d.date, day: dayLabel(d.date), ...(d.past ? { past: true } : !d.windows.length ? { closed: true } : { free: foldSlots(slots, settings.slotMinutes), free_count: slots.length }) };
  });
  const open = list.filter((d) => d.free_count);
  return {
    duration_minutes: dur.minutes,
    hours: describeHours(settings.hours),
    days: list,
    ...(free.truncated ? { note: 'Hay muchísimos eventos en esas fechas y la lista pudo cortarse: confirma con el usuario antes de prometer una hora.' } : {}),
    summary: open.length ? `Hay lugar ${open.length === 1 ? 'el' : 'en'} ${open.slice(0, 3).map((d) => d.day).join(', ')}` : 'No hay lugar en esas fechas',
  };
}

async function setHours(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const settings = await getSettings(user.id);
  let { hours, slotMinutes } = settings;
  if (args.slot_minutes != null) {
    const n = Number(args.slot_minutes);
    if (!Number.isInteger(n) || n < MIN_SLOT || n > MAX_SLOT) return { error: `La duración de cada cita debe ser un número de minutos entre ${MIN_SLOT} y ${MAX_SLOT}.` };
    slotMinutes = n;
  }
  if (args.days != null && String(args.days).trim()) {
    const days = parseDays(args.days);
    if (!days) return { error: `No entendí los días «${clip(args.days, 40)}». Usa por ejemplo «lun-vie», «lunes a viernes», «martes y jueves», «sábado» o «todos los días».` };
    if (args.closed) hours = withDays(hours, days, []);
    else {
      const start = resolveTime(args.start_time);
      const end = resolveTime(args.end_time);
      if (!start || !end) return { error: 'Dame la hora de apertura y de cierre (por ejemplo 09:00 y 17:00).' };
      const win = dayWindows({ start, end, breakStart: resolveTime(args.break_start), breakEnd: resolveTime(args.break_end) });
      if (win.error) return { error: win.error };
      hours = withDays(hours, days, win.windows);
    }
  } else if (args.slot_minutes == null) {
    return { error: 'Dime qué días y a qué horas atiende (days, start_time, end_time), o cuánto dura cada cita (slot_minutes).' };
  }
  await saveSettings(user.id, { hours, slotMinutes });
  const saved = await getSettings(user.id);
  return { saved: true, hours: describeHours(saved.hours), slot_minutes: saved.slotMinutes, summary: `Horario guardado: ${describeHours(saved.hours)}`, ...(hasHours(saved.hours) ? {} : { note: 'Todos los días quedaron cerrados.' }) };
}

// Checks that an appointment fits: not in the past, inside the opening hours and not on top of anything in
// the Calendar. Any start on the minute is fine (14:10 with 30-minute slots); the slot grid only decides
// which times Eddie offers. → { client, date, start, minutes, phone, topic } or { error } saying what is free instead.
async function checkSlot(args, context, settings) {
  const tz = tzOf(context);
  const client = clip(args.client, 80);
  if (!client) return { error: 'Dime el nombre de quien pide la cita.' };
  const date = resolveDate(args.date, tz);
  if (date === undefined) return { error: `No entendí la fecha «${args.date}». Usa AAAA-MM-DD, «mañana» o un día de la semana.` };
  if (!date) return { error: 'Falta el día de la cita.' };
  const start = resolveTime(args.start_time);
  if (start === undefined) return { error: `No entendí la hora «${args.start_time}». Usa HH:MM (24 h).` };
  if (!start) return { error: 'Falta la hora de la cita.' };
  const dur = durationOf(args.duration_minutes, settings);
  if (dur.error) return dur;
  const startMin = toMinutes(start);
  if (date < todayIn(tz) || (date === todayIn(tz) && startMin < nowMinutes(tz))) return { error: 'Esa hora ya pasó. Pídele al usuario otro día u hora.' };
  const found = await calendarDays({ settings, from: date, days: 1, context });
  if (found.error) return found;
  const [day] = found.days;
  const offered = foldSlots(slotsOf(day, dur.minutes, settings.slotMinutes), settings.slotMinutes);
  const instead = offered.length ? ` Ese día hay lugar a: ${offered.slice(0, MAX_FREE_SHOWN).join(', ')}.` : ' Ese día no queda lugar; mira otro con reception_availability.';
  if (!day.windows.length) return { error: `${dayLabel(date)} no se atiende (horario: ${describeHours(settings.hours)}). Mira otro día con reception_availability.` };
  if (!day.windows.some(([a, b]) => startMin >= toMinutes(a) && startMin + dur.minutes <= toMinutes(b))) {
    return { error: `A las ${start} (${dur.minutes} min) no cabe en el horario de ese día (${day.windows.map(([a, b]) => `${a}–${b}`).join(' y ')}).${instead}` };
  }
  if (day.busy.some(([a, b]) => startMin < b && startMin + dur.minutes > a)) return { error: `A las ${start} ya hay algo en el Calendario.${instead}` };
  return { client, date, start, minutes: dur.minutes, phone: clip(args.phone, 40), topic: clip(args.topic, 120) };
}

async function prepareBook(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const settings = await getSettings(user.id);
  if (!hasHours(settings.hours)) return { error: NO_HOURS };
  const slot = await checkSlot(args, context, settings);
  if (slot.error) return slot;
  return {
    args: { client: slot.client, date: slot.date, start_time: slot.start, duration_minutes: slot.minutes, ...(slot.phone ? { phone: slot.phone } : {}), ...(slot.topic ? { topic: slot.topic } : {}) },
    preview: {
      title: 'Agendar una cita',
      confirmLabel: 'Agendar',
      fields: [
        { key: 'client', label: 'Cliente', value: slot.client },
        { key: 'date', label: 'Día', value: `${dayLabel(slot.date)} (${slot.date})` },
        { key: 'start_time', label: 'Hora', value: slot.start, editable: true },
        { key: 'duration_minutes', label: 'Duración', value: `${slot.minutes} min` },
        ...(slot.topic ? [{ key: 'topic', label: 'Motivo', value: slot.topic }] : []),
        ...(slot.phone ? [{ key: 'phone', label: 'Teléfono', value: slot.phone }] : []),
      ],
    },
  };
}

async function book(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const settings = await getSettings(user.id);
  if (!hasHours(settings.hours)) return { error: NO_HOURS };
  // Checked again now: the agenda may have changed since the card was shown, and the hour may have been edited on it.
  const slot = await checkSlot({ ...args, duration_minutes: Number(args.duration_minutes) || undefined }, context, settings);
  if (slot.error) return slot;
  const title = `Cita: ${slot.client}${slot.topic ? ` — ${slot.topic}` : ''}`;
  const description = [slot.phone ? `Teléfono: ${slot.phone}` : '', slot.topic ? `Motivo: ${slot.topic}` : '', 'Agendada por Eddie.'].filter(Boolean).join('\n');
  const made = await calendarApi.create({ title, date: slot.date, start_time: slot.start, duration_minutes: slot.minutes, description }, context);
  if (made.error) return made;
  return {
    booked: true,
    event: made.event,
    link: made.link,
    verified: made.verified,
    summary: `Agendé a ${slot.client}: ${dayLabel(slot.date)} a las ${slot.start} (${slot.minutes} min)${made.verified === true ? '. Comprobado en tu Calendario' : ''}`,
    note: 'Ofrécele al usuario preparar el mensaje de confirmación para el cliente (prepare_message de Contactos): tú no lo envías.',
  };
}

// The appointments on the Calendar (the ones Eddie booked start with «Cita»), with the ids that update_event and delete_event need.
async function appointments(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const tz = tzOf(context);
  const from = resolveDate(args.from || 'hoy', tz);
  if (!from) return { error: `No entendí la fecha «${args.from}». Usa AAAA-MM-DD, «hoy», «mañana» o un día de la semana.` };
  const days = Math.min(Math.max(Math.round(Number(args.days) || 14), 1), 31);
  const data = await calendarApi.list({ from, to: addDays(from, days - 1), max: 250, ...(args.query ? { query: args.query } : {}) }, context);
  if (data.error) return data;
  const all = args.all === true;
  const events = (data.events || []).filter((e) => all || /^cita\b/i.test(e.title || ''));
  return {
    from,
    to: addDays(from, days - 1),
    count: events.length,
    appointments: events.slice(0, 30).map((e) => ({ id: e.id, title: e.title, date: e.date, day: e.day, start: e.start || null, end: e.end || null, all_day: e.all_day || undefined })),
    summary: events.length ? `${events.length} cita${events.length === 1 ? '' : 's'}` : 'No hay citas en esas fechas',
    note: events.length ? 'Para mover una usa update_event y para cancelarla delete_event, con el id (piden tarjeta). Para mover, mira antes reception_availability del día nuevo.' : 'No hay citas con «Cita» en el título en ese rango. Si buscas otro tipo de evento, vuelve a llamar con all: true.',
  };
}

async function takeMessage(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const from = clip(args.from_name, 80);
  const message = clip(args.message, 500);
  if (!from) return { error: 'Dime quién dejó el recado.' };
  if (!message) return { error: 'Dime qué dice el recado.' };
  const open = await listMessages(user.id, { handled: false });
  const twin = open.find((m) => plain(m.from) === plain(from) && plain(m.message) === plain(message) && Date.now() - new Date(m.createdAt).getTime() < DUPLICATE_WINDOW_MS);
  if (twin) return { saved: true, duplicate: true, summary: `Ya estaba anotado el recado de ${from}` };
  if (open.length >= MAX_MESSAGES) return { error: `Hay ${MAX_MESSAGES} recados sin atender, que es el tope. Marca algunos como atendidos antes de anotar más.` };
  const saved = await addMessage(user.id, { from, phone: clip(args.phone, 40), message, urgent: Boolean(args.urgent) });
  return { saved: true, id: saved.id, urgent: saved.urgent, summary: `Anoté el recado de ${from}${saved.urgent ? ' (urgente)' : ''}`, note: 'Dilo en una frase corta. El usuario lo verá en su resumen de la mañana o cuando pregunte por sus recados.' };
}

async function messages(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const all = args.status === 'todos';
  const done = args.status === 'atendidos';
  const list = await listMessages(user.id, { handled: all ? null : done, limit: Math.min(Math.max(Number(args.limit) || 15, 1), 30) });
  return {
    count: list.length,
    items: list.map((m) => ({ id: m.id, from: m.from, phone: m.phone || null, message: m.message, urgent: m.urgent || undefined, handled: m.handled, received: m.createdAt })),
    summary: list.length ? `${list.length} recado${list.length === 1 ? '' : 's'}${all || done ? '' : ' sin atender'}` : 'No hay recados sin atender',
  };
}

async function messageDone(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const open = await listMessages(user.id, { handled: false });
  const q = String(args.id || args.query || '').trim();
  if (!q) return { error: 'Dime cuál recado (el id de reception_messages, o quién lo dejó).' };
  let found = open.filter((m) => m.id === q);
  if (!found.length) {
    const words = plain(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
    found = words.length ? open.filter((m) => words.every((w) => plain(`${m.from} ${m.message}`).includes(w))) : [];
  }
  if (!found.length) return { error: 'No encontré ese recado entre los pendientes.' };
  if (found.length > 1) return { error: `Hay varios recados que encajan: ${found.slice(0, 5).map((m) => `${m.id.slice(0, 8)}… ${m.from}: ${clip(m.message, 40)}`).join('; ')}. Pásame el id completo de reception_messages o pregunta cuál.` };
  const saved = await markHandled(user.id, found[0].id);
  return saved ? { handled: true, summary: `Marqué como atendido el recado de ${saved.from}` } : { error: 'Ese recado ya no existe.' };
}

export default {
  id: 'reception',
  name: 'Recepción',
  description:
    'Eddie hace de recepcionista para ti: conoce tu horario de atención, te dice cuándo hay lugar en tu agenda, agenda citas en tu Google Calendar (con tu confirmación) y anota los recados de quien te busca para que no se pierdan. No contesta a tus clientes por su cuenta: trabaja para ti.',
  icon: 'phone',
  category: 'agenda',
  route:
    /\bcitas?\b|ag[eé]nd(a|ar|e|ame|ale)\b|horario|disponib|hay (lugar|espacio|hueco)|hueco|recados?|recado|dej[oó] (dicho|un mensaje)|me (llam[oó]|busc[oó]|escribi[oó])|lo que (dej[oó]|dijo)|reserv|turno|atenci[oó]n al cliente|recepci[oó]n|recepcionista|cu[aá]ndo (puede|puedo|atiend)|quiere (una )?cita/i,
  companions: ['contacts', 'google'],
  guide: `RECEPCIÓN — cómo y cuándo:
1. Sin horario guardado, pregúntalo una sola vez (días, apertura, cierre, descanso) y guárdalo con reception_set_hours; no inventes uno.
2. Antes de proponer o prometer una hora, mira reception_availability y ofrece 2 o 3 opciones concretas, no la lista entera.
3. Agenda con reception_book (pide tarjeta). Pregunta solo lo que falte: nombre, día y hora. Si la hora choca, ofrece las alternativas que te devuelve.
4. Tras agendar, ofrece preparar el mensaje de confirmación para el cliente con prepare_message (Contactos); el usuario lo envía, tú no.
5. Para mover o cancelar: reception_appointments para ver la cita y su id, luego update_event o delete_event del Calendario (piden tarjeta). Para mover, mira antes la disponibilidad del día nuevo.
6. Cuando alguien lo buscó o dejó algo, anótalo con reception_take_message en una frase fiel, sin inventar; urgente solo si lo dijo o corre prisa. «¿Tengo recados?» = reception_messages; al atender uno, reception_message_done.
7. Trabajas para el usuario: no contestas a sus clientes ni confirmas nada a nombre suyo sin su OK.`,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Las citas se agendan en tu Google Calendar (hace falta haber dado el permiso del Calendario al iniciar sesión) y siempre piden tu confirmación; el horario y los recados se guardan en tu cuenta. Eddie no habla con tus clientes ni envía nada solo: el mensaje de confirmación es un borrador que tú envías (Contactos). Solo con sesión iniciada.',
  details: async (user) => {
    if (!user) return null;
    const settings = await getSettings(user.id);
    return { hours: hasHours(settings.hours) ? describeHours(settings.hours) : null, slotMinutes: settings.slotMinutes, openMessages: (await listMessages(user.id, { handled: false })).length };
  },
  tools: [
    {
      label: 'Guardar tu horario de atención',
      activity: 'Guardando el horario…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_set_hours',
        description:
          'Guarda el horario de atención del usuario, por días: days («lun-vie», «lunes a viernes», «martes y jueves», «sábado», «todos los días»), start_time y end_time, y opcionalmente un descanso (break_start, break_end). closed: true cierra esos días. slot_minutes es lo que dura cada cita por defecto. Se puede llamar varias veces (una por tramo de días): los días que no mencionas se quedan como estaban. No inventes el horario: pregúntalo.',
        parameters: {
          type: 'OBJECT',
          properties: {
            days: { type: 'STRING', description: 'Días: «lun-vie», «sábado», «todos los días»…' },
            start_time: { type: 'STRING', description: 'Apertura HH:MM (24 h).' },
            end_time: { type: 'STRING', description: 'Cierre HH:MM (24 h).' },
            break_start: { type: 'STRING', description: 'Inicio del descanso (almuerzo), opcional.' },
            break_end: { type: 'STRING', description: 'Fin del descanso, opcional.' },
            closed: { type: 'BOOLEAN', description: 'true = esos días no se atiende.' },
            slot_minutes: { type: 'INTEGER', description: 'Duración de cada cita en minutos (10 a 240).' },
          },
        },
      },
      run: (args, context) => setHours(args, context),
    },
    {
      label: 'Ver cuándo hay lugar',
      activity: 'Mirando tu agenda…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_availability',
        description:
          'Dice a qué horas hay lugar para una cita, dentro del horario de atención y sin chocar con lo que ya hay en el Google Calendar del usuario: «¿cuándo puede atender a Ana?», «¿hay lugar el jueves?». Devuelve rangos libres por día (ya descartando lo pasado de hoy). Úsala siempre antes de proponer o prometer una hora a alguien.',
        parameters: {
          type: 'OBJECT',
          properties: {
            date: { type: 'STRING', description: 'Desde qué día mirar: AAAA-MM-DD, «hoy», «mañana» o un día de la semana (por defecto hoy).' },
            days: { type: 'INTEGER', description: 'Cuántos días mirar (1 a 7; por defecto 1).' },
            duration_minutes: { type: 'INTEGER', description: 'Cuánto dura la cita (por defecto, la duración de cita guardada).' },
          },
        },
      },
      run: (args, context) => availability(args, context),
    },
    {
      label: 'Agendar una cita',
      activity: 'Preparando la cita…',
      sensitive: true,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_book',
        description:
          'Agenda una cita en el Google Calendar del usuario para un cliente, comprobando antes que cabe en el horario de atención y que no choca con nada. Pide confirmación con una tarjeta (la hora se puede corregir ahí). Úsala cuando el usuario diga «agenda a Ana el jueves a las 3»; si no sabes la hora libre, mira antes reception_availability. Después ofrécele preparar el mensaje de confirmación para el cliente.',
        parameters: {
          type: 'OBJECT',
          properties: {
            client: { type: 'STRING', description: 'Nombre de quien viene a la cita.' },
            date: { type: 'STRING', description: 'Día: AAAA-MM-DD, «mañana» o un día de la semana.' },
            start_time: { type: 'STRING', description: 'Hora de inicio HH:MM (24 h).' },
            duration_minutes: { type: 'INTEGER', description: 'Duración en minutos (por defecto, la guardada).' },
            topic: { type: 'STRING', description: 'Motivo de la cita, corto.' },
            phone: { type: 'STRING', description: 'Teléfono del cliente, si lo dijo.' },
          },
          required: ['client', 'date', 'start_time'],
        },
      },
      prepare: (args, context) => prepareBook(args, context),
      run: (args, context) => book(args, context),
    },
    {
      label: 'Ver las citas',
      activity: 'Mirando las citas…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_appointments',
        description:
          'Lista las citas agendadas en el Calendario del usuario (las que empiezan con «Cita»), con sus id, a partir de un día (por defecto hoy, 14 días; hasta 31). Úsala para «¿qué citas tengo?», «¿cuándo viene Ana?» y antes de mover o cancelar una cita (update_event / delete_event con ese id).',
        parameters: {
          type: 'OBJECT',
          properties: {
            from: { type: 'STRING', description: 'Desde qué día: AAAA-MM-DD, «hoy», «mañana» o un día de la semana.' },
            days: { type: 'INTEGER', description: 'Cuántos días mirar (1 a 31; por defecto 14).' },
            query: { type: 'STRING', description: 'Nombre o palabra para filtrar (por ejemplo el cliente).' },
            all: { type: 'BOOLEAN', description: 'true = todos los eventos, no solo los que empiezan con «Cita».' },
          },
        },
      },
      run: (args, context) => appointments(args, context),
    },
    {
      label: 'Anotar un recado',
      activity: 'Anotando el recado…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_take_message',
        description:
          'Anota un recado para el usuario cuando alguien lo busca y no está («Pedro llamó, quiere cotizar un logo», «dile que me escriba»). Guarda quién, qué quiere y su teléfono si lo hay; urgent si lo pide o corre prisa. No inventes datos que no te dieron.',
        parameters: {
          type: 'OBJECT',
          properties: {
            from_name: { type: 'STRING', description: 'Quién dejó el recado.' },
            message: { type: 'STRING', description: 'Qué dice o qué quiere, en una o dos frases.' },
            phone: { type: 'STRING', description: 'Teléfono para devolver la llamada, si lo dejó.' },
            urgent: { type: 'BOOLEAN', description: 'true si es urgente.' },
          },
          required: ['from_name', 'message'],
        },
      },
      run: (args, context) => takeMessage(args, context),
    },
    {
      label: 'Ver recados',
      activity: 'Revisando los recados…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_messages',
        description: 'Lista los recados que dejaron al usuario: por defecto los que siguen sin atender (los urgentes primero). «¿Quién me buscó?», «¿tengo recados?». Devuelve los id para reception_message_done.',
        parameters: {
          type: 'OBJECT',
          properties: {
            status: { type: 'STRING', enum: ['pendientes', 'atendidos', 'todos'], description: 'pendientes (por defecto), atendidos o todos.' },
            limit: { type: 'INTEGER', description: 'Cuántos mostrar (máx. 30).' },
          },
        },
      },
      run: (args, context) => messages(args, context),
    },
    {
      label: 'Marcar recado atendido',
      activity: 'Actualizando el recado…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'reception_message_done',
        description: 'Marca un recado como atendido («ya llamé a Pedro»). Indica cuál con id (de reception_messages) o con query (quién lo dejó o una palabra de su mensaje); si hay varios que encajan, te lo dice.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'El id del recado.' },
            query: { type: 'STRING', description: 'Quién lo dejó o una palabra del mensaje.' },
          },
        },
      },
      run: (args, context) => messageDone(args, context),
    },
  ],
  webhook: null,
};
