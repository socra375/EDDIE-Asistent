// /api/connectors/jobs — the background jobs the app shows next to the chat:
//   GET  jobs        the latest ones (still going, finished and not shown yet, history)
//   POST jobs/run    { id, timezone? } runs a queued job (this request lasts as long as the job, up to ~60 s)
//   POST jobs/seen   { ids } marks finished jobs as shown
import { requireUser } from '../session.js';
import { cleanOld, listJobs, markSeen } from './store.js';
import { runJob } from './run.js';

const UUID = /^[0-9a-f-]{36}$/i;

export async function handleJobsRoute({ method, path = [], cookies = {}, body }) {
  const sub = path[1];
  const user = await requireUser(cookies);
  if (!process.env.DATABASE_URL) return { status: 503, json: { error: 'Falta configurar la base de datos.' } };

  if (!sub && method === 'GET') {
    const jobs = await listJobs(user.id);
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { jobs } };
  }
  if (sub === 'run' && method === 'POST') {
    if (!UUID.test(String(body?.id || ''))) return { status: 400, json: { error: 'Indica la tarea.' } };
    const timezone = typeof body?.timezone === 'string' && body.timezone.length < 100 ? body.timezone : undefined;
    const out = await runJob(user, body.id, { timezone });
    return { status: out.error ? 409 : 200, json: out };
  }
  if (sub === 'seen' && method === 'POST') {
    const ids = (Array.isArray(body?.ids) ? body.ids : []).filter((id) => UUID.test(String(id)));
    const marked = await markSeen(user.id, ids);
    if (marked) await cleanOld(user.id);
    return { status: 200, json: { ok: true, marked } };
  }
  return { status: 404, json: { error: 'Ruta no encontrada.' } };
}
