// One file for both /api/tasks and /api/tasks/<id> (vercel.json rewrites the
// latter to /api/tasks?id=<id>), merging what used to be two files into one —
// see api/auth/session.js for why (Vercel Hobby plan's 12-function cap).
// Not an optional catch-all ([[...id]].js): outside Next.js, Vercel didn't
// route the bare /api/tasks to it and the SPA fallback answered instead.
import { listTasks, createTask, updateTask, removeTask } from './_lib/tasksHandlers.js';
import { parseCookies } from './_lib/cookies.js';
import { applyResult, respondError } from './_lib/respond.js';
import { refuseCrossSiteChange } from './_lib/requestGuard.js';

export default async function handler(req, res) {
  if (refuseCrossSiteChange(req, res)) return;
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
