// The camera lock (see db/migrations/0012_camera_lock.sql): a password or a
// fingerprint/face (WebAuthn) that must be given every time a camera of the
// user's devices is switched on from elsewhere. Created once, never shown
// again; removed only with the secret itself, or after a 24-hour wait if it
// is forgotten (and the owner is told). Brute force makes it lock for a while.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { getDb } from '../db.js';

const scryptAsync = promisify(scrypt);

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
export const TOKEN_TTL_S = 120;
export const GRANT_TTL_H = 8;
export const DELETE_DELAY_H = 24;
export const CHALLENGE_TTL_S = 300;
const ALERT_FAILURES = 3;

export class LockError extends Error {
  constructor(message, status = 400, code = 'LOCK') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const iso = (v) => (v ? new Date(v).toISOString() : null);

// ---- passwords: scrypt, never stored or returned in the clear ----
const N = 16384;
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, { N, r: 8, p: 1 });
  return `scrypt$${N}$8$1$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash, 'base64url');
    const key = Buffer.from(await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) }));
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export function validatePassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > MAX_PASSWORD) return `La contraseña no puede pasar de ${MAX_PASSWORD} caracteres.`;
  if (/^(.)\1+$/.test(password)) return 'Esa contraseña es demasiado simple.';
  if (typeof confirm !== 'string' || confirm !== password) return 'Las dos copias de la contraseña no coinciden.';
  return null;
}

// How long a user is locked out after this many wrong tries in a row.
export function lockMinutes(failures) {
  if (failures >= 10) return 360;
  if (failures >= 8) return 60;
  if (failures >= 5) return 15;
  return 0;
}

// ---- storage ----
async function readLock(userId) {
  const sql = getDb();
  const rows = await sql`select password_hash, created_at, delete_requested_at, delete_at, failures, locked_until from camera_locks where user_id = ${userId}`;
  const r = rows[0];
  return r ? { passwordHash: r.password_hash, createdAt: iso(r.created_at), deleteRequestedAt: iso(r.delete_requested_at), deleteAt: iso(r.delete_at), failures: r.failures, lockedUntil: iso(r.locked_until) } : null;
}

async function passkeysOf(userId) {
  const sql = getDb();
  const rows = await sql`select id, public_key, counter, transports from camera_passkeys where user_id = ${userId}`;
  return rows.map((r) => ({ id: r.id, publicKey: r.public_key, counter: Number(r.counter), transports: r.transports ? JSON.parse(r.transports) : undefined }));
}

async function removeEverything(userId) {
  const sql = getDb();
  await sql`delete from camera_grants where user_id = ${userId}`;
  await sql`delete from camera_tokens where user_id = ${userId}`;
  await sql`delete from camera_passkeys where user_id = ${userId}`;
  await sql`delete from camera_challenges where user_id = ${userId}`;
  await sql`delete from camera_locks where user_id = ${userId}`;
}

// Removal that was asked for and whose wait is over happens the next time anyone looks.
async function currentLock(userId, now = Date.now()) {
  const lock = await readLock(userId);
  if (lock?.deleteAt && new Date(lock.deleteAt).getTime() <= now) {
    await removeEverything(userId);
    return null;
  }
  return lock;
}

// What a screen may know: that there is a lock, how it opens and whether it is going away. Never the secret.
export async function lockStatus(userId) {
  const lock = await currentLock(userId);
  if (!lock) return { state: 'none' };
  const passkeys = await passkeysOf(userId);
  const locked = Boolean(lock.lockedUntil && new Date(lock.lockedUntil).getTime() > Date.now());
  return { state: 'set', methods: { password: Boolean(lock.passwordHash), passkey: passkeys.length > 0 }, createdAt: lock.createdAt, pendingDelete: lock.deleteAt, locked, lockedUntil: locked ? lock.lockedUntil : null };
}

// ---- creating it, once ----
export async function createPasswordLock(userId, password, confirm) {
  const problem = validatePassword(password, confirm);
  if (problem) throw new LockError(problem);
  const sql = getDb();
  const hash = await hashPassword(password);
  const rows = await sql`insert into camera_locks (user_id, password_hash) values (${userId}, ${hash}) on conflict (user_id) do nothing returning user_id`;
  if (!rows.length) throw new LockError('La contraseña de la cámara ya existe y no se puede volver a crear ni cambiar. Para cambiarla, pide eliminarla primero.', 409, 'EXISTS');
}

// ---- WebAuthn (fingerprint / face / device PIN) ----
// The page's own origin; the relying-party id is its host. The origin must be this very site.
export function webauthnConfig(headers = {}, env = process.env) {
  const host = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim();
  const origin = String(headers.origin || '').trim();
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new LockError('No se pudo comprobar de qué sitio viene la petición.', 400, 'ORIGIN');
  }
  if (!host || url.host !== host) throw new LockError('La petición no viene de esta misma página.', 403, 'ORIGIN');
  if (env.APP_URL && /^https?:\/\//.test(env.APP_URL) && new URL(env.APP_URL).hostname !== url.hostname && !/\.vercel\.app$/.test(url.hostname) && url.hostname !== 'localhost') {
    throw new LockError('La huella o el rostro solo se pueden usar desde la dirección principal de Eddie.', 403, 'ORIGIN');
  }
  return { rpID: url.hostname, origin: url.origin };
}

async function saveChallenge(userId, purpose, challenge) {
  const sql = getDb();
  await sql`
    insert into camera_challenges (user_id, purpose, challenge, expires_at) values (${userId}, ${purpose}, ${challenge}, now() + make_interval(secs => ${CHALLENGE_TTL_S}))
    on conflict (user_id, purpose) do update set challenge = excluded.challenge, expires_at = excluded.expires_at
  `;
}

async function takeChallenge(userId, purpose) {
  const sql = getDb();
  const rows = await sql`delete from camera_challenges where user_id = ${userId} and purpose = ${purpose} and expires_at > now() returning challenge`;
  if (!rows.length) throw new LockError('La verificación caducó. Inténtalo de nuevo.', 400, 'CHALLENGE');
  return rows[0].challenge;
}

export async function passkeyRegistrationOptions(userId, userName, headers) {
  if (await currentLock(userId)) throw new LockError('La contraseña de la cámara ya existe y no se puede volver a crear.', 409, 'EXISTS');
  const { rpID } = webauthnConfig(headers);
  const options = await generateRegistrationOptions({
    rpName: 'Eddie',
    rpID,
    userName: userName || 'usuario',
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
  });
  await saveChallenge(userId, 'register', options.challenge);
  return options;
}

export async function createPasskeyLock(userId, response, headers) {
  const { rpID, origin } = webauthnConfig(headers);
  const expectedChallenge = await takeChallenge(userId, 'register');
  let verification;
  try {
    verification = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
  } catch (err) {
    throw new LockError(`No se pudo verificar la huella o el rostro: ${err.message}`, 400, 'WEBAUTHN');
  }
  if (!verification.verified || !verification.registrationInfo) throw new LockError('No se pudo verificar la huella o el rostro.', 400, 'WEBAUTHN');
  const { credential } = verification.registrationInfo;
  const sql = getDb();
  const rows = await sql`insert into camera_locks (user_id, password_hash) values (${userId}, ${null}) on conflict (user_id) do nothing returning user_id`;
  if (!rows.length) throw new LockError('La contraseña de la cámara ya existe y no se puede volver a crear.', 409, 'EXISTS');
  await sql`
    insert into camera_passkeys (id, user_id, public_key, counter, transports)
    values (${credential.id}, ${userId}, ${Buffer.from(credential.publicKey).toString('base64url')}, ${credential.counter}, ${JSON.stringify(credential.transports || [])})
  `;
}

export async function passkeyAuthOptions(userId, headers) {
  const lock = await currentLock(userId);
  const passkeys = lock ? await passkeysOf(userId) : [];
  if (!passkeys.length) throw new LockError('Esta protección no usa huella ni rostro.', 400, 'NO_PASSKEY');
  const { rpID } = webauthnConfig(headers);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: passkeys.map((p) => ({ id: p.id, transports: p.transports })) });
  await saveChallenge(userId, 'auth', options.challenge);
  return options;
}

// ---- proving it: password or passkey → a token good for one start ----
async function mintToken(userId) {
  const sql = getDb();
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  await sql`insert into camera_tokens (hash, user_id, expires_at) values (${hash}, ${userId}, now() + make_interval(secs => ${TOKEN_TTL_S}))`;
  if (Math.random() < 0.1) await sql`delete from camera_tokens where expires_at < now()`;
  return token;
}

async function failed(userId, lock, alert) {
  const sql = getDb();
  const failures = (lock.failures || 0) + 1;
  const minutes = lockMinutes(failures);
  await sql`update camera_locks set failures = ${failures}, locked_until = ${minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null} where user_id = ${userId}`;
  if (failures === ALERT_FAILURES || (minutes && failures % 5 === 0)) await alert?.('Intentos fallidos con la contraseña de la cámara', `Alguien falló ${failures} veces la contraseña de la cámara de Eddie. Si no fuiste tú, cierra sesión en los equipos que no reconozcas.`).catch(() => {});
  return minutes;
}

// → { token } or throws LockError (wrong secret, locked out, no lock).
export async function authorize(userId, proof, headers, { alert } = {}) {
  const lock = await currentLock(userId);
  if (!lock) throw new LockError('Todavía no creaste la contraseña de la cámara: hazlo en Configuración → Dispositivos.', 409, 'NO_LOCK');
  if (lock.lockedUntil && new Date(lock.lockedUntil).getTime() > Date.now()) {
    throw new LockError(`Demasiados intentos fallidos. Vuelve a intentarlo después de las ${new Date(lock.lockedUntil).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}.`, 429, 'LOCKED');
  }
  let ok = false;
  if (typeof proof?.password === 'string' && lock.passwordHash) {
    ok = await checkPassword(proof.password.slice(0, MAX_PASSWORD + 1), lock.passwordHash);
  } else if (proof?.passkey && typeof proof.passkey === 'object') {
    const passkeys = await passkeysOf(userId);
    const used = passkeys.find((p) => p.id === proof.passkey.id);
    if (used) {
      const { rpID, origin } = webauthnConfig(headers);
      try {
        // A missing or used-up challenge (a replayed answer) fails like a wrong one.
        const expectedChallenge = await takeChallenge(userId, 'auth');
        const result = await verifyAuthenticationResponse({
          response: proof.passkey,
          expectedChallenge,
          expectedOrigin: origin,
          expectedRPID: rpID,
          requireUserVerification: true,
          credential: { id: used.id, publicKey: Uint8Array.from(Buffer.from(used.publicKey, 'base64url')), counter: used.counter, transports: used.transports },
        });
        ok = result.verified;
        if (ok) await getDb()`update camera_passkeys set counter = ${result.authenticationInfo.newCounter} where id = ${used.id}`;
      } catch {
        ok = false;
      }
    }
  } else {
    throw new LockError('Falta la contraseña o la huella.', 400, 'NO_PROOF');
  }
  if (!ok) {
    const minutes = await failed(userId, lock, alert);
    throw new LockError(minutes ? `Incorrecta. Se bloquea ${minutes} min por los intentos fallidos.` : 'Contraseña o huella incorrecta.', 403, 'WRONG');
  }
  if (lock.failures) await getDb()`update camera_locks set failures = 0, locked_until = null where user_id = ${userId}`;
  return { token: await mintToken(userId), expiresIn: TOKEN_TTL_S };
}

// The camera is about to start: the lock must exist and the proof be a fresh one (used up here).
export async function consumeToken(userId, token) {
  const lock = await currentLock(userId);
  if (!lock) throw new LockError('Antes de usar la cámara a distancia crea la contraseña de la cámara (Configuración → Dispositivos).', 403, 'NO_LOCK');
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) throw new LockError('Falta la autorización de la cámara: escribe tu contraseña (o usa tu huella).', 403, 'NEEDS_AUTH');
  const sql = getDb();
  const hash = createHash('sha256').update(token).digest('hex');
  const rows = await sql`delete from camera_tokens where hash = ${hash} and user_id = ${userId} and expires_at > now() returning hash`;
  if (!rows.length) throw new LockError('La autorización de la cámara caducó o ya se usó. Vuelve a escribir tu contraseña.', 403, 'NEEDS_AUTH');
}

// ---- grants: who may read a camera that was started with the proof ----
export async function grantView(userId, deviceId) {
  const sql = getDb();
  await sql`
    insert into camera_grants (user_id, device_id, expires_at) values (${userId}, ${deviceId}, now() + make_interval(hours => ${GRANT_TTL_H}))
    on conflict (user_id, device_id) do update set expires_at = excluded.expires_at
  `;
}

export async function hasGrant(userId, deviceId) {
  const sql = getDb();
  const rows = await sql`select 1 from camera_grants where user_id = ${userId} and device_id = ${deviceId} and expires_at > now()`;
  return rows.length > 0;
}

export async function revokeGrant(userId, deviceId) {
  const sql = getDb();
  await sql`delete from camera_grants where user_id = ${userId} and device_id = ${deviceId}`;
}

// ---- removing it ----
// With a fresh proof: at once. Without (forgotten): after DELETE_DELAY_H, and the owner is told.
export async function requestRemoval(userId, token, { alert } = {}) {
  const lock = await currentLock(userId);
  if (!lock) throw new LockError('No hay contraseña de cámara que eliminar.', 404, 'NO_LOCK');
  if (token) {
    await consumeToken(userId, token);
    await removeEverything(userId);
    return { removed: true };
  }
  const sql = getDb();
  if (lock.deleteAt) return { removed: false, deleteAt: lock.deleteAt };
  const rows = await sql`
    update camera_locks set delete_requested_at = now(), delete_at = now() + make_interval(hours => ${DELETE_DELAY_H}) where user_id = ${userId} and delete_at is null returning delete_at
  `;
  const deleteAt = iso(rows[0]?.delete_at);
  await alert?.('Se pidió eliminar la contraseña de la cámara', `Se eliminará dentro de ${DELETE_DELAY_H} horas. Si no fuiste tú, entra en Eddie → Configuración → Dispositivos y cancela la eliminación.`).catch(() => {});
  return { removed: false, deleteAt };
}

export async function cancelRemoval(userId) {
  const sql = getDb();
  await sql`update camera_locks set delete_at = null, delete_requested_at = null where user_id = ${userId}`;
}
