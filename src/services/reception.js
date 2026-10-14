// Recepción, the rules without the database or the calendar: which weekdays the user
// means, the weekly opening hours, and the free slots left in a day once the busy
// times are taken out. Times are local "HH:MM" strings; everything is whole minutes.
//
// hours: { 0..6: [[start, end], …] } (0 = Sunday); a day without windows is closed.

export const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MAX_MESSAGES = 200;
export const MIN_SLOT = 10;
export const MAX_SLOT = 240;

const plain = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const DAY_ALIASES = {
  domingo: 0, dom: 0, lunes: 1, lun: 1, martes: 2, mar: 2, miercoles: 3, mie: 3, jueves: 4, jue: 4, viernes: 5, vie: 5, sabado: 6, sab: 6,
};

function dayOf(word) {
  const w = plain(word).replace(/^(los|las|el|la)\s+/, '');
  if (w in DAY_ALIASES) return DAY_ALIASES[w];
  const singular = w.replace(/s$/, ''); // "sabados" → "sabado", "martes" is already a name
  return singular in DAY_ALIASES ? DAY_ALIASES[singular] : null;
}

// "lun-vie", "lunes a viernes", "martes, jueves y sábado", "todos los días", "fin de semana" → [1,2,3,4,5]; null if not understood.
export function parseDays(text) {
  const t = plain(text).replace(/[.;]/g, '');
  if (!t) return null;
  if (/^(todos( los dias)?|cada dia|diario|toda la semana)$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  if (/^(entre semana|dias laborables|laborables|dias habiles)$/.test(t)) return [1, 2, 3, 4, 5];
  if (/^(fin de semana|fines de semana|findes?)$/.test(t)) return [6, 0];
  const days = new Set();
  for (const part of t.split(/\s*,\s*|\s+y\s+|\s+e\s+/).filter(Boolean)) {
    const range = part.split(/\s*[-–—]\s*|\s+(?:a la|a|hasta)\s+/);
    if (range.length === 2) {
      const a = dayOf(range[0]);
      const b = dayOf(range[1]);
      if (a == null || b == null) return null;
      for (let d = a; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === b) break;
      }
    } else if (range.length === 1) {
      const d = dayOf(range[0]);
      if (d == null) return null;
      days.add(d);
    } else return null;
  }
  return days.size ? [...days].sort((x, y) => x - y) : null;
}

export const toMinutes = (hhmm) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const fromMinutes = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// The windows of one day from "start–end" and an optional break: [["09:00","12:00"],["14:00","18:00"]].
export function dayWindows({ start, end, breakStart, breakEnd }) {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s == null || e == null) return { error: 'Dame la hora de apertura y de cierre (por ejemplo 09:00 y 17:00).' };
  if (e <= s) return { error: 'La hora de cierre tiene que ser después de la de apertura.' };
  if (breakStart || breakEnd) {
    const bs = toMinutes(breakStart);
    const be = toMinutes(breakEnd);
    if (bs == null || be == null) return { error: 'Para el descanso dame la hora en que empieza y la hora en que termina.' };
    if (be <= bs || bs <= s || be >= e) return { error: 'El descanso tiene que ir dentro del horario, con el final después del inicio.' };
    return { windows: [[start, fromMinutes(bs)], [fromMinutes(be), end]] };
  }
  return { windows: [[start, end]] };
}

// Sets (or closes, with windows = []) the given weekdays; returns a new hours object.
export function withDays(hours, days, windows) {
  const next = { ...(hours || {}) };
  for (const d of days) next[d] = windows.map(([a, b]) => [a, b]);
  return next;
}

// Cleans what comes from the database: only weekdays 0-6 with well-formed, ordered windows.
export function cleanHours(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (let d = 0; d <= 6; d += 1) {
    const list = Array.isArray(raw[d]) ? raw[d] : [];
    const windows = list
      .filter((w) => Array.isArray(w) && toMinutes(w[0]) != null && toMinutes(w[1]) != null && toMinutes(w[1]) > toMinutes(w[0]))
      .map((w) => [w[0], w[1]])
      .sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
    if (windows.length) out[d] = windows;
  }
  return out;
}

export const hasHours = (hours) => Object.keys(cleanHours(hours)).length > 0;

// "lunes a viernes: 09:00–17:00 · sábado: 09:00–12:00 · domingo: cerrado"
export function describeHours(hours) {
  const h = cleanHours(hours);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const text = (d) => (h[d] ? h[d].map(([a, b]) => `${a}–${b}`).join(' y ') : 'cerrado');
  const groups = [];
  for (const d of order) {
    const last = groups.at(-1);
    if (last && last.text === text(d)) last.days.push(d);
    else groups.push({ text: text(d), days: [d] });
  }
  return groups.map((g) => `${g.days.length > 1 ? `${DAY_NAMES[g.days[0]]} a ${DAY_NAMES[g.days.at(-1)]}` : DAY_NAMES[g.days[0]]}: ${g.text}`).join(' · ');
}

// Busy times of one day as minute ranges, from calendar events described like the Calendar connector does
// ({date, start, end, end_date, all_day}). All-day events do not block (birthdays, reminders); an event that
// crosses midnight blocks until the end (or from the start) of this day.
export function busyOnDay(events, date) {
  const busy = [];
  for (const e of events || []) {
    if (e.all_day) continue;
    const endDate = e.end_date || e.date;
    if (e.date > date || endDate < date) continue;
    const start = e.date === date ? toMinutes(e.start) : 0;
    const end = endDate === date ? toMinutes(e.end) : 1440;
    if (start == null || end == null || end <= start) continue;
    busy.push([start, end]);
  }
  return busy;
}

// Start times (HH:MM) of free slots in one day: they begin every `step` minutes inside an opening window,
// the whole `duration` fits in that window, nothing busy overlaps, and (today) nothing already past.
export function freeSlots({ windows, busy = [], duration, step, notBefore = 0 }) {
  const slots = [];
  for (const [a, b] of windows || []) {
    const from = toMinutes(a);
    const to = toMinutes(b);
    for (let t = from; t + duration <= to; t += step) {
      if (t < notBefore) continue;
      if (busy.some(([s, e]) => t < e && t + duration > s)) continue;
      slots.push(fromMinutes(t));
    }
  }
  return slots;
}

// "09:00 a 11:30, 14:00" — consecutive slots folded into ranges, so the model reads (and says) little.
export function foldSlots(slots, step, duration) {
  const out = [];
  let from = null;
  let prev = null;
  const close = () => {
    if (from == null) return;
    out.push(from === prev ? `${fromMinutes(from)}` : `${fromMinutes(from)} a ${fromMinutes(prev)}`);
  };
  for (const s of slots.map(toMinutes)) {
    if (prev != null && s - prev === step) prev = s;
    else {
      close();
      from = s;
      prev = s;
    }
  }
  close();
  void duration;
  return out;
}
