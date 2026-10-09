// The devices where the user is signed in to Eddie (their Chromebook, phone,
// another computer) and what can be asked of them from any other: switch their
// camera on and watch it (Modo Vigilancia), or off. Only a device that is on right
// now and whose owner switched "control remoto" on there (and gave it the camera
// permission once) can be reached. Switching a camera ON always needs the camera
// lock's proof (a password or fingerprint typed in the confirmation card, never in
// the chat) and only works from the app, not from Telegram; switching it off needs nothing.
import { hasTelegramLink } from '../../telegram/store.js';
import { devicesByUser } from '../../computer/store.js';
import { describeAck, findDevice, isOnline, whyNotReachable } from '../../devices/logic.js';
import { clearFrame, listDevices } from '../../devices/store.js';
import { LockError, consumeToken, grantView, lockEnforced, lockStatus, requestRemoval, revokeGrant } from '../../devices/cameraLock.js';
import { alertOwner, publicDevice, sendCommand, waitForAck } from '../../devices/handlers.js';
import { clip } from '../http.js';

const getUser = async (context) => context.getUser?.();
// The camera lock is off for now (CAMERA_LOCK=on brings it back): see lockEnforced().
const WATCH_LOCKED =
  'Activa el Modo Vigilancia (la cámara) en OTRO dispositivo del usuario ("activa la vigilancia en mi PC", "enséñame lo que ve el Chromebook", "¿qué ve el PC?"), abre la vista en vivo en esta pantalla y Eddie va contando en voz alta, cada pocos segundos, lo que pasa. Por seguridad SIEMPRE aparece una tarjeta donde el usuario escribe su contraseña de cámara (o usa su huella): tú no la pidas, no la veas ni la repitas, y no rellenes `token`. Solo funciona si el otro dispositivo está encendido y permite el control remoto, y solo desde la app (no desde Telegram). Para apagarla usa stop_watching.';
const WATCH_OPEN =
  'Activa el Modo Vigilancia (la cámara) en OTRO dispositivo del usuario ("activa la vigilancia en mi PC", "enséñame lo que ve el Chromebook", "¿qué ve el PC?"), abre la vista en vivo en esta pantalla y Eddie va contando en voz alta, cada pocos segundos, lo que pasa. Se ejecuta de inmediato, sin tarjeta ni contraseña. Solo funciona si el otro dispositivo está encendido y permite el control remoto. Desde Telegram solo enciende la vigilancia (no hay pantalla donde mostrarla). Para apagarla usa stop_watching.';
const SIGN_IN = 'Para usar tus dispositivos, inicia sesión con tu cuenta de Google.';

export default {
  id: 'devices',
  name: 'Mis dispositivos',
  description:
    'Eddie sabe en qué dispositivos de tu cuenta está abierto (Chromebook, teléfono, otra computadora) y desde cualquiera de ellos —o desde Telegram— puede activar o apagar el Modo Vigilancia en el que elijas y, desde la app, enseñarte su cámara y contarte en voz alta lo que ve, siempre que esté encendido y lo hayas permitido allí.',
  icon: 'monitor',
  category: 'asistente',
  route: /\b(dispositivos?|vigilancia|c[aá]mara|tel[eé]fono|celular|tablet|port[aá]til|chromebook|computador[a]?|\bpc\b|laptop|ordenador)\b/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Cada dispositivo decide si acepta órdenes (Configuración → Dispositivos → «Permitir control remoto»; apagado por defecto) y el permiso de la cámara se da una sola vez en ese equipo; después se activa desde cualquier lugar sin preguntar. La cámara siempre muestra el chip rojo de vigilancia.',
  tools: [
    {
      label: 'Ver tus dispositivos',
      activity: 'Revisando tus dispositivos…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
      declaration: {
        name: 'list_devices',
        description: 'Lista los dispositivos del usuario donde Eddie está abierto con su cuenta: nombre, si están encendidos ahora y si permiten órdenes desde otros dispositivos.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: async (_args, context) => {
        const user = await getUser(context);
        if (!user) return { error: SIGN_IN };
        const [devices, telegram, computer] = await Promise.all([listDevices(user.id), hasTelegramLink(user.id).catch(() => false), devicesByUser(user.id).catch(() => [])]);
        const shown = devices.map((d) => publicDevice(d));
        const on = shown.filter((d) => d.online);
        return {
          devices: shown.map((d) => ({ name: d.name, platform: d.platform, online: d.online, remoteControl: d.remoteEnabled, lastSeen: d.lastSeen })),
          telegramLinked: Boolean(telegram),
          computers: computer.map((c) => ({ name: c.name, online: isOnline(c.lastSeen) })),
          summary: shown.length ? `${shown.length} dispositivo${shown.length === 1 ? '' : 's'}, ${on.length} encendido${on.length === 1 ? '' : 's'}: ${on.map((d) => d.name).join(', ') || 'ninguno ahora'}` : 'Ningún dispositivo conectado todavía',
        };
      },
    },
    {
      label: 'Activar la cámara de otro dispositivo y ver lo que ve',
      activity: 'Pidiéndole la cámara al dispositivo…',
      // With the lock off it runs at once, as before the lock existed; with it on there is a card for the proof.
      get risk() {
        return lockEnforced() ? 'confirm' : 'write';
      },
      get sensitive() {
        return lockEnforced();
      },
      declaration: {
        name: 'watch_device',
        get description() {
          return lockEnforced() ? WATCH_LOCKED : WATCH_OPEN;
        },
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo, ej. "PC" o "Chromebook".' },
            token: { type: 'STRING', description: 'Lo rellena la tarjeta con la autorización del usuario. Déjalo vacío.' },
          },
          required: ['device'],
        },
      },
      prepare: async (args, context) => {
        if (context.channel === 'telegram') return { error: 'Por seguridad, la cámara de tus dispositivos solo se activa desde la app de Eddie, con tu contraseña de cámara o tu huella. Abre Eddie en el teléfono y pídemelo allí.' };
        const resolved = await resolveWatch(args, context);
        if (resolved.error) return { error: resolved.error };
        const lock = await lockStatus(resolved.user.id);
        if (lock.state === 'none') return { error: 'Antes de usar la cámara a distancia hay que crear la contraseña de la cámara (Configuración → Dispositivos → Seguridad de la cámara). Se crea una sola vez.' };
        return {
          args: { device: resolved.device.name, token: typeof args.token === 'string' ? args.token : '' },
          preview: {
            title: `Activar la cámara de ${resolved.device.name} y verla aquí`,
            confirmLabel: 'Activar y ver',
            fields: [
              { key: 'device', label: 'Dispositivo', value: resolved.device.name },
              { key: 'token', label: 'Tu contraseña de cámara', type: 'camera-auth', value: '' },
            ],
          },
        };
      },
      run: async (args, context) => {
        const resolved = await resolveWatch({ device: args.device }, context);
        if (resolved.error) return { error: resolved.error };
        const { user, device } = resolved;
        try {
          await consumeToken(user.id, args.token);
        } catch (err) {
          if (err instanceof LockError) return { error: err.message };
          throw err;
        }
        // From Telegram (only possible with the lock off) there is no screen to show it on: just switch the camera on.
        return changeDevice({ user, device, command: context.channel === 'telegram' ? 'vigilance_on' : 'view_start', context });
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
    {
      label: 'Apagar la cámara de otro dispositivo',
      activity: 'Apagando la cámara del dispositivo…',
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'stop_watching',
        description: 'Apaga la vigilancia y la cámara de OTRO dispositivo del usuario y cierra la vista en vivo ("apaga la vigilancia del PC", "deja de ver la cámara"). No necesita contraseña.',
        parameters: { type: 'OBJECT', properties: { device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo.' } }, required: ['device'] },
      },
      run: async (args, context) => {
        const resolved = await resolveWatch({ device: args.device }, context);
        if (resolved.error) return { error: resolved.error };
        return changeDevice({ user: resolved.user, device: resolved.device, command: 'vigilance_off', context, closeView: true });
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
    {
      label: 'Eliminar la contraseña de la cámara',
      activity: 'Preparando la eliminación de la contraseña de la cámara…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'remove_camera_lock',
        description:
          'Elimina la contraseña (o huella) de la cámara, SOLO cuando el usuario lo pide ("elimina la contraseña de la cámara"). Aparece una tarjeta: si la recuerda, la escribe ahí y se elimina al instante; si la olvidó, pon forgot=true y la eliminación se programa para dentro de 24 horas (se le avisa y puede cancelarla). Nunca la pidas por el chat ni rellenes `token`. No existe forma de ver ni cambiar esa contraseña: solo crearla una vez y eliminarla. Solo desde la app, no desde Telegram.',
        parameters: {
          type: 'OBJECT',
          properties: {
            forgot: { type: 'BOOLEAN', description: 'true solo si el usuario dice que olvidó la contraseña o perdió el equipo con su huella.' },
            token: { type: 'STRING', description: 'Lo rellena la tarjeta. Déjalo vacío.' },
          },
        },
      },
      prepare: async (args, context) => {
        if (context.channel === 'telegram') return { error: 'Por seguridad, la protección de la cámara solo se elimina desde la app de Eddie.' };
        const user = await getUser(context);
        if (!user) return { error: SIGN_IN };
        const lock = await lockStatus(user.id);
        if (lock.state === 'none') return { error: 'No hay ninguna contraseña de cámara que eliminar.' };
        const forgot = args.forgot === true;
        if (forgot && lock.pendingDelete) return { error: `Ya hay una eliminación programada para ${new Date(lock.pendingDelete).toLocaleString('es')}.` };
        return {
          args: { forgot, token: typeof args.token === 'string' ? args.token : '' },
          preview: {
            title: forgot ? 'Programar la eliminación de la contraseña de la cámara (24 h)' : 'Eliminar la contraseña de la cámara',
            confirmLabel: forgot ? 'Programar en 24 h' : 'Eliminar ahora',
            danger: true,
            fields: forgot
              ? [{ key: 'info', label: 'Qué pasa', value: 'Tarda 24 horas, te avisaremos por notificación y Telegram y puedes cancelarla. Hasta entonces la cámara sigue protegida.' }]
              : [
                  { key: 'info', label: 'Qué pasa', value: 'La protección desaparece y habrá que crear otra para usar cámaras a distancia.' },
                  { key: 'token', label: 'Tu contraseña de cámara', type: 'camera-auth', value: '' },
                ],
          },
        };
      },
      run: async (args, context) => {
        const user = await getUser(context);
        if (!user) return { error: SIGN_IN };
        if (args.forgot !== true && !args.token) return { error: 'Falta la autorización: escribe tu contraseña de cámara (o usa tu huella) en la tarjeta.' };
        try {
          const out = await requestRemoval(user.id, args.forgot === true ? null : args.token || '', { alert: (title, text) => alertOwner(user.id, title, text) });
          if (out.removed) return { removed: true, summary: 'Listo: eliminé la contraseña de la cámara. Para usar cámaras a distancia tendrás que crear una nueva.' };
          return { removed: false, deleteAt: out.deleteAt, summary: `Programé la eliminación para el ${new Date(out.deleteAt).toLocaleString('es')}. Hasta entonces la cámara sigue protegida; puedes cancelarla en Configuración → Dispositivos.` };
        } catch (err) {
          if (err instanceof LockError) return { error: err.message };
          throw err;
        }
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};

// Sends the order and waits for the device's answer. A start (which already went
// through the lock's proof) also opens the camera view on this screen, which narrates
// it; a stop closes that view.
async function changeDevice({ user, device, command, context, closeView }) {
  if (command === 'view_start' || command === 'view_stop') await clearFrame(user.id, device.id).catch(() => {});
  const sent = await sendCommand(user, { target: device, action: command });
  if (sent.error) return { error: sent.error };
  // The camera was started with the lock's proof: this screen may read it. Switching off takes that away.
  if (command === 'view_start') await grantView(user.id, device.id).catch(() => {});
  if (command === 'vigilance_off' || command === 'view_stop') await revokeGrant(user.id, device.id).catch(() => {});
  const answer = await waitForAck(user.id, sent.id);
  const base = { device: device.name, status: answer.status };
  if (closeView) context.emit?.({ type: 'close_remote_view', deviceId: device.id });
  if (command === 'view_start' && (answer.status === 'done' || answer.status === 'consent')) {
    // The view opens either way; with the camera still waiting for permission it fills in when it is given.
    context.emit?.({ type: 'open_remote_view', deviceId: device.id, name: device.name, attach: true });
    return {
      ...base,
      summary: answer.status === 'done' ? `Listo: estoy viendo la cámara de ${device.name} y te iré contando lo que pase.` : describeAck(device, command, 'consent'),
    };
  }
  return { ...base, summary: describeAck(device, command, answer.status, answer.message) };
}

// The user and the device they meant, or an { error }.
async function resolveWatch(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const found = findDevice(await listDevices(user.id), args.device);
  if (found.error) return { error: found.error };
  const why = whyNotReachable(found.device);
  if (why) return { error: why };
  return { user, device: found.device };
}
