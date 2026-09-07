// Applies a plain result descriptor ({ status, json, redirect, setCookie })
// to a Node http.ServerResponse. Works unchanged for both Vercel's Node
// runtime and the local Express dev server — both extend the same
// http.ServerResponse API.
import { errorToStatus } from './httpErrors.js';

export function applyResult(res, result) {
  if (result.setCookie?.length) {
    res.setHeader('Set-Cookie', result.setCookie);
  }
  if (result.redirect) {
    res.statusCode = result.status || 302;
    res.setHeader('Location', result.redirect);
    res.end();
    return;
  }
  res.statusCode = result.status || 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.json ?? {}));
}

export function respondError(res, err) {
  applyResult(res, { status: errorToStatus(err), json: { error: err.message || 'Error inesperado.' } });
}
