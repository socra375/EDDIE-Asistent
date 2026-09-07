export function errorToStatus(err) {
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
    default:
      return 500;
  }
}
