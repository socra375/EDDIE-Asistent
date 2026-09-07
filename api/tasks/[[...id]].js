// Optional catch-all: matches both /api/tasks and /api/tasks/<id>, merging
// what used to be two files into one — see api/auth/session.js for why
// (Vercel Hobby plan's 12-function-per-deployment cap).
import { listTasks, createTask, updateTask, removeTask } from '../_lib/tasksHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const idParam = req.query.id;
    const id = Array.isArray(idParam) ? idParam[0] : idParam;

    if (!id) {
      if (req.method === 'GET') {
        applyResult(res, await listTasks(cookies));
      } else if (req.method === 'POST') {
        applyResult(res, await createTask(cookies, req.body));
      } else {
        res.statusCode = 405;
        res.end();
      }
      return;
    }

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
