// Applies a plain result descriptor ({ status, json, redirect, setCookie, headers })
// to a Node http.ServerResponse. Works unchanged for both Vercel's Node
// runtime and the local Express dev server — both extend the same
// http.ServerResponse API.
import { errorToStatus } from './httpErrors.js';

export function applyResult(res, result) {
  if (result.setCookie?.length) {
    res.setHeader('Set-Cookie', result.setCookie);
  }
  for (const [name, value] of Object.entries(result.headers || {})) res.setHeader(name, value);
  if (result.redirect) {
    res.statusCode = result.status || 302;
    res.setHeader('Location', result.redirect);
    res.end();
    return;
  }
  res.statusCode = result.status || 200;
  // `text` is for the rare caller that needs a plain-text body (Meta's webhook
  // check wants its challenge echoed as is, not as JSON).
  if (typeof result.text === 'string') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(result.text);
    return;
  }
  // `body` (a Buffer) is for files — the pictures of the gallery.
  if (Buffer.isBuffer(result.body)) {
    res.setHeader('Content-Type', result.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(result.body.length));
    res.end(result.body);
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.json ?? {}));
}

export function respondError(res, err) {
  applyResult(res, { status: errorToStatus(err), json: { error: err.message || 'Error inesperado.' } });
}
