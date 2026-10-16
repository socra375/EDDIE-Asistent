// The good-morning the computer says out loud when it starts up (routine action «morning»): the greeting, today's agenda,
// the mail that matters and what is pending — from the same data as the «Hoy» panel and the Telegram summary, written to be
// HEARD (no symbols, no addresses, short sentences). Pure: the data comes in, the sentences come out, so it is tested
// without a server. The agent (public/eddie_agent.py → morning_brief) reads the pieces one at a time with the system's voice.
import { localParts } from '../connectors/dates.js';
import { MONTHS, WEEKDAYS } from '../../../src/services/briefing.js';
import { spokenClock, todaysEvents } from '../../../src/services/morningBrief.js';
import { weekdayOf } from '../../../src/services/weekdays.js';
import { senderName } from '../reminders/briefing.js';

export const MAX_SPOKEN_CHARS = 1100; // ~1 minute of speech: a good morning, not a lecture
export const MAX_PIECE_CHARS = 280;
const MAX_EVENTS = 4;
const MAX_MAILS = 3;
const MAX_TASKS = 2;
const WORDS_PER_SECOND = 2.5; // a system voice reads ~150 words a minute

export const GMAIL_URL = 'https://mail.google.com/mail/u/0/#inbox';
export const CALENDAR_URL = 'https://calendar.google.com/calendar/u/0/r/day';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What is safe and pleasant to read aloud from someone else's text (a mail subject, an event title): no links, no
// symbols or emoji, no runs of punctuation, and short.
export function speakable(value, max = 70) {
  const text = String(value ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[^\p{L}\p{N}\s.,:;¿?¡!()'’-]/gu, ' ')
    .replace(/([.,:;!?-])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : text.slice(0, max).replace(/\s+\S*$/, '');
}

// How long it takes to say it, in seconds (for how long the pages stay open).
export function estimateSpeechSeconds(text) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / WORDS_PER_SECOND);
}

function greetingFor(hour) {
  return hour < 6 ? 'Buenas noches' : hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
}

// «<intro>: a; b; c. Y 4 más.» — as many as fit in one breath (never cut in the middle of one), the rest counted.
function listPiece(intro, said, total) {
  const compose = (n) => `${intro}: ${said.slice(0, n).join('; ')}${total > n ? `. Y ${total - n} más` : ''}.`;
  let n = said.length;
  while (n > 1 && compose(n).length > MAX_PIECE_CHARS) n -= 1;
  return compose(n);
}

function agendaPiece(calendar, today) {
  if (calendar?.status === 'error') return { piece: 'No pude leer tu agenda ahora.', events: 0 };
  if (calendar?.status !== 'ok') return { piece: '', events: 0 };
  const events = todaysEvents(calendar, today);
  if (!events.length) return { piece: 'No tienes nada en tu agenda para hoy.', events: 0 };
  const said = events.slice(0, MAX_EVENTS).map((e) => {
    const title = speakable(e.title, 60) || 'un evento';
    return e.allDay ? `${title}, todo el día` : `a ${spokenClock(e.start)}, ${title}`;
  });
  return { piece: listPiece(`Hoy tienes ${plural(events.length, 'evento', 'eventos')}`, said, events.length), events: events.length };
}

function mailPiece(mail) {
  if (mail?.status === 'error') return { piece: 'No pude revisar tu correo ahora.', mails: 0 };
  if (mail?.status !== 'ok') return { piece: '', mails: 0 };
  const emails = mail.emails || [];
  if (!emails.length) return { piece: 'No tienes correos importantes sin leer.', mails: 0 };
  const said = emails.slice(0, MAX_MAILS).map((m) => `de ${speakable(senderName(m.from), 40) || 'alguien'}, ${speakable(m.subject, 60) || 'sin asunto'}`);
  return { piece: listPiece(`Tienes ${plural(emails.length, 'correo importante sin leer', 'correos importantes sin leer')}`, said, emails.length), mails: emails.length };
}

function tasksPiece(tasks, today) {
  const pending = tasks.filter((t) => !t.done);
  if (!pending.length) return '';
  const late = pending.filter((t) => t.dueDate && t.dueDate < today).length;
  const rank = { alta: 0, media: 1, baja: 2 };
  const top = [...pending].sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)).slice(0, MAX_TASKS).map((t) => speakable(t.title, 50)).filter(Boolean);
  return `Tienes ${plural(pending.length, 'tarea pendiente', 'tareas pendientes')}${late ? `, ${late} vencida${late === 1 ? '' : 's'}` : ''}${top.length ? `. Empieza por: ${top.join(' y ')}` : ''}.`;
}

function remindersPiece(reminders, timezone, today) {
  const due = reminders.filter((r) => {
    try {
      return localParts(r.dueAt, timezone).date === today;
    } catch {
      return false;
    }
  });
  if (!due.length) return '';
  return `Tienes ${plural(due.length, 'recordatorio', 'recordatorios')} para hoy: ${due.slice(0, 2).map((r) => speakable(r.text, 60)).filter(Boolean).join('; ')}.`;
}

// → { pieces: [text], text, seconds, wantsMail, wantsCalendar }
//   pieces: what is said, in order (each short enough to be read in one go); the first is the greeting.
//   wantsMail / wantsCalendar: whether there is something in that service worth looking at (the pages that open).
export function spokenBrief({ name = '', timezone = 'UTC', now = new Date(), calendar = null, mail = null, tasks = [], reminders = [] } = {}) {
  let local;
  try {
    local = localParts(now.toISOString(), timezone);
  } catch {
    local = localParts(now.toISOString(), 'UTC');
  }
  const today = local.date;
  const hour = Number.parseInt(local.time, 10) || 0;
  const first = speakable(String(name).trim().split(/\s+/)[0], 30);
  const [, month, day] = today.split('-').map(Number);
  const greeting = `${greetingFor(hour)}${first ? `, ${first}` : ''}. Hoy es ${WEEKDAYS[weekdayOf(today)]} ${day} de ${MONTHS[month - 1]}.`;

  const agenda = agendaPiece(calendar, today);
  const mails = mailPiece(mail);
  const candidates = [greeting, agenda.piece, mails.piece, remindersPiece(reminders, timezone, today), tasksPiece(tasks, today)].filter(Boolean);

  // Whatever does not fit in the minute is left out (the last pieces are the least urgent).
  const pieces = [];
  let used = 0;
  for (const piece of candidates) {
    const clipped = piece.length > MAX_PIECE_CHARS ? `${piece.slice(0, MAX_PIECE_CHARS).replace(/[;,\s]+\S*$/, '')}.` : piece;
    if (pieces.length && used + clipped.length > MAX_SPOKEN_CHARS) break;
    pieces.push(clipped);
    used += clipped.length;
  }
  const text = pieces.join(' ');
  return { pieces, text, seconds: estimateSpeechSeconds(text), wantsMail: mails.mails > 0, wantsCalendar: agenda.events > 0 };
}
