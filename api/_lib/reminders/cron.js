// GET|POST /api/connectors/cron — the door the schedulers knock on. Vercel's
// own cron (vercel.json, once a day on the free plan) and the GitHub Actions
// workflow (every 5 minutes) both send `Authorization: Bearer <CRON_SECRET>`.
// Without that secret nobody can trigger it.
import { timingSafeEqual } from 'node:crypto';
import { runScheduledJobs } from './run.js';
import { runRoutines } from '../routines/run.js';

// The function may run 60 s: nothing new starts after this, so a slow AI task is never cut off by the platform.
export const JOB_BUDGET_MS = 30_000;

function secretMatches(headers) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ''));
  const header = String(headers.authorization || '');
  const got = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
  return expected.length >= 16 && expected.length === got.length && timingSafeEqual(expected, got);
}

// Everything due right now: reminders, summaries and routines, together. Safe to call from anywhere and as
// often as wanted: each job is claimed before it runs, so nothing goes out twice.
export async function runAllDue() {
  const deadline = Date.now() + JOB_BUDGET_MS;
  const [reminders, routines] = await Promise.all([runScheduledJobs({ deadline }), runRoutines({ deadline })]);
  return { ...reminders, routines };
}

export async function handleCronRequest({ method, headers = {} }) {
  if (method !== 'GET' && method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 16) {
    return { status: 503, json: { error: 'Falta CRON_SECRET en Vercel (mínimo 16 caracteres).' } };
  }
  if (!secretMatches(headers)) return { status: 401, json: { error: 'No autorizado.' } };
  if (!process.env.DATABASE_URL) return { status: 503, json: { error: 'Falta DATABASE_URL.' } };
  try {
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: { ok: true, ...(await runAllDue()) } };
  } catch (err) {
    console.error('[cron] failed:', err);
    return { status: 500, json: { error: 'El trabajo programado falló.' } };
  }
}
