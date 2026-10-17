// The app's side of the background jobs (api/_lib/agentjobs/): start a queued one, ask what is going on, and word what
// a finished one did for the conversation. The jobs themselves run on the server; closing the tab does not stop them.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, options) {
  const res = await fetch(`${API_BASE}/api/connectors/jobs${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export async function fetchJobs() {
  try {
    const { ok, data } = await call('', { method: 'GET' });
    return ok && Array.isArray(data?.jobs) ? data.jobs : null;
  } catch {
    return null;
  }
}

// Starts the work. The request lasts as long as the job; the poller reports the result, so its answer is not needed.
export function startJob(id) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return call('/run', { method: 'POST', body: JSON.stringify({ id, timezone }) }).catch(() => null);
}

export function markJobsSeen(ids) {
  if (!ids.length) return Promise.resolve();
  return call('/seen', { method: 'POST', body: JSON.stringify({ ids }) }).catch(() => null);
}

