import { me } from '../_lib/authHandlers.js';
import { parseCookies } from '../_lib/cookies.js';
import { applyResult, respondError } from '../_lib/respond.js';

export default async function handler(req, res) {
  try {
    applyResult(res, await me(parseCookies(req.headers.cookie)));
  } catch (err) {
    respondError(res, err);
  }
}
