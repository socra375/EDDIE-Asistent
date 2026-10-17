// The app's side of the music offers (api/_lib/habits/): ask the server whether there is a song worth offering now,
// and tell it the answer. Eddie only asks; the song plays when the user says yes.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, options) {
  const res = await fetch(`${API_BASE}/api/connectors/habits${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export async function fetchOffer() {
  try {
    const { ok, data } = await call('/suggest', { method: 'POST', body: JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    return ok ? data?.offer || null : null;
  } catch {
    return null;
  }
}

export function answerOffer(id, outcome) {
  return call('/answer', { method: 'POST', body: JSON.stringify({ id, outcome }) }).catch(() => null);
}

export async function fetchHabits() {
  try {
    const { ok, data } = await call('', { method: 'GET' });
    return ok ? data : null;
  } catch {
    return null;
  }
}

export function clearHabits() {
  return call('/clear', { method: 'POST', body: '{}' }).catch(() => null);
}
