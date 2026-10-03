// The devices where the user is signed in to Eddie (their Chromebook, phone,
// another computer) and the one thing that can be asked of them from any other
// (or from Telegram): switch Modo Vigilancia on or off. Only a device that is
// on right now and whose owner switched "control remoto" on there can be
// reached, and turning the camera mode on always asks for a confirmation card.
// The screen for this is Configuración → Dispositivos.
import { hasTelegramLink } from '../../telegram/store.js';
import { deviceByUser } from '../../computer/store.js';
import { describeAck, describeMeta, findDevice, isOnline, whyNotReachable } from '../../devices/logic.js';
import { clearFrame, listDevices, viewFrame } from '../../devices/store.js';
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
    {
      label: 'Ver lo que ve la cámara de otro dispositivo',
      activity: 'Pidiéndole la cámara al dispositivo…',
      sensitive: true,
      declaration: {
        name: 'watch_device',
        description:
          'Muestra al usuario lo que ve la cámara de OTRO de sus dispositivos (su Chromebook, otro PC, etc.): enciende allí el Modo Vigilancia, abre la vista en vivo en pantalla y te devuelve lo que se ve para que se lo cuentes ("¿qué ve el Chromebook?", "enséñame la cámara del portátil"). Solo funciona si ese dispositivo está encendido, permite el control remoto y la cámara tiene permiso allí. Siempre pide confirmación. action "start" (por defecto) o "stop" para dejar de ver.',
        parameters: {
          type: 'OBJECT',
          properties: {
            device: { type: 'STRING', description: 'Nombre (o parte del nombre) del dispositivo, ej. "Chromebook".' },
            action: { type: 'STRING', description: '"start" para ver su cámara, "stop" para dejar de verla.' },
          },
          required: ['device'],
        },
      },
      prepare: async (args, context) => {
        const resolved = await resolveWatch(args, context);
        if (resolved.error) return { error: resolved.error };
        const start = resolved.action === 'view_start';
        return {
          args: { device: resolved.device.name, action: start ? 'start' : 'stop' },
          preview: {
            title: `${start ? 'Ver lo que ve' : 'Dejar de ver'} la cámara de ${resolved.device.name}`,
            confirmLabel: start ? 'Ver cámara' : 'Dejar de ver',
            fields: [
              { key: 'device', label: 'Dispositivo', value: resolved.device.name },
              { key: 'action', label: 'Acción', value: start ? 'Encender su cámara y transmitirte la imagen' : 'Dejar de transmitir' },
            ],
          },
        };
      },
      run: async (args, context) => {
        const resolved = await resolveWatch(args, context);
        if (resolved.error) return { error: resolved.error };
        const { user, device, action } = resolved;
        if (action === 'view_stop') {
          await clearFrame(user.id, device.id).catch(() => {});
          const sent = await sendCommand(user, { target: device, action });
          if (sent.error) return { error: sent.error };
          const answer = await waitForAck(user.id, sent.id);
          return { device: device.name, status: answer.status, summary: describeAck(device, action, answer.status, answer.message) };
        }
        await clearFrame(user.id, device.id).catch(() => {});
        const sent = await sendCommand(user, { target: device, action });
        if (sent.error) return { error: sent.error };
        const answer = await waitForAck(user.id, sent.id);
        const base = { device: device.name, status: answer.status };
        if (answer.status !== 'done' && answer.status !== 'consent') return { ...base, summary: describeAck(device, action, answer.status, answer.message) };
        // The picture opens on this screen either way; with the camera still waiting for permission it fills in when it is given.
        context.emit?.({ type: 'open_remote_view', deviceId: device.id, name: device.name, attach: true });
        if (answer.status === 'consent') return { ...base, summary: describeAck(device, action, 'consent') };
        // First picture (asking for it is also what tells the device somebody is watching).
        const until = Date.now() + FIRST_FRAME_MS;
        let row = null;
        while (!row && Date.now() < until) {
          row = await viewFrame(user.id, device.id).catch(() => null);
          if (!row) await new Promise((resolve) => setTimeout(resolve, 700));
        }
        if (!row) return { ...base, summary: `Abrí la vista de ${device.name}, pero todavía no llega imagen (la cámara puede estar arrancando).` };
        const seen = describeMeta(row.meta);
        return { ...base, seen, objects: (row.meta?.objects || []).map((o) => ({ label: o.label, count: o.count })), summary: `${device.name} ve: ${seen}` };
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};

// How long to wait for the first picture after the device says it is sharing.
const FIRST_FRAME_MS = 8000;

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
