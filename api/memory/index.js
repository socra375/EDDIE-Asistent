import { getMemory, putMemory } from '../_lib/memoryHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (req.method === 'GET') {
      applyResult(res, await getMemory(cookies));
    } else if (req.method === 'PUT') {
      applyResult(res, await putMemory(cookies, req.body));
    } else if (req.method === 'DELETE') {
      applyResult(res, await putMemory(cookies, {}));
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    respondError(res, err);
  }
}
