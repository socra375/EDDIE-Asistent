// Optional catch-all: one function for every connector route (/api/connectors
// today, OAuth and webhooks under /api/connectors/<id>/... later) — see
// docs/eddie-2-arquitectura.md for why (Vercel Hobby plan's 12-function cap).
import { handleConnectorsRequest } from '../_lib/connectorsHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const raw = req.query.path;
    const path = Array.isArray(raw) ? raw : raw ? [raw] : [];
    applyResult(res, await handleConnectorsRequest({ method: req.method, path, cookies: parseCookies(req.headers.cookie) }));
  } catch (err) {
    respondError(res, err);
  }
}
