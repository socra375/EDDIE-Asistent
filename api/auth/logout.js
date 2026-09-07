import { logout } from '../_lib/authHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  try {
    applyResult(res, await logout(parseCookies(req.headers.cookie)));
  } catch (err) {
    respondError(res, err);
  }
}
