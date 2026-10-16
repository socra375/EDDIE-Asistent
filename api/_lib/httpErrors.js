export function errorToStatus(err) {
  // A provider that went silent and was cut off (a DOMException: its own `code` is a small number, not ours).
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 503;
  switch (err.code) {
    case 'UNAUTHORIZED':
      return 401;
    case 'BAD_REQUEST':
      return 400;
    case 'GOOGLE_NOT_CONNECTED':
      return 409;
    case 'DB_UNAVAILABLE':
    case 'PROVIDER_UNAVAILABLE':
      return 503;
    case 'PROVIDER_ERROR':
      return 502;
    case 'RATE_LIMITED':
      return 429;
    default:
      return 500;
  }
}
