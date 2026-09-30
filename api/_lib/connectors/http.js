// Small fetch helper for connector tools: one retry for flaky networks, a
// short timeout (every tool call sits inside the chat request's own time
// budget), and never throws — a failed call becomes { ok: false } so the
// tool can turn it into a readable { error } for the model.
import { fetchWithRetry } from '../fetchWithRetry.js';

const DEFAULT_TIMEOUT_MS = 7000;
export const USER_AGENT = 'EddieAsistente/1.0 (https://github.com/socra375/EDDIE-Asistent)';

export async function fetchText(url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 1 } = {}) {
  let res;
  try {
    res = await fetchWithRetry(
      url,
      () => ({ method, headers: { 'User-Agent': USER_AGENT, ...headers }, body, signal: AbortSignal.timeout(timeoutMs) }),
      { retries, retryableStatusCodes: [500, 502, 503, 504] },
    );
  } catch {
    return { ok: false, status: 0, text: '' };
  }
  const text = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, text };
}

export async function fetchJson(url, options = {}) {
  const { ok, status, text } = await fetchText(url, options);
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok, status, data };
}

// Keeps what goes back to the model short: tool results count against the
// provider's token budget (Groq's free tier allows ~8K per minute).
export function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
