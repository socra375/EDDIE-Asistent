// Pure helpers of the background jobs (no network): when a job is active, how Eddie words a finished one, which to report.
export const isActive = (job) => job.status === 'queued' || job.status === 'running';

// What Eddie says when a job ends: the agent's own account, or why it failed.
export function jobReport(job) {
  const title = `«${job.label}»`;
  if (job.status === 'error') return `No pude terminar ${title}: ${job.error || 'falló la tarea'}.`;
  const asks = job.confirmations?.length ? `\n\nHay ${job.confirmations.length === 1 ? 'una acción que necesita' : `${job.confirmations.length} acciones que necesitan`} tu OK.` : '';
  return `Terminé ${title}. ${job.result || 'Listo.'}${asks}`;
}

// Jobs that ended and the app has not told the user about yet.
export const toReport = (jobs, told) => jobs.filter((j) => !isActive(j) && !j.seen && !told.has(j.id));
