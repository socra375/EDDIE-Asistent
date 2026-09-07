import { getSettings, putSettings } from '../_lib/settingsHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (req.method === 'GET') {
      applyResult(res, await getSettings(cookies));
    } else if (req.method === 'PUT') {
      applyResult(res, await putSettings(cookies, req.body));
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    respondError(res, err);
  }
}
