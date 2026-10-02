// The devices where the user is signed in to Eddie (their Chromebook, phone,
// another computer) and the one thing that can be asked of them from any other
// (or from Telegram): switch Modo Vigilancia on or off. Only a device that is
// on right now and whose owner switched "control remoto" on there can be
// reached, and turning the camera mode on always asks for a confirmation card.
// The screen for this is Configuración → Dispositivos.
import { hasTelegramLink } from '../../telegram/store.js';
import { deviceByUser } from '../../computer/store.js';
import { ACTION_LABEL, describeAck, findDevice, isOnline, whyNotReachable } from '../../devices/logic.js';
import { listDevices } from '../../devices/store.js';
import { publicDevice, sendCommand, waitForAck } from '../../devices/handlers.js';
import { clip } from '../http.js';

const getUser = async (context) => context.getUser?.();
const SIGN_IN = 'Para usar tus dispositivos, inicia sesión con tu cuenta de Google.';

export default {
  id: 'devices',
  name: 'Mis dispositivos',
  description:
    'Eddie sabe en qué dispositivos de tu cuenta está abierto (Chromebook, teléfono, otra computadora) y desde cualquiera de ellos —o desde Telegram— puede activar o apagar el Modo Vigilancia en el que elijas, siempre que esté encendido y lo hayas permitido allí.',
  icon: 'monitor',
  category: 'asistente',
  route: /\b(dispositivos?|vigilancia|c[aá]mara|tel[eé]fono|celular|tablet|port[aá]til|chromebook|computador[a]?|\bpc\b|laptop|ordenador)\b/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Cada dispositivo decide si acepta órdenes (Configuración → Dispositivos → «Permitir control remoto»; apagado por defecto). La cámara siempre muestra el chip rojo de vigilancia y, la primera vez, pide permiso en ese equipo.',
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
      sensitive: true,
      declaration: {
        name: 'set_vigilance',
        description:
          'Activa o apaga el Modo Vigilancia (la cámara con visión) en OTRO dispositivo del usuario, aunque hable desde el teléfono o Telegram. Solo funciona si ese dispositivo está encendido (con Eddie abierto) y permite el control remoto. Siempre pide confirmación. Usa list_devices si no sabes cómo se llaman.',
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo, ej. "Chromebook".' },
            action: { type: 'STRING', description: '"on" para activar, "off" para apagar.' },
          },
          required: ['device', 'action'],
        },
      },
      // The device and its state are checked before the card is shown.
      prepare: async (args, context) => {
        const resolved = await resolve(args, context);
        if (resolved.error) return { error: resolved.error };
        return {
          args: { device: resolved.device.name, action: resolved.action === 'vigilance_on' ? 'on' : 'off' },
          preview: {
            title: `${resolved.action === 'vigilance_on' ? 'Activar' : 'Apagar'} el Modo Vigilancia en ${resolved.device.name}`,
            confirmLabel: resolved.action === 'vigilance_on' ? 'Activar' : 'Apagar',
            fields: [
              { key: 'device', label: 'Dispositivo', value: resolved.device.name },
              { key: 'action', label: 'Acción', value: resolved.action === 'vigilance_on' ? 'Encender la cámara y vigilar' : 'Apagar la cámara' },
            ],
          },
        };
      },
      run: async (args, context) => {
        const resolved = await resolve(args, context);
        if (resolved.error) return { error: resolved.error };
        const sent = await sendCommand(resolved.user, { target: resolved.device, action: resolved.action });
        if (sent.error) return { error: sent.error };
        const answer = await waitForAck(resolved.user.id, sent.id);
        return { device: resolved.device.name, status: answer.status, summary: describeAck(resolved.device, resolved.action, answer.status, answer.message) };
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};

// The user, the device they meant and the action, or an { error } written for the model.
async function resolve(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const action = /^(on|activar|activa|encender|enciende)$/i.test(String(args.action || '').trim()) ? 'vigilance_on' : /^(off|apagar|apaga|desactivar|desactiva)$/i.test(String(args.action || '').trim()) ? 'vigilance_off' : null;
  if (!action) return { error: `La acción debe ser "on" o "off" (${Object.values(ACTION_LABEL).join(' / ')}).` };
  const devices = await listDevices(user.id);
  const found = findDevice(devices, args.device);
  if (found.error) return { error: found.error };
  const why = whyNotReachable(found.device);
  if (why) return { error: why };
  return { user, device: found.device, action };
}
