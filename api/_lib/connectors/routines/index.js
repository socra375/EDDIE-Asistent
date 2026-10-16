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
import { describeDays, encodeDays, parseDays } from '../../../../src/services/weekdays.js';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const EVENT_TYPES = ['download_complete', 'device_boot'];
// The first agent that also notices a start-up after being switched off (Windows' fast startup keeps the boot time) — public/eddie_agent.py.
const BOOT_AGENT = [1, 8, 1];
// The first agent that can say the good-morning itself (action «morning»).
const MORNING_AGENT = [1, 11, 0];
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

  // «De lunes a viernes», «solo los fines de semana», «lunes y jueves»: absent or «todos los días» = every day.
  let days = null;
  if (args.days != null && String(args.days).trim()) {
    // «cada lunes», «solo los martes», «todos los jueves» → «lunes», «martes», «jueves» (a day or a group, not «todos los días»).
    const said = String(args.days).trim().replace(/^(?:(?:cada|solo|solamente|únicamente|todos|los|las|de)\s+)+(?=(?:lun|mar|mi[eé]|jue|vie|s[aá]b|dom|fin|find|entre|laborables|h[aá]biles))/i, '');
    const parsed = parseDays(said);
    if (!parsed) return { error: `No entendí los días «${clip(String(args.days), 60)}». Dilos así: «lunes a viernes», «fines de semana», «lunes, miércoles y viernes» o «todos los días».` };
    days = parsed;
  }

  const { actions, error: actionsError } = await parseActions(args.actions);
  if (actionsError) return { error: actionsError };
  if (event !== 'device_boot' && actions.some((a) => a.type === 'say' || a.type === 'morning')) return { error: 'Las acciones "say" y "morning" (hablar en voz alta) solo se usan en rutinas de event="device_boot", porque las dice el propio PC.' };

  let deviceId = null;
  let deviceName = '';
  let note = '';
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
    if (event === 'device_boot' && actions.some((a) => a.type === 'morning') && !versionAtLeast(picked.device.version, MORNING_AGENT)) {
      note = ` Ojo: el agente de «${deviceName}» es de la versión ${picked.device.version || 'desconocida'} y todavía no puede hablar: por ahora el resumen te llegará escrito. ${updateHint}`;
    }
  }

  const name = clip(String(args.name || '').trim(), 80) || (time ? `Rutina de las ${time}` : event === 'device_boot' ? 'Al encender el PC' : 'Aviso de descarga');
  const routine = await createRoutine(user.id, { name, triggerType: time ? 'schedule' : 'event', time, days, eventType: event, deviceId, actions });
  const when = encodeDays(days) ? ` ${describeDays(days)}` : '';
  return {
    routine,
    summary: time
      ? `Rutina «${name}» creada: ${encodeDays(days) ? describeDays(days) : 'todos los días'} a las ${time}, ${describeActions(actions)}.`
      : event === 'device_boot'
        ? `Rutina «${name}» creada: cuando se encienda «${deviceName}»${when}, ${describeActions(actions)}. Se dispara con el inicio de sesión del PC; despertarlo de la suspensión no cuenta.${note}`
        : `Rutina «${name}» creada: cuando termine una descarga${when}, ${describeActions(actions)}.`,
  };
}

async function listRoutinesTool(_args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'Para ver tus rutinas, inicia sesión con tu cuenta de Google.' };
  const routines = await listRoutines(user.id);
  if (!routines.length) return { routines: [], summary: 'No tienes ninguna rutina creada.' };
  const described = routines.map((r) => ({
    name: r.name,
    cuando:
      r.triggerType === 'schedule'
        ? `${describeDays(r.days)} a las ${r.time}`
        : `${r.eventType === 'device_boot' ? 'cuando se encienda el PC' : 'cuando termine una descarga'}${r.days ? `, ${describeDays(r.days)}` : ''}`,
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
  description: `Rutinas que corren solas, por hora del día ("a las 8, dame el resumen"), todos los días o solo en ciertos días ("de lunes a viernes", "los fines de semana", "los lunes y jueves"), o cuando termina una descarga en un equipo vinculado con EDDIE Prime ("avísame cuando termine"). El aviso llega por Telegram o notificación push aunque la app esté cerrada. Acciones posibles: resumen del día, poner música (YouTube en tu navegador, por defecto "${DEFAULT_SONG}"), un aviso de texto una tarea que Eddie hace solo con sus herramientas (agent), abrir páginas web (open_sites) o, al encender el PC, decir algo en voz alta (say). También cuando se enciende un PC vinculado con EDDIE Prime («cuando encienda la PC, abre YouTube y WhatsApp Web»). Varias rutinas a la misma hora corren a la vez.`,
  icon: 'clock',
  category: 'asistente',
  route: /rutina|autom[aá]tic[oa]|cada d[ií]a|todos los d[ií]as|entre semana|fines? de semana|lunes a viernes|d[ií]as (h[aá]biles|laborables)|solo los (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados|domingos)|excepto|menos los|cada (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|semana|ma[nñ]ana|noche)|todas las (ma[nñ]anas|noches)|cada \d+ horas|cuando termine|cuando acabe|cuando (encienda|prenda|arranque|inicie)|al (encender|prender|arrancar|iniciar)/i,
  guide: `RUTINAS — cómo y cuándo:
1. Crea una rutina solo cuando el usuario la pida o acepte tu oferta, y confirma con él la hora y qué debe pasar antes de crearla.
2. Una tarea para ti (acción agent) corre sin nadie delante: no puede preguntar ni confirmar, y lo delicado (enviar, borrar, mover) no se hace. Escríbela completa y con contexto, como para alguien que no puede preguntar.
3. «Cuando encienda la PC» y «cuando termine la descarga» necesitan un equipo con EDDIE Prime; si hay varios, pregunta cuál.
4. Una rutina corre a una hora, todos los días o solo en ciertos días (parámetro days: «lunes a viernes», «fines de semana», «lunes, miércoles y viernes»; «cada lunes» es days="lunes"), o por evento. «Durante la semana pero no los fines de semana» = days="lunes a viernes". Si no dicen días, son todos; si dudas, pregúntalo. No hay «cada 2 horas» ni «el día 1 de cada mes»: dilo y ofrece lo más cercano (la diaria, o la de ciertos días).
5. Al terminar, di en una frase qué hará y a qué hora. Para quitar una, cancel_routine.
6. «Cuando encienda la PC, salúdame y dime qué hay hoy» = event="device_boot" con la acción morning (él la dice en voz alta con la voz del sistema; no hace falta que escribas el texto). Dile al usuario lo que hará: saluda, lee agenda, correos y tareas de hoy, abre Gmail y el calendario mientras habla y los cierra al terminar (solo si tiene la extensión de Eddie) y cuenta cómo está el equipo. Si su agente es viejo, el resumen le llega escrito y debe actualizar el agente. Optimizar el PC (cerrar apps, borrar archivos) NO lo hace esta rutina: solo mira y recomienda.`,
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
          `Crea una rutina automática. Por hora: pon time ("08:00") y, si no es todos los días, days ("lunes a viernes"). Por evento: pon event ("download_complete" cuando termine una descarga, o "device_boot" cuando se encienda el PC; ambos necesitan un equipo de EDDIE Prime vinculado; con varios, indica cuál en device) — usa SOLO una de las dos. actions es un arreglo JSON de pasos, cada uno {"type": uno de [${ACTION_TYPES.join(', ')}], ...}: summary (el resumen del día, sin más datos), play_music (opcional query, si no se da usa "${DEFAULT_SONG}"), notify (necesita text, el aviso a mandar), open_sites (necesita urls: arreglo de direcciones https completas, p. ej. YouTube https://www.youtube.com, Google https://www.google.com, WhatsApp Web https://web.whatsapp.com; solo las ABRE, nunca escribe ni envía nada en ellas), say (solo con device_boot; necesita text: lo que dice el PC en voz alta con la voz del sistema), morning (solo con device_boot; el PC saluda en voz alta y cuenta la agenda, los correos importantes y las tareas de HOY con datos reales; mientras habla abre Gmail y el calendario en el navegador y los cierra al terminar; al final cuenta cómo está el equipo, memoria, disco, batería; opcionales pages=false para no abrir páginas y checkup=false para no revisar el equipo; necesita el agente EDDIE Prime 1.11 o más nuevo, y las páginas solo se abren si el usuario tiene la extensión de Eddie en su navegador; NO cierra apps ni borra nada), agent (necesita prompt: una tarea que TÚ harás sola con tus herramientas cuando llegue la hora, p. ej. «revisa el clima y dime si llevo paraguas»; el resultado le llega como aviso; sin permiso para nada delicado, y si el usuario no la pidió a una hora concreta usa un recordatorio en su lugar). Ej.: time="08:00", actions=[{"type":"summary"},{"type":"play_music"}]. Ej.: event="device_boot", actions=[{"type":"morning"}] (saludo hablado completo al encender el PC). Ej.: event="device_boot", actions=[{"type":"open_sites","urls":["https://www.youtube.com","https://www.google.com","https://web.whatsapp.com"]}]. Ej.: event="download_complete", actions=[{"type":"notify","text":"Tu descarga terminó."}].`,
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nombre corto de la rutina (opcional; si no se da, se genera uno).' },
            time: { type: 'STRING', description: 'Hora local HH:MM para una rutina por hora.' },
            days: { type: 'STRING', description: 'En qué días corre, como lo diría el usuario: "lunes a viernes", "fines de semana", "lunes, miércoles y viernes", "todos los días". Si no se da, corre todos los días. También sirve con event (p. ej. al encender el PC solo entre semana).' },
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
