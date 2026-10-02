// This browser as a device: a random id it keeps (so the same browser is the
// same device), a name, and its own switch for accepting commands from other
// devices. Kept apart from the synced settings on purpose: each device decides
// for itself, whatever the others say.
import { defaultDeviceName, describePlatform } from './devicePlatform';

const KEY = 'eddie.device';
export const DEVICE_CHANGED_EVENT = 'eddie:device-changed';

function newClientId() {
  const bytes = new Uint8Array(18);
  (window.crypto || globalThis.crypto).getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 30).padEnd(20, 'x');
}

export function readIdentity() {
  let stored = {};
  try {
    stored = JSON.parse(window.localStorage.getItem(KEY) || '{}') || {};
  } catch {
    stored = {};
  }
  const ua = navigator.userAgent || '';
  const identity = {
    clientId: /^[A-Za-z0-9_-]{16,64}$/.test(stored.clientId || '') ? stored.clientId : newClientId(),
    name: typeof stored.name === 'string' && stored.name.trim() ? stored.name.trim().slice(0, 40) : defaultDeviceName(ua),
    allowRemote: stored.allowRemote === true,
    platform: describePlatform(ua),
  };
  if (stored.clientId !== identity.clientId) writeIdentity(identity);
  return identity;
}

function writeIdentity(identity) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ clientId: identity.clientId, name: identity.name, allowRemote: identity.allowRemote }));
  } catch {
    // Without storage this browser looks like a new device each time.
  }
}

export function updateIdentity(patch) {
  const next = { ...readIdentity(), ...patch };
  writeIdentity(next);
  window.dispatchEvent(new Event(DEVICE_CHANGED_EVENT));
  return next;
}
