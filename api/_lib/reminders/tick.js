// POST /api/connectors/tick — the open app's own heartbeat. While Eddie (or Contactos)
// is open it knocks here about once a minute, signed in, and anything that is due is
// run right then. That makes reminders and routines punctual whenever a device has Eddie
// open, whatever the external scheduler is doing. Closed apps still depend on the
// scheduler that calls /api/connectors/cron (see README: «Puntualidad»).
// It runs the same idempotent job as the cron (every job is claimed first), so a
// signed-in user can't make anything run twice or run anyone's job at a different time.
import { requireUser } from '../session.js';
import { limiterFor } from '../rateLimit.js';
import { runAllDue } from './cron.js';

export async function handleTickRequest({ method, cookies = {} }) {
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (!process.env.DATABASE_URL) return { status: 200, json: { ok: false } };
  const user = await requireUser(cookies);
  if (!limiterFor('tick', 3)(`u:${user.id}`).ok) return { status: 429, json: { error: 'Demasiado seguido.' } };
  try {
    return { status: 200, headers: { 'Cache-Control': 'no-store' }, json: { ok: true, ...(await runAllDue()) } };
  } catch (err) {
    console.error('[tick] failed:', err);
    return { status: 500, json: { error: 'No se pudo revisar lo pendiente.' } };
  }
}
