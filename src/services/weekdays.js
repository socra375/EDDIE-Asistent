// Which days of the week a routine runs: "de lunes a viernes", "solo los fines de semana", "lunes y jueves".
// Days are numbers like Date.getDay: 0 = domingo … 6 = sábado. `days` stored as null means every day.
// Pure functions, shared by the routines connector, its store and the cron that runs them.
import { parseDays } from './reception.js';

export { parseDays };

const NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// "los lunes", "los sábados": only domingo and sábado take an s.
const PLURAL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados']; 
// Monday first, the order people count a week in.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const cleanDays = (days) => [...new Set((Array.isArray(days) ? days : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];

// Every day (or nothing said) → null; otherwise the days as 'a,b,c' in week order.
export function encodeDays(days) {
  const set = new Set(cleanDays(days));
  if (set.size === 0 || set.size === 7) return null;
  return WEEK.filter((d) => set.has(d)).join(',');
}

// 'a,b,c' → [numbers]; null / empty / junk → null (every day).
export function decodeDays(text) {
  if (text == null || text === '') return null;
  const days = cleanDays(String(text).split(',').map((s) => (s.trim() === '' ? NaN : Number(s))));
  return days.length && days.length < 7 ? WEEK.filter((d) => days.includes(d)) : null;
}

// "de lunes a viernes", "los fines de semana", "los lunes, miércoles y viernes", "todos los días".
export function describeDays(days) {
  const list = decodeDays(Array.isArray(days) ? encodeDays(days) : days);
  if (!list) return 'todos los días';
  const key = list.join(',');
  if (key === '1,2,3,4,5') return 'de lunes a viernes';
  if (key === '6,0') return 'los fines de semana';
  const at = list.map((d) => WEEK.indexOf(d));
  const consecutive = list.length >= 3 && at.every((p, i) => i === 0 || p === at[i - 1] + 1);
  if (consecutive) return `de ${NAMES[list[0]]} a ${NAMES[list.at(-1)]}`;
  const names = list.map((d) => PLURAL[d]);
  return `los ${names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : names[0]}`;
}

// The day of the week (0–6) of a calendar date 'YYYY-MM-DD'.
export const weekdayOf = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();

// Does a routine with these days run on this local date? (Nothing said = every day.)
export function runsOn(days, date) {
  const list = Array.isArray(days) ? cleanDays(days) : decodeDays(days);
  return !list || list.length === 0 || list.includes(weekdayOf(date));
}
