// Neon Object Storage (S3-compatible, path-style) for the 3D brain. No SDK:
// every request is a SigV4 *query-string* signature, so the same function
// makes the URLs the browser uploads to and reads from, and the ones this
// server fetches itself (HEAD, a ranged GET, DELETE). The bucket is private;
// nothing is readable without a URL minted here for a short time.
import { createHash, createHmac } from 'node:crypto';

const ENV = ['NEON_S3_ENDPOINT', 'NEON_S3_ACCESS_KEY_ID', 'NEON_S3_SECRET_ACCESS_KEY', 'NEON_S3_BUCKET'];

export const missingS3Env = (env = process.env) => ENV.filter((name) => !env[name]);

export function s3Config(env = process.env) {
  if (missingS3Env(env).length) return null;
  return {
    endpoint: new URL(env.NEON_S3_ENDPOINT.replace(/\/+$/, '')),
    region: env.NEON_S3_REGION || 'us-east-1',
    accessKeyId: env.NEON_S3_ACCESS_KEY_ID,
    secretAccessKey: env.NEON_S3_SECRET_ACCESS_KEY,
    bucket: env.NEON_S3_BUCKET,
  };
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
// RFC 3986: what encodeURIComponent leaves alone, minus !'()*
const encode = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// `headers` are the extra ones the caller promises to send (lowercase names);
// they become part of the signature, so a different Content-Type is refused.
export function signQuery({ method, host, path, region, accessKeyId, secretAccessKey, expires = 600, headers = {}, extraQuery = {}, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const signed = { host, ...headers };
  const names = Object.keys(signed).sort();
  const query = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': names.join(';'),
  };
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k])}`)
    .join('&');
  const canonicalHeaders = names.map((n) => `${n}:${String(signed[n]).trim()}\n`).join('');
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key).update(stringToSign).digest('hex');
  return `${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const keyPath = (cfg, key) => `/${encode(cfg.bucket)}/${key.split('/').map(encode).join('/')}`;

// A URL for exactly one method on exactly one object.
export function presign(method, key, { expires = 600, headers = {}, env = process.env, now } = {}) {
  const cfg = s3Config(env);
  if (!cfg) throw new Error('El almacenamiento 3D no está configurado.');
  const path = keyPath(cfg, key);
  const query = signQuery({ method, host: cfg.endpoint.host, path, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expires, headers, now });
  return `${cfg.endpoint.origin}${path}?${query}`;
}

// The bucket itself (not an object), with a subresource such as ?cors.
function presignBucket(method, subresource, { headers = {}, env = process.env } = {}) {
  const cfg = s3Config(env);
  if (!cfg) throw new Error('El almacenamiento 3D no está configurado.');
  const path = `/${encode(cfg.bucket)}`;
  const query = signQuery({ method, host: cfg.endpoint.host, path, region: cfg.region, accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, expires: 60, headers, extraQuery: { [subresource]: '' } });
  return `${cfg.endpoint.origin}${path}?${query}`;
}

const TIMEOUT_MS = 15000;

// → { bytes } or null when the object is not there.
export async function headObject(key, env = process.env) {
  const res = await fetch(presign('HEAD', key, { expires: 60, env }), { method: 'HEAD', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`El almacenamiento respondió ${res.status}.`);
  return { bytes: Number(res.headers.get('content-length') || 0) };
}

// The first `count` bytes of the object.
export async function readHead(key, count = 12, env = process.env) {
  const res = await fetch(presign('GET', key, { expires: 60, env }), { headers: { Range: `bytes=0-${count - 1}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`El almacenamiento respondió ${res.status}.`);
  return Buffer.from(await res.arrayBuffer()).subarray(0, count);
}

export async function deleteObject(key, env = process.env) {
  const res = await fetch(presign('DELETE', key, { expires: 60, env }), { method: 'DELETE', signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok && res.status !== 404) throw new Error(`El almacenamiento respondió ${res.status}.`);
}

// The browser uploads to and reads from the bucket directly, so the bucket must
// answer for Eddie's own address. The rule is added from here (the first upload)
// instead of by hand; origins already in the bucket are kept.
const ORIGIN_TAG = /<AllowedOrigin>([^<]+)<\/AllowedOrigin>/g;
const checkedOrigins = new Set();

const corsXml = (origins) =>
  `<CORSConfiguration><CORSRule>${origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')}<AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><ExposeHeader>Content-Length</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>`;

// → true when the bucket answers for `origin` (adding it when it did not).
export async function ensureBucketCors(origin, env = process.env) {
  if (!origin || checkedOrigins.has(origin)) return true;
  const res = await fetch(presignBucket('GET', 'cors', { env }), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const current = res.ok ? [...(await res.text()).matchAll(ORIGIN_TAG)].map((m) => m[1]) : [];
  if (!res.ok && res.status !== 404) throw new Error(`El almacenamiento respondió ${res.status}.`);
  if (current.includes(origin) || current.includes('*')) {
    checkedOrigins.add(origin);
    return true;
  }
  const body = corsXml([...new Set([...current, origin])].slice(-20));
  const md5 = createHash('md5').update(body).digest('base64');
  const put = await fetch(presignBucket('PUT', 'cors', { headers: { 'content-md5': md5 }, env }), {
    method: 'PUT',
    headers: { 'Content-MD5': md5, 'Content-Type': 'application/xml' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!put.ok) throw new Error(`No pude configurar CORS en el bucket (${put.status}).`);
  checkedOrigins.add(origin);
  return true;
}
