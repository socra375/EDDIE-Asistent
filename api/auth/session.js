// Consolidates me/logout/delete-account into one file — the Vercel Hobby
// plan caps a deployment at 12 serverless functions, so closely related,
// low-traffic auth endpoints share a file instead of getting one each.
import { me, logout, deleteAccount } from '../_lib/authHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    if (req.method === 'GET') {
      applyResult(res, await me(cookies));
    } else if (req.method === 'POST') {
      applyResult(res, await logout(cookies));
    } else if (req.method === 'DELETE') {
      applyResult(res, await deleteAccount(cookies));
    } else {
      res.statusCode = 405;
      res.end();
    }
  } catch (err) {
    respondError(res, err);
  }
}
