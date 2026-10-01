// The morning summary Eddie sends on Telegram: today's agenda, reminders,
// pending tasks, important mail and headlines. The text is put together from
// the same data the "Hoy" panel shows (collectToday), with no AI call, so it
// arrives even when a provider is out of quota.
import { collectToday } from '../todayHandlers.js';
import { sanitizeConnectorIds } from '../handler.js';
import { loadUserContext } from '../telegram/serverActions.js';
import { addDays, localParts } from '../connectors/dates.js';
import { listPendingReminders } from './store.js';

const MAX_EVENTS = 8;
const MAX_TASKS = 6;
const MAX_MAILS = 5;
const MAX_HEADLINES = 3;
const PRIORITY_RANK = { alta: 0, media: 1, baja: 2 };

// "Ana Pérez <ana@x.com>" -> "Ana Pérez"; a bare address stays as it is.
export function senderName(from) {
  const s = String(from || '').trim();
  const m = /^"?([^"<]+?)"?\s*<[^>]+>$/.exec(s);
  return (m ? m[1] : s.replace(/[<>]/g, '')).trim() || 'Alguien';
}

function dateLine(timezone, now) {
  try {
    return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(now);
  }
}

function eventLine(e) {
  return e.all_day ? `• Todo el día: ${e.title}` : `• ${e.start}–${e.end} ${e.title}${e.location ? ` (${e.location})` : ''}`;
}

function taskLine(t, today) {
  const tags = [];
  if (t.dueDate && t.dueDate < today) tags.push('vencida');
  else if (t.dueDate === today) tags.push('hoy');
  else if (t.dueDate) tags.push(`para ${t.dueDate}`);
  if (t.priority === 'alta') tags.push('prioridad alta');
  return `• ${t.title}${tags.length ? ` (${tags.join(', ')})` : ''}`;
}

// Pure: turns the collected data into the message. `data` has calendar, mail
// and news sections as collectToday returns them; tasks and reminders are
// plain lists.
export function formatBriefing({ name, timezone, now = new Date(), calendar, mail, news, tasks = [], reminders = [] }) {
  const today = localParts(now.toISOString(), timezone).date;
  const tomorrow = addDays(today, 1);
  const first = String(name || '').trim().split(/\s+/)[0];
  const lines = [`☀️ Buenos días${first ? `, ${first}` : ''}. Hoy es ${dateLine(timezone, now)}.`];

  // Agenda
  if (calendar?.status === 'ok') {
    const todays = (calendar.events || []).filter((e) => e.date === today || (e.all_day && e.date < today && (e.until || e.date) >= today));
    const tomorrows = (calendar.events || []).filter((e) => e.date === tomorrow);
    lines.push('', '📅 Agenda de hoy');
    if (todays.length) lines.push(...todays.slice(0, MAX_EVENTS).map(eventLine), ...(todays.length > MAX_EVENTS ? [`• …y ${todays.length - MAX_EVENTS} más`] : []));
    else lines.push('Nada en tu calendario para hoy.');
    if (tomorrows.length) {
      const timed = tomorrows.find((e) => !e.all_day);
      lines.push(`Mañana: ${tomorrows.length} evento${tomorrows.length === 1 ? '' : 's'}${timed ? `, el primero a las ${timed.start} (${timed.title})` : ''}.`);
    }
  } else if (calendar?.status === 'error') {
    lines.push('', `📅 No pude leer tu agenda: ${calendar.message}`);
  }

  // Reminders due today
  const dueToday = reminders.filter((r) => localParts(r.dueAt, timezone).date === today);
  if (dueToday.length) {
    lines.push('', '⏰ Recordatorios de hoy', ...dueToday.map((r) => `• ${localParts(r.dueAt, timezone).time} ${r.text}`));
  }

  // Tasks
  const pending = tasks.filter((t) => !t.done);
  if (pending.length) {
    const rank = (t) => (t.dueDate && t.dueDate <= today ? 0 : 1);
    const sorted = [...pending].sort((a, b) => rank(a) - rank(b) || (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) || String(a.dueDate || '9').localeCompare(String(b.dueDate || '9')));
    lines.push('', `✅ Tareas pendientes (${pending.length})`, ...sorted.slice(0, MAX_TASKS).map((t) => taskLine(t, today)));
    if (pending.length > MAX_TASKS) lines.push(`• …y ${pending.length - MAX_TASKS} más`);
  }

  // Mail
  if (mail?.status === 'ok') {
    const emails = mail.emails || [];
    if (emails.length) {
      lines.push('', `✉️ Correos importantes sin leer (${emails.length})`, ...emails.slice(0, MAX_MAILS).map((m) => `• ${senderName(m.from)} — ${m.subject}`));
    } else {
      lines.push('', '✉️ No tienes correos importantes sin leer.');
    }
  } else if (mail?.status === 'error') {
    lines.push('', `✉️ No pude leer tus correos: ${mail.message}`);
  }

  // Headlines
  if (news?.status === 'ok' && news.headlines?.length) {
    lines.push('', '📰 Titulares', ...news.headlines.slice(0, MAX_HEADLINES).map((h) => `• ${h.title}${h.source ? ` (${h.source})` : ''}`));
  }

  lines.push('', 'Escríbeme o mándame una nota de voz si quieres que me encargue de algo. ¡Buen día!');
  return lines.join('\n');
}

// Collects everything for one linked user and formats it. `link` is a Telegram
// link ({ userId, timezone, user }).
export async function buildBriefing(link, now = new Date()) {
  const ctx = await loadUserContext(link.userId);
  const off = sanitizeConnectorIds(ctx.settings.disabledConnectors);
  const [data, reminders] = await Promise.all([
    collectToday({ timezone: link.timezone, disabled: off, getUser: async () => link.user }),
    off.includes('reminders') ? [] : listPendingReminders(link.userId),
  ]);
  return formatBriefing({ name: link.user?.name, timezone: link.timezone, now, calendar: data.calendar, mail: data.mail, news: data.news, tasks: ctx.tasks, reminders });
}
