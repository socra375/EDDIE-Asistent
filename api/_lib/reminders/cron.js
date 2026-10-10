// GET|POST /api/connectors/cron — the door the schedulers knock on. Vercel's
// own cron (vercel.json, once a day on the free plan) and the GitHub Actions
// workflow (every 5 minutes) both send `Authorization: Bearer <CRON_SECRET>`.
// Without that secret nobody can trigger it.
import { timingSafeEqual } from 'node:crypto';
import { runScheduledJobs } from './run.js';
import { runRoutines } from '../routines/run.js';

function secretMatches(headers) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ''));
  const header = String(headers.authorization || '');
  const got = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
  return expected.length >= 16 && expected.length === got.length && timingSafeEqual(expected, got);
}

export async function handleCronRequest({ method, headers = {} }) {
  if (method !== 'GET' && method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16) {
    return { status: 503, json: { error: 'Falta CRON_SECRET en Vercel (mínimo 16 caracteres).' } };
  }
  if (!secretMatches(headers)) return { status: 401, json: { error: 'No autorizado.' } };
  if (!process.env.DATABASE_URL) return { status: 503, json: { error: 'Falta DATABASE_URL.' } };
  try {
    const [reminders, routines] = await Promise.all([runScheduledJobs(), runRoutines()]);
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: { ok: true, ...reminders, routines } };
  } catch (err) {
    console.error('[cron] failed:', err);
    return { status: 500, json: { error: 'El trabajo programado falló.' } };
  }
}
