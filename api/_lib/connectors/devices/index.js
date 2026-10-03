// The devices where the user is signed in to Eddie (their Chromebook, phone,
// another computer) and the one thing that can be asked of them from any other
// (or from Telegram): switch Modo Vigilancia on or off and watch its camera.
// Only a device that is on right now and whose owner switched "control remoto"
// on there (and gave it the camera permission once) can be reached. There is no
// confirmation card: the orders are the user's own, to their own devices, and
// the point is to use a phone as the screen of a camera left at home. What
// protects it is that opt-in per device, the camera permission given at the
// device itself, and the red chip shown there. The screen for this is
// Configuración → Dispositivos.
import { hasTelegramLink } from '../../telegram/store.js';
import { deviceByUser } from '../../computer/store.js';
import { describeAck, findDevice, isOnline, whyNotReachable } from '../../devices/logic.js';
import { clearFrame, listDevices } from '../../devices/store.js';
import { publicDevice, sendCommand, waitForAck } from '../../devices/handlers.js';
import { clip } from '../http.js';

const getUser = async (context) => context.getUser?.();
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
        const [devices, telegram, computer] = await Promise.all([listDevices(user.id), hasTelegramLink(user.id).catch(() => false), deviceByUser(user.id).catch(() => null)]);
        const shown = devices.map((d) => publicDevice(d));
        const on = shown.filter((d) => d.online);
        return {
          devices: shown.map((d) => ({ name: d.name, platform: d.platform, online: d.online, remoteControl: d.remoteEnabled, lastSeen: d.lastSeen })),
          telegramLinked: Boolean(telegram),
          computer: computer ? { name: computer.name, online: isOnline(computer.lastSeen) } : null,
          summary: shown.length ? `${shown.length} dispositivo${shown.length === 1 ? '' : 's'}, ${on.length} encendido${on.length === 1 ? '' : 's'}: ${on.map((d) => d.name).join(', ') || 'ninguno ahora'}` : 'Ningún dispositivo conectado todavía',
        };
      },
    },
    {
      label: 'Activar o apagar el Modo Vigilancia en un dispositivo',
      activity: 'Enviando la orden al dispositivo…',
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'set_vigilance',
        description:
          'Activa o apaga el Modo Vigilancia (la cámara con visión) en OTRO dispositivo del usuario ("activa la vigilancia en mi PC"), aunque hable desde el teléfono. Se ejecuta de inmediato, SIN pedir confirmación (el usuario ya lo pidió). Al activar desde la app, además abre la vista de esa cámara en esta pantalla y Eddie va contando en voz alta lo que ocurre cada pocos segundos. Solo funciona si el otro dispositivo está encendido (con Eddie abierto) y permite el control remoto. Usa list_devices si no sabes cómo se llaman.',
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo, ej. "PC" o "Chromebook".' },
            action: { type: 'STRING', description: '"on" para activar (y empezar a vigilar y contar lo que se ve), "off" para apagar.' },
          },
          required: ['device', 'action'],
        },
      },
      run: async (args, context) => {
        const resolved = await resolve(args, context);
        if (resolved.error) return { error: resolved.error };
        const { user, device } = resolved;
        // From the app the camera is also watched here (and narrated); from Telegram there is no screen to show it on.
        const watch = resolved.action === 'vigilance_on' && context.channel !== 'telegram';
        return changeDevice({ user, device, command: watch ? 'view_start' : resolved.action, context, closeView: resolved.action === 'vigilance_off' });
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
    {
      label: 'Ver lo que ve la cámara de otro dispositivo',
      activity: 'Pidiéndole la cámara al dispositivo…',
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'watch_device',
        description:
          'Muestra al usuario lo que ve la cámara de OTRO de sus dispositivos (su PC, Chromebook…): enciende allí la vigilancia, abre la vista en vivo en esta pantalla y Eddie va contando en voz alta, cada pocos segundos, lo que pasa ("¿qué ve el PC?", "enséñame la cámara del portátil", "avísame lo que veas en la PC"). Se ejecuta de inmediato, SIN pedir confirmación. Solo funciona si ese dispositivo está encendido y permite el control remoto. action "start" (por defecto) o "stop" para dejar de ver.',
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo, ej. "PC".' },
            action: { type: 'STRING', description: '"start" para ver su cámara, "stop" para dejar de verla.' },
          },
          required: ['device'],
        },
      },
      run: async (args, context) => {
        const resolved = await resolveWatch(args, context);
        if (resolved.error) return { error: resolved.error };
        const { user, device, action } = resolved;
        return changeDevice({ user, device, command: action, context, closeView: action === 'view_stop' });
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};

// Sends the order and waits for the device's answer. A start also opens the
// camera view on this screen (which narrates it); a stop closes that view. Nothing
// is asked of the user: they already said what they want, on their own devices.
async function changeDevice({ user, device, command, context, closeView }) {
  if (command === 'view_start' || command === 'view_stop') await clearFrame(user.id, device.id).catch(() => {});
  const sent = await sendCommand(user, { target: device, action: command });
  if (sent.error) return { error: sent.error };
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

// The user, the device and 'view_start' | 'view_stop', or an { error }.
async function resolveWatch(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const raw = String(args.action || 'start').trim();
  const action = /^(start|ver|mostrar|muestra|on|activar|activa)$/i.test(raw) ? 'view_start' : /^(stop|dejar|parar|para|off|apagar|apaga|cerrar)$/i.test(raw) ? 'view_stop' : null;
  if (!action) return { error: 'La acción debe ser "start" (ver su cámara) o "stop" (dejar de verla).' };
  const found = findDevice(await listDevices(user.id), args.device);
  if (found.error) return { error: found.error };
  const why = whyNotReachable(found.device);
  if (why) return { error: why };
  return { user, device: found.device, action };
}

// The user, the device they meant and the action, or an { error } written for the model.
async function resolve(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const action = /^(on|activar|activa|encender|enciende)$/i.test(String(args.action || '').trim()) ? 'vigilance_on' : /^(off|apagar|apaga|desactivar|desactiva)$/i.test(String(args.action || '').trim()) ? 'vigilance_off' : null;
  if (!action) return { error: 'La acción debe ser "on" (activar el Modo Vigilancia) o "off" (apagarlo).' };
  const devices = await listDevices(user.id);
  const found = findDevice(devices, args.device);
  if (found.error) return { error: found.error };
  const why = whyNotReachable(found.device);
  if (why) return { error: why };
  return { user, device: found.device, action };
}
