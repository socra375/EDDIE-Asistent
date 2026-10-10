// The user's own computer, reachable from anywhere (web, phone, Telegram)
// through EDDIE Prime: the agent eddie_agent.py running on it.
// One brain: Eddie decides and words the answer; the agent only runs the
// whitelisted tools it declared when it linked (disk, memory, processes,
// opening an allowed app…). Anything that changes the computer goes through
// the confirmation card. See api/_lib/computer/ and docs/eddie-prime-agente.md.
import { devicesByUser, grantApp, hasDevice, isAppGranted } from '../../computer/store.js';
import { PLATFORM_LABELS, describeDevice, plain, resolveTool, runOnComputer, runOnDevice } from '../../computer/run.js';
import { clip } from '../http.js';

// The arguments most tools use, by name (small models fill these far more
// reliably than a nested object), plus args_json for anything else.
const COMMON_ARGS = {
  device: { type: 'STRING', description: 'Nombre del equipo (o "windows", "chromebook"…). Solo hace falta si el usuario tiene varios equipos vinculados; sin él, con varios, te dirá cuáles hay.' },
  path: { type: 'STRING', description: 'Ruta, relativa a la carpeta personal (ej. "Descargas") o absoluta dentro de ella.' },
  name: { type: 'STRING', description: 'Nombre (de una app, un archivo…), según la herramienta.' },
  pid: { type: 'INTEGER', description: 'Id de un proceso (de top_processes).' },
  sort: { type: 'STRING', description: 'Orden: "cpu" o "memory".' },
  limit: { type: 'INTEGER', description: 'Cuántos resultados (máx. 20).' },
  args_json: { type: 'STRING', description: 'Otros argumentos como objeto JSON, solo si la herramienta los pide.' },
};

const deviceUser = async (context) => context.getUser?.();

// Normalized app name, as granted/checked (same per-device, whatever casing
// or accents the user typed): "Spotify" and "spotify" are the same grant.
const appKey = (resolved) => plain(resolved.args?.name);
const appGranted = (resolved) => {
  const key = appKey(resolved);
  return key ? isAppGranted(resolved.device.id, key) : false;
};

function summarizeResult(result) {
  const r = result?.result;
  if (r && typeof r === 'object' && typeof r.summary === 'string') return r.summary;
  return result?.tool ? `${result.tool.label} en ${result.device}` : '';
}

// What the model reads back: which computer, which tool, and the data.
function forModel(outcome) {
  if (outcome.error) return { error: outcome.error };
  return { device: outcome.device, tool: outcome.tool.name, result: outcome.result };
}

export default {
  id: 'computer',
  name: 'Tu equipo (EDDIE Prime)',
  description:
    'Eddie consulta y maneja tu Chromebook o PC desde cualquier lugar —la web, el teléfono, Telegram— a través del agente EDDIE Prime: disco, memoria, procesador, batería, procesos, archivos de tu carpeta y abrir cualquier app instalada (pide tu confirmación la primera vez; luego la recuerda).',
  icon: 'monitor',
  category: 'asistente',
  route:
    /\b(disco|almacenamiento|espacio|memoria ram|\bram\b|cpu|procesador|bater[ií]a|procesos?|uptime|encendid[oa]|equipo|computador[a]?|ordenador|chromebook|\bpc\b|laptop|port[aá]til|linux|crostini|carpeta|archivos?|descargas|abre|abrir|cierra|cerrar|mata|terminal|\bip\b|red|internet|wi-?fi|sistema)\b/i,
  auth: {
    type: 'computer-link',
    isConnected: (user) => hasDevice(user.id),
  },
  requiredEnv: ['DATABASE_URL'],
  note: 'El agente nunca abre puertos: espera un aviso sin datos (ntfy) y viene a buscar el trabajo con su propio token. Solo ejecuta su lista de herramientas; nada de comandos libres. Lo que cambia algo pide tu confirmación: abrir una app solo la primera vez (luego se recuerda, por app y por equipo); cerrar un proceso, siempre.',
  details: async (user) => {
    const devices = user ? await devicesByUser(user.id) : [];
    if (!devices.length) return null;
    return {
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        version: d.version,
        lastSeen: d.lastSeen,
        tools: d.tools.map((t) => ({ name: t.name, label: t.label, risk: t.risk })),
      })),
    };
  },
  tools: [
    {
      label: 'Ver tus equipos vinculados',
      activity: 'Mirando tus equipos…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
      declaration: {
        name: 'computer_list',
        description: 'Lista los equipos (PC, Chromebook…) que el usuario vinculó con el agente EDDIE Prime: nombre, sistema y qué puede hacer cada uno. Úsala si no sabes cuál es el equipo al que se refiere, y pásale su nombre en el argumento device de computer_check / computer_action.',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: async (_args, context) => {
        const user = await deviceUser(context);
        if (!user) return { error: 'Para usar tu equipo a distancia, inicia sesión con tu cuenta de Google.' };
        const devices = await devicesByUser(user.id);
        if (!devices.length) return { error: 'No hay ningún equipo vinculado. En Conectores → «Tu equipo (EDDIE Prime)» se vincula con el agente eddie_agent.py (en Windows, con el instalador).' };
        return {
          devices: devices.map((d) => ({ name: d.name, system: PLATFORM_LABELS[d.platform] || null, lastContact: d.lastSeen, canDo: d.tools.map((t) => `${t.name}${t.risk === 'confirm' ? ' (con confirmación)' : ''}`) })),
          summary: `${devices.length} equipo${devices.length === 1 ? '' : 's'}: ${devices.map(describeDevice).join(', ')}`,
        };
      },
    },
    {
      label: 'Consultar tu equipo',
      activity: 'Consultando tu equipo…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(summarizeResult(result), 120)),
      declaration: {
        name: 'computer_check',
        description:
          'Consulta un equipo del usuario (su PC con Windows, Chromebook… con el agente EDDIE Prime), aunque hable desde el teléfono, Telegram. Con varios equipos vinculados, indica cuál en device (nombre; computer_list los muestra). Herramientas habituales de solo lectura: system_summary (resumen general), disk_usage {path}, memory_usage, cpu_usage, battery_status, top_processes {sort, limit}, network_info, uptime, list_directory {path}, scan_network (qué dispositivos hay en la red de ese equipo: IP, MAC y nombre que anuncia cada uno). Si una no existe, el error trae la lista real. Responde con los datos, sin inventar.',
        parameters: {
          type: 'OBJECT',
          properties: { tool: { type: 'STRING', description: 'Nombre de la herramienta del equipo, ej. "disk_usage".' }, ...COMMON_ARGS },
          required: ['tool'],
        },
      },
      run: async (args, context) => {
        const outcome = await runOnComputer(await deviceUser(context), args.tool, args, { risk: 'read' });
        return { ...forModel(outcome), ...(outcome.error ? {} : { summary: summarizeResult(outcome) }) };
      },
    },
    {
      label: 'Hacer algo en tu equipo',
      activity: 'Pidiéndole a tu equipo que lo haga…',
      sensitive: true,
      declaration: {
        name: 'computer_action',
        description:
          'Pide a un equipo del usuario una acción que cambia algo (con varios equipos vinculados, indica cuál en device). Habituales: open_app {name} (busca y abre cualquier app instalada por su nombre; pide confirmación la primera vez que se abre esa app en ese equipo, luego ya no vuelve a pedirla), kill_process {pid} (cierra un proceso suyo; primero usa top_processes para el pid; pide confirmación siempre). Si una no existe, el error trae la lista real.',
        parameters: {
          type: 'OBJECT',
          properties: { tool: { type: 'STRING', description: 'Nombre de la acción del equipo, ej. "open_app".' }, ...COMMON_ARGS },
          required: ['tool'],
        },
      },
      // Checks the computer and the action before the card is shown, so the
      // user confirms exactly what will run. open_app is the one exception:
      // once the user has approved opening a given app on a given computer,
      // appGranted() below finds it already recorded and skipConfirmation
      // tells runTool (registry.js) to run it straight away, same as any
      // other time they already said yes — every other action (kill_process…)
      // still asks every time.
      prepare: async (args, context) => {
        const resolved = await resolveTool(await deviceUser(context), args.tool, args, { risk: 'confirm' });
        if (resolved.error) return { error: resolved.error };
        if (resolved.tool.name === 'open_app' && (await appGranted(resolved))) return { skipConfirmation: true };
        const fields = [
          { key: 'device', label: 'Equipo', value: resolved.device.name },
          { key: 'tool', label: 'Acción', value: resolved.tool.label },
          ...Object.entries(resolved.args).map(([key, value]) => ({ key, label: key, value: String(value) })),
        ];
        if (resolved.tool.name === 'open_app') fields.push({ key: 'nota', label: 'Nota', value: 'La próxima vez se abrirá sin pedir confirmación.' });
        return {
          args: { tool: resolved.tool.name, ...(Object.keys(resolved.args).length ? { args_json: JSON.stringify(resolved.args) } : {}) },
          preview: { title: `${resolved.tool.label} en ${resolved.device.name}`, confirmLabel: 'Hacerlo', fields },
        };
      },
      run: async (args, context) => {
        const resolved = await resolveTool(await deviceUser(context), args.tool, args, { risk: 'confirm' });
        if (resolved.error) return { error: resolved.error };
        const outcome = await runOnDevice(resolved.device, resolved.tool, resolved.args);
        if (!outcome.error && resolved.tool.name === 'open_app') {
          const key = appKey(resolved);
          if (key) await grantApp(resolved.device.id, key);
        }
        const full = { ...outcome, device: resolved.device.name, tool: resolved.tool };
        return { ...forModel(full), ...(outcome.error ? {} : { summary: summarizeResult(full) }) };
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};
