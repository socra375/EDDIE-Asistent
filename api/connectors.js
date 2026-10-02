// One function for every connector route: /api/connectors hits this file
// directly, and vercel.json rewrites /api/connectors/<id>/... (OAuth and
// webhooks, later) to /api/connectors?path=<id>/... — see
// docs/eddie-2-arquitectura.md for why (Vercel Hobby plan's 12-function cap).
// A plain file plus a rewrite, not an optional catch-all ([[...path]].js):
// outside Next.js, Vercel didn't route the bare /api/connectors to it and the
// SPA fallback answered with index.html instead.
import { handleConnectorsRequest } from './_lib/connectorsHandlers.js';
import { parseCookies } from './_lib/cookies.js';
import { applyResult, respondError } from './_lib/respond.js';
import { refuseCrossSiteChange } from './_lib/requestGuard.js';

export default async function handler(req, res) {
  // Telegram's webhook, the EDDIE Prime agent and the cron job are not browsers (no Sec-Fetch headers), so they pass.
  if (refuseCrossSiteChange(req, res)) return;
  try {
    const raw = req.query.path;
    const path = (Array.isArray(raw) ? raw.join('/') : raw || '').split('/').filter(Boolean);
    applyResult(
      res,
      await handleConnectorsRequest({
        method: req.method,
        path,
        cookies: parseCookies(req.headers.cookie),
        query: req.query || {},
        headers: req.headers || {},
        body: req.body,
      }),
    );
  } catch (err) {
    respondError(res, err);
  }
}
