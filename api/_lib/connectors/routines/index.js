// Rutinas automáticas: varias acciones (de una lista fija y segura — ver
// api/_lib/routines/actions.js) que corren solas, por hora del día o por un
// evento en un equipo vinculado con EDDIE Prime. El aviso llega por Telegram
// o notificación push, sin que la app esté abierta. Disparo y ejecución:
// api/_lib/routines/run.js (llamado desde el mismo cron que los recordatorios).
import { devicesByUser } from '../../computer/store.js';
import { pickDevice } from '../../computer/run.js';
import { createRoutine, deleteRoutineByName, listRoutines } from '../../routines/store.js';
import { ACTION_TYPES, DEFAULT_SONG, describeActions, validateActions } from '../../routines/actions.js';
import { clip } from '../http.js';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVENT_TYPES = ['download_complete', 'device_boot'];
// The first agent that also notices a start-up after being switched off (Windows' fast startup keeps the boot time) — public/eddie_agent.py.
const BOOT_AGENT = [1, 8, 1];
const versionAtLeast = (version, min) => {
  const parts = String(version || '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((parts[i] || 0) !== min[i]) return (parts[i] || 0) > min[i];
  return true;
};

function normalizeTime(value) {
  const m = TIME_RE.exec(String(value || '').trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}

function parseActions(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: `actions debe ser un arreglo JSON, p. ej. [{"type":"notify","text":"..."}]. Tipos posibles: ${ACTION_TYPES.join(', ')}.` };
  }
  return validateActions(parsed);
}

async function createRoutineTool(args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'Para crear una rutina, inicia sesión con tu cuenta de Google.' };

  const time = args.time ? normalizeTime(args.time) : null;
  if (args.time && !time) return { error: 'La hora debe ser HH:MM (ej. "08:00").' };
  const event = args.event ? String(args.event) : null;
  if (event && !EVENT_TYPES.includes(event)) return { error: `event debe ser uno de: ${EVENT_TYPES.join(', ')}.` };
  if (!time && !event) return { error: 'Dame la hora (time) para una rutina diaria, o el evento (event) para una por evento.' };
  if (time && event) return { error: 'Una rutina es por hora O por evento, no las dos cosas.' };

  const { actions, error: actionsError } = await parseActions(args.actions);
  if (actionsError) return { error: actionsError };
  if (event !== 'device_boot' && actions.some((a) => a.type === 'say')) return { error: 'La acción "say" (decir en voz alta) solo se usa en rutinas de event="device_boot", porque la dice el propio PC.' };

  let deviceId = null;
  let deviceName = '';
  if (event) {
    const devices = await devicesByUser(user.id);
    const picked = pickDevice(devices, args.device);
    if (picked.error) return { error: picked.error };
    const updateHint = 'Descarga el instalador de nuevo en Conectores → Tu equipo (EDDIE Prime) y ejecútalo para actualizarlo.';
    if (event === 'device_boot') {
      if (!versionAtLeast(picked.device.version, BOOT_AGENT)) return { error: `El agente de «${picked.device.name}» es de una versión vieja (${picked.device.version || 'desconocida'}) y no avisa cuando el PC se enciende. ${updateHint}` };
    } else if (!picked.device.tools.some((t) => t.name === 'check_downloads' && t.risk === 'read')) {
      return { error: `El agente de «${picked.device.name}» es muy viejo para vigilar descargas. ${updateHint}` };
    }
    deviceId = picked.device.id;
    deviceName = picked.device.name;
  }

  const name = clip(String(args.name || '').trim(), 80) || (time ? `Rutina de las ${time}` : event === 'device_boot' ? 'Al encender el PC' : 'Aviso de descarga');
  const routine = await createRoutine(user.id, { name, triggerType: time ? 'schedule' : 'event', time, eventType: event, deviceId, actions });
  return {
    routine,
    summary: time
      ? `Rutina «${name}» creada: todos los días a las ${time}, ${describeActions(actions)}.`
      : event === 'device_boot'
        ? `Rutina «${name}» creada: cuando se encienda «${deviceName}», ${describeActions(actions)}. Se dispara con el inicio de sesión del PC; despertarlo de la suspensión no cuenta.`
        : `Rutina «${name}» creada: cuando termine una descarga, ${describeActions(actions)}.`,
  };
}

async function listRoutinesTool(_args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'Para ver tus rutinas, inicia sesión con tu cuenta de Google.' };
  const routines = await listRoutines(user.id);
  if (!routines.length) return { routines: [], summary: 'No tienes ninguna rutina creada.' };
  const described = routines.map((r) => ({
    name: r.name,
    cuando: r.triggerType === 'schedule' ? `todos los días a las ${r.time}` : r.eventType === 'device_boot' ? 'cuando se encienda el PC' : 'cuando termine una descarga',
    hace: describeActions(r.actions),
    activa: r.enabled,
  }));
  return { routines: described, summary: `${routines.length} rutina${routines.length === 1 ? '' : 's'}: ${described.map((r) => `«${r.name}» (${r.cuando})`).join('; ')}.` };
}

async function cancelRoutineTool(args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'Para cancelar una rutina, inicia sesión con tu cuenta de Google.' };
  const name = String(args.name || '').trim();
  if (!name) return { error: 'Dime el nombre de la rutina a cancelar.' };
  const result = await deleteRoutineByName(user.id, name);
  if (result.count === 0) return { error: result.names.length ? `No encuentro una rutina llamada «${name}». Las que tienes: ${result.names.join(', ')}.` : 'No tienes ninguna rutina creada.' };
  if (result.count > 1) return { error: `«${name}» puede ser más de una rutina. Usa el nombre completo.` };
  return { cancelled: result.name, summary: `Cancelé la rutina «${result.name}».` };
}

export default {
  id: 'routines',
  name: 'Rutinas automáticas',
  description: `Rutinas que corren solas, por hora del día ("a las 8, dame el resumen") o cuando termina una descarga en un equipo vinculado con EDDIE Prime ("avísame cuando termine"). El aviso llega por Telegram o notificación push aunque la app esté cerrada. Acciones posibles: resumen del día, poner música (YouTube en tu navegador, por defecto "${DEFAULT_SONG}"), un aviso de texto una tarea que Eddie hace solo con sus herramientas (agent), abrir páginas web (open_sites) o, al encender el PC, decir algo en voz alta (say). También cuando se enciende un PC vinculado con EDDIE Prime («cuando encienda la PC, abre YouTube y WhatsApp Web»). Varias rutinas a la misma hora corren a la vez.`,
  icon: 'clock',
  category: 'asistente',
  route: /rutina|autom[aá]tic[oa]|cada d[ií]a a las|todos los d[ií]as a las|cuando termine|cuando acabe|cuando (encienda|prenda|arranque|inicie)|al (encender|prender|arrancar|iniciar)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Las rutinas solo pueden hacer lo de esta lista (resumen, música, un aviso de texto o una tarea de Eddie): nada sensible se ejecuta, porque nadie confirma una tarjeta cuando corren solas; lo que necesite permiso se te avisa como pendiente.',
  tools: [
    {
      label: 'Crear una rutina',
      activity: 'Creando la rutina…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'create_routine',
        description:
          `Crea una rutina automática. Por hora: pon time ("08:00"). Por evento: pon event ("download_complete" cuando termine una descarga, o "device_boot" cuando se encienda el PC; ambos necesitan un equipo de EDDIE Prime vinculado; con varios, indica cuál en device) — usa SOLO una de las dos. actions es un arreglo JSON de pasos, cada uno {"type": uno de [${ACTION_TYPES.join(', ')}], ...}: summary (el resumen del día, sin más datos), play_music (opcional query, si no se da usa "${DEFAULT_SONG}"), notify (necesita text, el aviso a mandar), open_sites (necesita urls: arreglo de direcciones https completas, p. ej. YouTube https://www.youtube.com, Google https://www.google.com, WhatsApp Web https://web.whatsapp.com; solo las ABRE, nunca escribe ni envía nada en ellas), say (solo con device_boot; necesita text: lo que dice el PC en voz alta con la voz del sistema), agent (necesita prompt: una tarea que TÚ harás sola con tus herramientas cuando llegue la hora, p. ej. «revisa el clima y dime si llevo paraguas»; el resultado le llega como aviso; sin permiso para nada delicado, y si el usuario no la pidió a una hora concreta usa un recordatorio en su lugar). Ej.: time="08:00", actions=[{"type":"summary"},{"type":"play_music"}]. Ej.: event="device_boot", actions=[{"type":"open_sites","urls":["https://www.youtube.com","https://www.google.com","https://web.whatsapp.com"]}]. Ej.: event="download_complete", actions=[{"type":"notify","text":"Tu descarga terminó."}].`,
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nombre corto de la rutina (opcional; si no se da, se genera uno).' },
            time: { type: 'STRING', description: 'Hora local HH:MM para una rutina diaria.' },
            event: { type: 'STRING', enum: EVENT_TYPES, description: 'Evento que dispara la rutina.' },
            device: { type: 'STRING', description: 'Equipo a vigilar (solo con event, si hay varios vinculados).' },
            actions: { type: 'STRING', description: 'Arreglo JSON de acciones, como texto. Ej.: [{"type":"summary"}]' },
          },
          required: ['actions'],
        },
      },
      run: (args, context) => createRoutineTool(args, context),
    },
    {
      label: 'Ver tus rutinas',
      activity: 'Mirando tus rutinas…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'list_routines',
        description: 'Lista las rutinas automáticas que el usuario creó: cuándo corren y qué hacen.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: (_args, context) => listRoutinesTool(_args, context),
    },
    {
      label: 'Cancelar una rutina',
      activity: 'Cancelando la rutina…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result?.summary),
      declaration: {
        name: 'cancel_routine',
        description: 'Borra una rutina automática por su nombre (list_routines los muestra).',
        parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'Nombre (o parte del nombre) de la rutina.' } }, required: ['name'] },
      },
      run: (args, context) => cancelRoutineTool(args, context),
    },
  ],
  webhook: null,
};
