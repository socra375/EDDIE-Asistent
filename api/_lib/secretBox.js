// Encrypts OAuth tokens before they go into Postgres (AES-256-GCM, key
// derived from CONNECTOR_SECRET), so a database leak alone doesn't hand out
// access to anyone's Gmail or Calendar. Stored as "enc:v1:<iv>.<tag>.<data>"
// in base64url. Values written before encryption existed (plain tokens) are
// still read as they are and get encrypted on their next save.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';

function key(secret) {
  return createHash('sha256').update(`eddie-connector-tokens:${secret}`).digest();
}

export function hasTokenSecret(env = process.env) {
  return typeof env.CONNECTOR_SECRET === 'string' && env.CONNECTOR_SECRET.length >= 16;
}

export function sealToken(value, secret = process.env.CONNECTOR_SECRET) {
  if (value == null || value === '') return value;
  if (!hasTokenSecret({ CONNECTOR_SECRET: secret })) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64url')}.${tag.toString('base64url')}.${data.toString('base64url')}`;
}

export function openToken(value, secret = process.env.CONNECTOR_SECRET) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  if (!hasTokenSecret({ CONNECTOR_SECRET: secret })) {
    const err = new Error('Los accesos guardados están cifrados y falta CONNECTOR_SECRET en el servidor.');
    err.code = 'PROVIDER_UNAVAILABLE';
    throw err;
  }
  const [iv, tag, data] = value.slice(PREFIX.length).split('.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    const err = new Error('No se pudo descifrar el acceso guardado (¿cambió CONNECTOR_SECRET?). Vuelve a conectar tu cuenta de Google.');
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }
}
