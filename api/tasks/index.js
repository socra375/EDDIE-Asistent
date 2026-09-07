import { listTasks, createTask } from '../_lib/tasksHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (req.method === 'GET') {
      applyResult(res, await listTasks(cookies));
    } else if (req.method === 'POST') {
      applyResult(res, await createTask(cookies, req.body));
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    respondError(res, err);
  }
}
