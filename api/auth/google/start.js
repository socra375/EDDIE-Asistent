import { startGoogleLogin } from '../../_lib/authHandlers.js';
import { applyResult, respondError } from '../../_lib/respond.js';

export default function handler(req, res) {
  try {
    applyResult(res, startGoogleLogin(req.query));
  } catch (err) {
    respondError(res, err);
  }
}
