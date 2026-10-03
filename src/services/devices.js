// The calls the app makes to /api/connectors/devices (see api/_lib/devices/).
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/devices${path}${qs}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error || `No se pudo completar (${res.status}).`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data || {};
}

// → { device, pending, topic?, ntfy? }
export const heartbeat = ({ clientId, name, platform, allowRemote }) => call('/heartbeat', { method: 'POST', body: { clientId, name, platform, remoteEnabled: allowRemote } });
// → { devices: [{ id, name, platform, lastSeen, online, remoteEnabled, current }], others: [...] }
export const listDevices = (clientId) => call('', { query: { me: clientId } });
export const renameDevice = (id, name) => call('/rename', { method: 'POST', body: { id, name } });
export const removeDevice = (id) => call('/remove', { method: 'POST', body: { id } });
// Switching a camera on (vigilance_on, view_start) needs `token`, the camera lock's proof (see authorizeCamera).
export const sendCommand = (targetId, action, token) => call('/command', { method: 'POST', body: { targetId, action, ...(token ? { token } : {}) } });
export const commandState = (id) => call('/state', { query: { id } });
export const takeCommands = (clientId) => call('/commands', { query: { clientId } });
export const ackCommand = (clientId, id, status, message = '') => call('/ack', { method: 'POST', body: { clientId, id, status, message } });

// Remote view: the device that is being watched shares pictures; the viewer takes them.
// → { watching }
export const shareFrame = ({ clientId, frame, meta }) => call('/frame', { method: 'POST', body: { clientId, frame, meta } });
// → { device, online, frame (base64 JPEG) | null, meta, caption, ageMs }
export const viewFrame = (id) => call('/frame', { query: { id } });

// Live video (WebRTC) handshake. → { iceServers }
export const iceServers = () => call('/ice');
// role 'viewer' names the watched device by `deviceId`; role 'target' speaks with its `clientId`.
export const sendSignal = ({ role, deviceId, clientId, kind, payload }) => call('/signal', { method: 'POST', body: { role, deviceId, clientId, kind, payload } });
// → { signals: [{ kind, payload }] } waiting for this side (and gone once read)
export const takeSignals = ({ role, id, clientId }) => call('/signals', { query: { role, ...(id ? { id } : {}), ...(clientId ? { clientId } : {}) } });

// The camera lock (api/_lib/devices/cameraLock.js): created once, never shown again, asked for every time a camera is
// switched on from another device. → { state: 'none' } | { state: 'set', methods: { password, passkey }, createdAt, pendingDelete, deleteAt, locked, lockedUntil }
export const lockStatus = () => call('/lock');
export const createPasswordLock = (password, confirm) => call('/lock/create-password', { method: 'POST', body: { password, confirm } });
export const passkeyRegistrationOptions = () => call('/lock/passkey-options', { method: 'POST', body: {} });
export const createPasskeyLock = (response) => call('/lock/create-passkey', { method: 'POST', body: { response } });
export const passkeyAuthOptions = () => call('/lock/auth-options', { method: 'POST', body: {} });
// → { token, expiresIn } good for ONE camera start
export const authorizeCamera = ({ password, passkey }) => call('/lock/auth', { method: 'POST', body: { password, passkey } });
// With a `token` the lock goes at once; without it a removal is scheduled (24 h, the owner is warned). → { removed } | { removed: false, deleteAt }
export const requestLockRemoval = (token) => call('/lock/delete', { method: 'POST', body: token ? { token } : {} });
export const cancelLockRemoval = () => call('/lock/cancel-delete', { method: 'POST', body: {} });
