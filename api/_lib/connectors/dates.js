// Date helpers shared by connector tools. Everything is resolved in the
// user's own time zone (context.timezone, from the browser), since "today"
// or "at 3" mean the user's local day and hour, not the server's.

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

function plain(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9: ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Today's date (YYYY-MM-DD) in a time zone.
export function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Accepts YYYY-MM-DD or everyday words ("hoy", "mañana", "pasado mañana",
// "el viernes"). Returns null for "no date", undefined when the value
// can't be understood.
// `today` (YYYY-MM-DD) can be given to resolve relative words against another day.
export function resolveDate(value, timezone, today = todayIn(timezone)) {
  if (value == null || value === '') return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(`${raw}T12:00:00Z`).getTime())) return raw;
  const words = plain(raw).replace(/^(el|este|esta|para el|para)\s+/, '');
  if (words === 'hoy') return today;
  if (words === 'manana') return addDays(today, 1);
  if (words === 'pasado manana') return addDays(today, 2);
  const weekday = WEEKDAYS.indexOf(words.replace(/^proximo\s+/, ''));
  if (weekday >= 0) {
    const current = new Date(`${today}T12:00:00Z`).getUTCDay();
    const ahead = (weekday - current + 7) % 7 || 7;
    return addDays(today, ahead);
  }
  return undefined;
}

// "15:30", "9:05", "3pm", "3:30 pm", "15h" → "HH:MM"; null if empty,
// undefined if it can't be understood.
export function resolveTime(value) {
  if (value == null || value === '') return null;
  const s = plain(value).replace(/\s+/g, '');
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|h)?$/);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2] || 0);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Minutes the zone is ahead of UTC at a given instant (e.g. -240 for GMT-4).
export function zoneOffsetMinutes(date, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'UTC',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - date.getTime()) / 60000);
}

// The instant (ISO, UTC) of a local date and time in a zone, DST-safe.
export function zonedInstant(isoDate, time = '00:00', timezone = 'UTC') {
  const [y, mo, d] = isoDate.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let instant = guess - zoneOffsetMinutes(new Date(guess), timezone) * 60000;
  instant = guess - zoneOffsetMinutes(new Date(instant), timezone) * 60000;
  return new Date(instant).toISOString();
}

// Local date and time of an instant in a zone: { date: 'YYYY-MM-DD', time: 'HH:MM' }.
export function localParts(isoInstant, timezone) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(isoInstant)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// "mar 30 sep" style label for a date, in Spanish.
export function dayLabel(isoDate) {
  return new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${isoDate}T12:00:00Z`));
}
