import { handleGoogleCallback } from '../../_lib/authHandlers.js';
import { parseCookies } from '../../_lib/cookies.js';
import { applyResult, respondError } from '../../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const result = await handleGoogleCallback(cookies, req.query);
    applyResult(res, result);
  } catch (err) {
    respondError(res, err);
  }
}
