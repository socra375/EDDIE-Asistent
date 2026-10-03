// The browser side of the camera lock: making a password nobody has to invent, and proving it —
// with the password or with the device's own fingerprint / face / PIN (a WebAuthn passkey) —
// to get the one-use token a camera start needs. Nothing here is ever stored: the password is
// typed, sent over HTTPS and forgotten; the server keeps only a hash.
import { authorizeCamera, createPasskeyLock, passkeyAuthOptions, passkeyRegistrationOptions } from './devices';

const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/l/I
const GENERATED_LENGTH = 20;

// A strong password from the browser's own random numbers.
export function generatePassword(length = GENERATED_LENGTH) {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length); // no modulo bias
  while (out.length < length) {
    const bytes = new Uint8Array(length * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < length) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join('');
}

// Can this device check a fingerprint / face / PIN? (Needs HTTPS and a platform authenticator.)
export async function passkeySupported() {
  try {
    if (!window.PublicKeyCredential || !window.isSecureContext) return false;
    return Boolean(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

const webauthn = () => import('@simplewebauthn/browser');

function explainPasskeyError(err) {
  if (err?.name === 'NotAllowedError') return new Error('Se canceló la verificación del equipo (huella, rostro o PIN).');
  if (err?.name === 'InvalidStateError') return new Error('Esta huella ya está registrada en este equipo.');
  return err instanceof Error ? err : new Error('No se pudo usar la huella de este equipo.');
}

// Creates the lock with this device's fingerprint / face / PIN. Once.
export async function createPasskey() {
  const { startRegistration } = await webauthn();
  const options = await passkeyRegistrationOptions();
  let response;
  try {
    response = await startRegistration({ optionsJSON: options });
  } catch (err) {
    throw explainPasskeyError(err);
  }
  await createPasskeyLock(response);
}

// → the one-use token.
export async function proveWithPassword(password) {
  return (await authorizeCamera({ password })).token;
}

export async function proveWithPasskey() {
  const { startAuthentication } = await webauthn();
  const options = await passkeyAuthOptions();
  let passkey;
  try {
    passkey = await startAuthentication({ optionsJSON: options });
  } catch (err) {
    throw explainPasskeyError(err);
  }
  return (await authorizeCamera({ passkey })).token;
}

// Strips the one-use proof from card arguments before they are kept in the conversation.
export const withoutSecrets = (args) => {
  if (!args || typeof args !== 'object') return args;
  const { token: _token, ...rest } = args;
  return rest;
};
