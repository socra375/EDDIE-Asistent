// /api/connectors/devices/* — the devices of the user's account.
//   GET  devices                 the list (and Telegram / EDDIE Prime), `?me=<clientId>` marks this browser
//   POST devices/heartbeat       "I am here" (every ~2 min while Eddie is open; also registers the browser)
//   POST devices/rename          { id, name }
//   POST devices/remove          { id } forgets a device and closes its session
//   POST devices/command         { targetId, action } asks another device to switch Modo Vigilancia on/off
//   GET  devices/commands        `?clientId=` the device takes the commands waiting for it
//   POST devices/ack             { clientId, id, status, message } the device answers a command
//   GET  devices/state           `?id=` the sender asks how a command went
// Everything needs the login cookie. A device can only be reached if the user
// switched "control remoto" on in that very device, and it is on right now.
import { requireUser, destroySession, SESSION_COOKIE_NAME } from '../session.js';
import { hasTelegramLink } from '../telegram/store.js';
import { deviceByUser } from '../computer/store.js';
import { ntfyBase, ringDoorbell } from '../computer/run.js';
import { ACTIONS, CLIENT_ID_RE, cleanDeviceName, cleanPlatform, describeAck, isOnline, whyNotReachable } from './logic.js';
import { ackCommand, commandState, createCommand, deviceByClient, deviceById, expireCommand, listDevices, pendingCount, removeDevice, renameDevice, takeCommands, touchDevice } from './store.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ACK_STATUS = ['done', 'consent', 'error'];
export const ACK_WAIT_MS = 12_000;
const POLL_MS = 700;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const bad = (error, status = 400) => ({ status, json: { error } });

// What a screen needs to know about a device (never its secret topic).
export function publicDevice(device, { currentSession, meClient, now } = {}) {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    lastSeen: device.lastSeen,
    online: isOnline(device.lastSeen, now),
    remoteEnabled: device.remoteEnabled,
    current: Boolean((meClient && device.clientId === meClient) || (currentSession && device.sessionId === currentSession)),
  };
}

// Queue the command and ring the target's doorbell. { id, device } or { error }.
export async function sendCommand(user, { target, action }, { fetchImpl, env } = {}) {
  if (!ACTIONS.includes(action)) return { error: 'Esa acción no existe.' };
  const why = whyNotReachable(target);
  if (why) return { error: why };
  const id = await createCommand(user.id, target.id, action);
  const rang = await ringDoorbell(target.topic, { fetchImpl, env });
  // Without the doorbell the device still takes it at its next check-in (≤ 2 min); say so.
  return { id, device: target, rang };
}

// Waits for the device's answer: { status, message } — 'timeout' when it never came.
export async function waitForAck(userId, id, { ms = ACK_WAIT_MS, pollMs = POLL_MS, sleep = wait } = {}) {
  const started = Date.now();
  for (;;) {
    await sleep(pollMs);
    const state = await commandState(userId, id);
    if (!state) return { status: 'error', message: 'La orden desapareció.' };
    if (ACK_STATUS.includes(state.status)) return { status: state.status, message: state.message };
    if (Date.now() - started >= ms) {
      await expireCommand(id);
      return { status: 'timeout', message: '' };
    }
  }
}

export async function handleDevicesRoute({ method, path = [], cookies = {}, query = {}, body }) {
  const user = await requireUser(cookies);
  const sessionId = cookies[SESSION_COOKIE_NAME] || null;
  const sub = path[1];

  if (!sub && method === 'GET') {
    const [devices, telegram, computer] = await Promise.all([listDevices(user.id), hasTelegramLink(user.id).catch(() => false), deviceByUser(user.id).catch(() => null)]);
    const meClient = CLIENT_ID_RE.test(String(query.me || '')) ? String(query.me) : null;
    const others = [{ kind: 'telegram', name: 'Telegram', linked: Boolean(telegram) }];
    if (computer) others.push({ kind: 'computer', name: computer.name, linked: true, online: isOnline(computer.lastSeen), lastSeen: computer.lastSeen });
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { devices: devices.map((d) => publicDevice(d, { currentSession: sessionId, meClient })), others } };
  }

  if (sub === 'heartbeat' && method === 'POST') {
    const clientId = String(body?.clientId || '');
    if (!CLIENT_ID_RE.test(clientId)) return bad('Falta el identificador de este dispositivo.');
    const device = await touchDevice(user.id, {
      clientId,
      name: cleanDeviceName(body?.name),
      platform: cleanPlatform(body?.platform),
      sessionId: UUID_RE.test(String(sessionId)) ? sessionId : null,
      remoteEnabled: body?.remoteEnabled === true,
    });
    const pending = device.remoteEnabled ? await pendingCount(device.id) : 0;
    return {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store' },
      // The doorbell topic only goes to a device that accepts commands.
      json: { device: { id: device.id, name: device.name, remoteEnabled: device.remoteEnabled }, pending, ...(device.remoteEnabled ? { topic: device.topic, ntfy: ntfyBase() } : {}) },
    };
  }

  if (sub === 'rename' && method === 'POST') {
    if (!UUID_RE.test(String(body?.id || ''))) return bad('Indica el dispositivo.');
    const ok = await renameDevice(user.id, body.id, cleanDeviceName(body?.name));
    return ok ? { status: 200, json: { ok: true, name: cleanDeviceName(body?.name) } } : bad('Ese dispositivo ya no existe.', 404);
  }

  if (sub === 'remove' && method === 'POST') {
    if (!UUID_RE.test(String(body?.id || ''))) return bad('Indica el dispositivo.');
    const device = await deviceById(user.id, body.id);
    if (!device) return bad('Ese dispositivo ya no existe.', 404);
    if (device.sessionId && device.sessionId === sessionId) return bad('Este es el dispositivo que estás usando: para salir, usa «Cerrar sesión».');
    await removeDevice(user.id, device.id);
    if (device.sessionId) await destroySession(device.sessionId);
    return { status: 200, json: { ok: true } };
  }

  if (sub === 'command' && method === 'POST') {
    if (!UUID_RE.test(String(body?.targetId || ''))) return bad('Elige el dispositivo.');
    const target = await deviceById(user.id, body.targetId);
    if (!target) return bad('Ese dispositivo ya no existe.', 404);
    const outcome = await sendCommand(user, { target, action: String(body?.action || '') });
    if (outcome.error) return bad(outcome.error, 409);
    return { status: 200, json: { id: outcome.id, device: target.name, rang: outcome.rang } };
  }

  if (sub === 'commands' && method === 'GET') {
    const clientId = String(query.clientId || '');
    if (!CLIENT_ID_RE.test(clientId)) return bad('Falta el identificador de este dispositivo.');
    const device = await deviceByClient(user.id, clientId);
    if (!device || !device.remoteEnabled) return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { commands: [] } };
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { commands: await takeCommands(device.id) } };
  }

  if (sub === 'ack' && method === 'POST') {
    const clientId = String(body?.clientId || '');
    if (!CLIENT_ID_RE.test(clientId) || !UUID_RE.test(String(body?.id || ''))) return bad('Faltan datos de la respuesta.');
    if (!ACK_STATUS.includes(body?.status)) return bad('Estado no válido.');
    const device = await deviceByClient(user.id, clientId);
    if (!device) return bad('Dispositivo desconocido.', 404);
    const ok = await ackCommand(device.id, body.id, body.status, cleanPlatform(body?.message).slice(0, 160));
    return { status: 200, json: { ok } };
  }

  if (sub === 'state' && method === 'GET') {
    if (!UUID_RE.test(String(query.id || ''))) return bad('Indica la orden.');
    const state = await commandState(user.id, query.id);
    if (!state) return bad('Esa orden ya no existe.', 404);
    const device = await deviceById(user.id, state.deviceId);
    return { status: 200, headers: { 'Cache-Control': 'private, no-store' }, json: { status: state.status, message: state.message, text: device ? describeAck(device, state.action, state.status, state.message) : '' } };
  }

  return { status: 405, json: { error: 'Método no permitido.' } };
}
