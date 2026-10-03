// Reminders and the morning summary. Eddie saves a reminder (set_reminder)
// and the scheduled job (GET /api/connectors/cron, see api/_lib/reminders/)
// sends it when its time comes — to the user's Telegram and/or as a push
// notification on the devices that enabled them (see api/_lib/push/) — and the
// same job sends the morning summary. At least one of the two must be set up,
// since those are the places Eddie can reach the user when the app is closed.
//
// Unlike the task tools, these write to the database themselves: a reminder
// has to exist on the server to fire while no browser is open.
import { addDays, dayLabel, localParts, resolveDate, resolveTime, zonedInstant } from '../dates.js';
import { clip } from '../http.js';
import { hasTelegramLink } from '../../telegram/store.js';
import { hasSubscription } from '../../push/store.js';
import { MAX_PENDING_REMINDERS, addReminder, deleteReminder, getBriefing, getReminder, listPendingReminders, setBriefing } from '../../reminders/store.js';
import { findTask } from '../tasks/index.js';

const MAX_MINUTES = 60 * 24 * 366;
const MAX_DAYS_AHEAD = 366;
const DEFAULT_TIME = '09:00';
const DEFAULT_BRIEFING_TIME = '07:00';

class ReminderError extends Error {}

// "por Telegram", "como notificación en tus dispositivos" or both.
const channelsLabel = ({ telegram, push }) => (telegram && push ? 'por Telegram y como notificación en tus dispositivos' : push ? 'como notificación en tus dispositivos' : 'por Telegram');

async function requireUser(context) {
  const user = await context.getUser?.();
  if (!user) throw new ReminderError('Para los recordatorios inicia sesión con Google (Configuración → Cuenta de Google).');
  const [telegram, push] = await Promise.all([hasTelegramLink(user.id), hasSubscription(user.id).catch(() => false)]);
  if (!telegram && !push) {
    throw new ReminderError(
      'Los recordatorios te llegan por Telegram o como notificación en tus dispositivos y todavía no tienes ninguno: vincula Telegram (Conectores → Telegram) o activa las notificaciones en Configuración → Dispositivos.',
    );
  }
  return { ...user, channels: { telegram, push } };
}

// Turns "in 20 minutes" / "tomorrow at 9" / "at 5pm" into an instant.
// Returns { instant } or { error }. With only a time, it means today, or
// tomorrow if that time has already passed.
export function resolveWhen(args, timezone, now = new Date()) {
  const tz = timezone || 'UTC';
  let instant;
  let assumed = '';
  if (args.in_minutes != null) {
    if (!Number.isInteger(args.in_minutes) || args.in_minutes < 1 || args.in_minutes > MAX_MINUTES) return { error: 'in_minutes debe ser un número entero de minutos (1 o más, máximo un año).' };
    instant = new Date(now.getTime() + args.in_minutes * 60000);
  } else {
    const time = resolveTime(args.time);
    if (time === undefined) return { error: `No entendí la hora "${args.time}". Usa HH:MM (24 h) o algo como "5pm".` };
    const today = localParts(now.toISOString(), tz).date;
    const date = resolveDate(args.date, tz, today);
    if (date === undefined) return { error: `No entendí la fecha "${args.date}". Usa AAAA-MM-DD, "hoy", "mañana" o un día de la semana.` };
    if (!time && !date) return { error: 'Dime cuándo: en cuántos minutos (in_minutes) o la hora (time) y, si no es hoy, la fecha (date).' };
    const at = time || DEFAULT_TIME;
    if (!time) assumed = ` (como no dijiste la hora, la puse a las ${DEFAULT_TIME})`;
    if (date) {
      instant = new Date(zonedInstant(date, at, tz));
    } else {
      instant = new Date(zonedInstant(today, at, tz));
      if (instant.getTime() <= now.getTime() + 30000) {
        instant = new Date(zonedInstant(addDays(today, 1), at, tz));
        assumed = ' (esa hora ya pasó hoy, así que es mañana)';
      }
    }
  }
  if (instant.getTime() <= now.getTime() + 30000) return { error: 'Esa fecha y hora ya pasó. Dame una en el futuro.' };
  if (instant.getTime() - now.getTime() > MAX_DAYS_AHEAD * 86400000) return { error: 'Solo puedo programar recordatorios hasta dentro de un año.' };
  return { instant: instant.toISOString(), assumed };
}

// "mié 1 oct, 17:00" in the user's zone.
export function whenLabel(isoInstant, timezone, now = new Date()) {
  const { date, time } = localParts(isoInstant, timezone);
  const today = localParts(now.toISOString(), timezone).date;
  const day = date === today ? 'hoy' : date === addDays(today, 1) ? 'mañana' : dayLabel(date);
  return `${day} a las ${time}`;
}

const guarded = (fn) => async (args, context) => {
  try {
    return await fn(args, context);
  } catch (err) {
    if (err instanceof ReminderError) return { error: err.message };
    throw err;
  }
};

async function setReminder(args, context) {
  const tz = context.timezone || 'UTC';
  const text = clip(args.text, 300);
  if (!text) return { error: 'El recordatorio necesita un texto (qué te recuerdo).' };
  const when = resolveWhen(args, tz);
  if (when.error) return when;
  const user = await requireUser(context);
  const pending = await listPendingReminders(user.id);
  if (pending.length >= MAX_PENDING_REMINDERS) return { error: `Ya tienes ${MAX_PENDING_REMINDERS} recordatorios pendientes; cancela alguno primero.` };
  const same = pending.find((r) => r.text.toLowerCase() === text.toLowerCase() && r.dueAt === when.instant);
  if (same) return { created: false, id: same.id, text, at: whenLabel(same.dueAt, tz), summary: `Ya tenías ese recordatorio para ${whenLabel(same.dueAt, tz)}.`, verified: true };
  const reminder = await addReminder(user.id, text, when.instant, tz);
  // "Comprueba": read it back to be sure it is saved as asked.
  const saved = await getReminder(user.id, reminder.id).catch(() => null);
  const verified = saved ? saved.text === text && saved.dueAt === when.instant : null;
  const at = whenLabel(reminder.dueAt, tz);
  return {
    created: true,
    id: reminder.id,
    text,
    at,
    verified,
    summary: `Recordatorio para ${at}: ${text}`,
    note: `Te lo mando ${channelsLabel(user.channels)}${when.assumed}. Los avisos pueden tardar unos minutos en llegar.`,
  };
}

async function listReminders(args, context) {
  const tz = context.timezone || 'UTC';
  const user = await requireUser(context);
  const pending = await listPendingReminders(user.id);
  return {
    count: pending.length,
    reminders: pending.map((r) => ({ id: r.id, text: r.text, at: whenLabel(r.dueAt, tz) })),
    ...(pending.length ? {} : { note: 'No tienes recordatorios pendientes.' }),
  };
}

async function cancelReminder(args, context) {
  const tz = context.timezone || 'UTC';
  const user = await requireUser(context);
  const pending = await listPendingReminders(user.id);
  const { task, candidates } = findTask(pending.map((r) => ({ id: r.id, title: r.text, at: r.dueAt })), args.text);
  if (!task) {
    return candidates.length
      ? { error: `Hay varios recordatorios parecidos: ${candidates.join('; ')}. Pregunta cuál.` }
      : { error: `No encontré un recordatorio pendiente que coincida con "${args.text}".` };
  }
  const removed = await deleteReminder(user.id, task.id);
  if (!removed) return { error: 'Ese recordatorio ya se envió o ya no existe.' };
  const verified = (await getReminder(user.id, task.id).catch(() => undefined)) === null;
  return { cancelled: true, text: task.title, verified, summary: `Cancelé el recordatorio «${task.title}» (era para ${whenLabel(task.at, tz)}).` };
}

async function setMorningBriefing(args, context) {
  const user = await requireUser(context);
  const current = await getBriefing(user.id);
  const time = args.time == null || args.time === '' ? current.time || DEFAULT_BRIEFING_TIME : resolveTime(args.time);
  if (time === undefined || time === null) return { error: `No entendí la hora "${args.time}". Usa HH:MM (24 h) o algo como "7am".` };
  await setBriefing(user.id, { enabled: args.enabled, time, timezone: context.timezone || null });
  const saved = await getBriefing(user.id).catch(() => null);
  const verified = saved ? saved.enabled === args.enabled && saved.time === time : null;
  return {
    enabled: args.enabled,
    time,
    verified,
    summary: args.enabled ? `Te mandaré el resumen de la mañana ${channelsLabel(user.channels)} cada día a las ${time}.` : 'Apagué el resumen de la mañana.',
    ...(args.enabled ? { note: 'Incluye tu agenda, recordatorios, tareas pendientes, correos importantes y titulares. Puede llegar unos minutos después de la hora.' } : {}),
  };
}

export default {
  id: 'reminders',
  name: 'Recordatorios',
  description: 'Eddie te avisa (por Telegram o con una notificación en tus dispositivos, aunque Eddie esté cerrado) a la hora que le pidas ("recuérdame llamar a mamá a las 5") y puede mandarte cada mañana un resumen de tu día.',
  icon: 'clock',
  category: 'agenda',
  // Offered when the conversation is about reminders, alarms or the summary.
  route: /recu[eé]rd|recordatorio|av[ií]s(a|ame|arme)|alarma|despi[eé]rta|resumen (de la )?ma[ñn]ana|resumen matutino|cada ma[ñn]ana|briefing|buenos d[ií]as|ma[ñn]ana a las|en \d+ (min|hora)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Los avisos se envían por Telegram (vincúlalo en Conectores → Telegram) y/o como notificación en tus dispositivos (Configuración → Dispositivos), y necesitan el trabajo programado: CRON_SECRET en Vercel y el flujo de GitHub Actions. Pueden llegar con unos minutos de retraso.',
  details: async (user) => {
    const [telegram, push, pending, briefing] = await Promise.all([hasTelegramLink(user.id), hasSubscription(user.id).catch(() => false), listPendingReminders(user.id, 100), getBriefing(user.id)]);
    return { telegramLinked: telegram, pushEnabled: push, pending: pending.length, briefing };
  },
  tools: [
    {
      label: 'Crear recordatorios',
      activity: 'Programando el recordatorio…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'set_reminder',
        description:
          'Programa un aviso que Eddie te manda (Telegram o notificación en tus dispositivos) a una hora concreta ("recuérdame llamar a mamá a las 5pm", "avísame en 20 minutos que saque la comida", "mañana a las 8 recuérdame la cita"). Úsalo cuando pida que le AVISES a una hora o tras un tiempo; para anotar algo pendiente sin hora usa create_task. Da in_minutes, o time (y date si no es hoy).',
        parameters: {
          type: 'OBJECT',
          properties: {
            text: { type: 'STRING', description: 'Qué recordarle, breve y directo, p. ej. "Llamar a mamá".' },
            in_minutes: { type: 'INTEGER', description: 'Avisar dentro de tantos minutos (p. ej. 20; una hora = 60).' },
            time: { type: 'STRING', description: 'Hora del aviso: HH:MM en 24 h o "5pm". Sin date, es hoy (o mañana si ya pasó).' },
            date: { type: 'STRING', description: 'Día del aviso: AAAA-MM-DD, "hoy", "mañana", "pasado mañana" o un día de la semana.' },
          },
          required: ['text'],
        },
      },
      run: guarded(setReminder),
    },
    {
      label: 'Ver recordatorios pendientes',
      activity: 'Revisando tus recordatorios…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => `${result.count} recordatorio${result.count === 1 ? '' : 's'} pendiente${result.count === 1 ? '' : 's'}`,
      declaration: {
        name: 'list_reminders',
        description: 'Lista los recordatorios pendientes del usuario ("¿qué recordatorios tengo?").',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: guarded(listReminders),
    },
    {
      label: 'Cancelar recordatorios',
      activity: 'Cancelando el recordatorio…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'cancel_reminder',
        description: 'Cancela un recordatorio pendiente ("cancela el recordatorio de mamá", "ya no me avises de la cita").',
        parameters: {
          type: 'OBJECT',
          properties: { text: { type: 'STRING', description: 'El texto del recordatorio o algo parecido.' } },
          required: ['text'],
        },
      },
      run: guarded(cancelReminder),
    },
    {
      label: 'Resumen de la mañana',
      activity: 'Configurando el resumen de la mañana…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'set_morning_briefing',
        description:
          'Enciende o apaga el resumen que Eddie manda cada mañana (Telegram o notificación) (agenda, recordatorios, tareas, correos importantes y titulares) y fija la hora ("mándame un resumen cada mañana a las 7", "ya no quiero el resumen de la mañana").',
        parameters: {
          type: 'OBJECT',
          properties: {
            enabled: { type: 'BOOLEAN', description: 'true para activarlo, false para apagarlo.' },
            time: { type: 'STRING', description: 'Hora local del resumen: HH:MM en 24 h o "7am". Si no la dice, se conserva la actual (7:00 al inicio).' },
          },
          required: ['enabled'],
        },
      },
      run: guarded(setMorningBriefing),
    },
  ],
  webhook: null,
};
