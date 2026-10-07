// The daily allowance of requests, split in two "tandas" so the day lasts:
// the morning half and the afternoon half (50 a day = 25 + 25). Each tanda
// restores by itself when the next one starts, and the day at midnight.
// Pure functions only; the counting lives in store.js.
//
// DAILY_REQUEST_LIMIT   requests a day (default 50, 0 = no limit)
// QUOTA_SPLIT_HOUR      local hour the afternoon tanda starts (default 14)
// QUOTA_TIMEZONE        zone used when the caller doesn't say theirs (default UTC)

export const DEFAULT_DAILY = 50;
export const DEFAULT_SPLIT_HOUR = 14;

const TANDA_NAMES = { am: 'la mañana', pm: 'la tarde' };

export function quotaConfig(env = process.env) {
  const raw = String(env.DAILY_REQUEST_LIMIT ?? '').trim();
  let daily = raw === '' ? DEFAULT_DAILY : Number.parseInt(raw, 10);
  if (!Number.isFinite(daily) || daily < 0) daily = DEFAULT_DAILY;
  if (daily > 0) daily = Math.min(5000, Math.max(2, daily));
  const hour = Number.parseInt(String(env.QUOTA_SPLIT_HOUR ?? ''), 10);
  const splitHour = Number.isInteger(hour) && hour >= 1 && hour <= 23 ? hour : DEFAULT_SPLIT_HOUR;
  const am = Math.floor(daily / 2);
  return { enabled: daily > 0, daily, am, pm: daily - am, splitHour };
}

// A real IANA zone, or the owner's default, or UTC.
export function cleanTimezone(value, env = process.env) {
  for (const candidate of [value, env.QUOTA_TIMEZONE]) {
    if (typeof candidate !== 'string' || !candidate || candidate.length > 100) continue;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate });
      return candidate;
    } catch {
      // not a zone: try the next
    }
  }
  return 'UTC';
}

// The wall clock in `timeZone` at `date`: { day: 'YYYY-MM-DD', hour, minute }.
export function localClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24, minute: Number(get('minute')) };
}

const hour12 = (hour) => `${hour % 12 || 12}:00 ${hour < 12 ? 'a. m.' : 'p. m.'}`;

// Which tanda it is right now: { day, tanda, name, limit, minutesLeft, resetsAt }.
export function currentTanda(date, timeZone, config = quotaConfig()) {
  const { day, hour, minute } = localClock(date, timeZone);
  const tanda = hour < config.splitHour ? 'am' : 'pm';
  const now = hour * 60 + minute;
  const minutesLeft = (tanda === 'am' ? config.splitHour * 60 : 24 * 60) - now;
  return {
    day,
    tanda,
    name: TANDA_NAMES[tanda],
    limit: config[tanda],
    minutesLeft,
    resetsAt: tanda === 'am' ? hour12(config.splitHour) : `${hour12(0)} (medianoche)`,
  };
}

export function untilLabel(minutes) {
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// What to tell the user when the tanda is spent.
export function limitMessage(t, config = quotaConfig()) {
  const next = t.tanda === 'am' ? `Para la tarde te quedan ${config.pm}.` : 'Mañana tendrás un día nuevo.';
  return `Llegaste al límite de ${t.name} (${t.limit} de ${t.limit} peticiones). Se restaura a las ${t.resetsAt}, en ${untilLabel(t.minutesLeft)}. ${next} Si necesitas seguir ahora, puedes restaurar el contador en Configuración → Uso (o con /restaurar en Telegram).`;
}
