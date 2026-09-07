import { updateTask, removeTask } from '../_lib/tasksHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const { id } = req.query;
    if (req.method === 'PATCH') {
      applyResult(res, await updateTask(cookies, id, req.body));
    } else if (req.method === 'DELETE') {
      applyResult(res, await removeTask(cookies, id));
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    respondError(res, err);
  }
}
