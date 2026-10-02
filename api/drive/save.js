import { saveToDrive } from '../_lib/driveHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';
import { refuseCrossSiteChange } from '../_lib/requestGuard.js';

export default async function handler(req, res) {
  if (refuseCrossSiteChange(req, res)) return;
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end();
    return;
  }
  try {
    applyResult(res, await saveToDrive(parseCookies(req.headers.cookie), req.body));
  } catch (err) {
    respondError(res, err);
  }
}
