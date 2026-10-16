// The same error with another message. Some errors cannot be written to: a DOMException (the timeout or abort of a fetch) has
// only a getter for `message`, and assigning to it throws a TypeError that hides the real failure behind
// «Cannot set property message of … which has only a getter». Those are copied into a plain Error instead (code and
// status kept, the original under `cause`).
export function withMessage(err, message) {
  if (err && typeof err === 'object') {
    try {
      err.message = message;
      if (err.message === message) return err;
    } catch {
      // read-only: copied below
    }
  }
  const copy = new Error(message, { cause: err });
  for (const key of ['code', 'status', 'name']) if (err && err[key] != null) copy[key] = err[key];
  // A fetch that timed out or was cut off: the provider is unavailable (a DOMException's own `code` is a small number).
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') copy.code = 'PROVIDER_UNAVAILABLE';
  return copy;
}
