// A few requests a minute per address, kept in memory: good enough to stop a
// loop or a hostile page from draining the AI quota on one serverless
// instance (it is not a global limit, and it resets when the instance does).
export function createRateLimiter({ perMinute = 20, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const recent = (hits.get(key) || []).filter((at) => t - at < 60_000);
    if (recent.length >= perMinute) {
      hits.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((60_000 - (t - recent[0])) / 1000)) };
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 500) for (const [k, v] of hits) if (!v.some((at) => t - at < 60_000)) hits.delete(k);
    return { ok: true };
  };
}

// The caller's address (Vercel puts it first in x-forwarded-for).
export function clientKey(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim() || 'local';
}

// One limiter per name and limit, built on first use; `envName` lets the owner
// change the limit (1 to 600 a minute).
const named = new Map();
export function limiterFor(name, defaultPerMinute, env = process.env, envName) {
  const perMinute = Math.min(600, Math.max(1, Number.parseInt(envName ? env[envName] : '', 10) || defaultPerMinute));
  const entry = named.get(name);
  if (entry?.perMinute === perMinute) return entry.allow;
  const allow = createRateLimiter({ perMinute });
  named.set(name, { perMinute, allow });
  return allow;
}

// Answers 429 and returns true when this caller is over the limit.
export function tooMany(req, res, name, defaultPerMinute, envName, env = process.env) {
  const verdict = limiterFor(name, defaultPerMinute, env, envName)(`${name}:${clientKey(req)}`);
  if (verdict.ok) return false;
  res.setHeader?.('Retry-After', String(verdict.retryAfter));
  res.status(429).json({ error: 'Demasiadas solicitudes en poco tiempo. Espera un momento.', retryAfter: verdict.retryAfter });
  return true;
}
