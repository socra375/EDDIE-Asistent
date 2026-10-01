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
import { readWebhookBody } from './_lib/whatsapp/rawBody.js';

export default async function handler(req, res) {
  try {
    const raw = req.query.path;
    const path = (Array.isArray(raw) ? raw.join('/') : raw || '').split('/').filter(Boolean);
    // Meta's WhatsApp webhook signs the raw bytes, so that one route reads them itself.
    const webhook = req.method === 'POST' && path[0] === 'whatsapp' && path[1] === 'webhook' ? await readWebhookBody(req) : null;
    applyResult(
      res,
      await handleConnectorsRequest({
        method: req.method,
        path,
        cookies: parseCookies(req.headers.cookie),
        query: req.query || {},
        headers: req.headers || {},
        body: webhook ? webhook.body : req.body,
        rawBody: webhook?.rawBody,
      }),
    );
  } catch (err) {
    respondError(res, err);
  }
}
