// The user's own computer, reachable from anywhere (web, phone, Telegram)
// through EDDIE Prime: the agent eddie_agent.py running on it.
// One brain: Eddie decides and words the answer; the agent only runs the
// whitelisted tools it declared when it linked (disk, memory, processes,
// opening an allowed app…). Anything that changes the computer goes through
// the confirmation card. See api/_lib/computer/ and docs/eddie-prime-agente.md.
import { deviceByUser, hasDevice } from '../../computer/store.js';
import { resolveTool, runOnComputer, runOnDevice } from '../../computer/run.js';
import { clip } from '../http.js';

// The arguments most tools use, by name (small models fill these far more
// reliably than a nested object), plus args_json for anything else.
const COMMON_ARGS = {
  path: { type: 'STRING', description: 'Ruta, relativa a la carpeta personal (ej. "Descargas") o absoluta dentro de ella.' },
  name: { type: 'STRING', description: 'Nombre (de una app, un archivo…), según la herramienta.' },
  pid: { type: 'INTEGER', description: 'Id de un proceso (de top_processes).' },
  sort: { type: 'STRING', description: 'Orden: "cpu" o "memory".' },
  limit: { type: 'INTEGER', description: 'Cuántos resultados (máx. 20).' },
  args_json: { type: 'STRING', description: 'Otros argumentos como objeto JSON, solo si la herramienta los pide.' },
};

const deviceUser = async (context) => context.getUser?.();

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
    'Eddie consulta y maneja tu Chromebook o PC desde cualquier lugar —la web, el teléfono, Telegram— a través del agente EDDIE Prime: disco, memoria, procesador, batería, procesos, archivos de tu carpeta y abrir las apps que permitas.',
  icon: 'monitor',
  category: 'asistente',
  route:
    /\b(disco|almacenamiento|espacio|memoria ram|\bram\b|cpu|procesador|bater[ií]a|procesos?|uptime|encendid[oa]|equipo|computador[a]?|ordenador|chromebook|\bpc\b|laptop|port[aá]til|linux|crostini|carpeta|archivos?|descargas|abre|abrir|cierra|cerrar|mata|terminal|\bip\b|red local|wi-?fi|sistema)\b/i,
  auth: {
    type: 'computer-link',
    isConnected: (user) => hasDevice(user.id),
  },
  requiredEnv: ['DATABASE_URL'],
  note: 'El agente nunca abre puertos: espera un aviso sin datos (ntfy) y viene a buscar el trabajo con su propio token. Solo ejecuta su lista de herramientas; nada de comandos libres. Lo que cambia algo (abrir una app, cerrar un proceso) siempre pide tu confirmación.',
  details: async (user) => {
    const device = user ? await deviceByUser(user.id) : null;
    if (!device) return null;
    return {
      device: {
        name: device.name,
        version: device.version,
        lastSeen: device.lastSeen,
        tools: device.tools.map((t) => ({ name: t.name, label: t.label, risk: t.risk })),
      },
    };
  },
  tools: [
    {
      label: 'Consultar tu equipo',
      activity: 'Consultando tu equipo…',
      risk: 'read',
      summarize: (result) => (result?.error ? undefined : clip(summarizeResult(result), 120)),
      declaration: {
        name: 'computer_check',
        description:
          'Consulta el equipo del usuario (su Chromebook/PC con el agente EDDIE Prime), aunque hable desde el teléfono, Telegram. Herramientas habituales de solo lectura: system_summary (resumen general), disk_usage {path}, memory_usage, cpu_usage, battery_status, top_processes {sort, limit}, network_info, uptime, list_directory {path}. Si una no existe, el error trae la lista real. Responde con los datos, sin inventar.',
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
          'Pide al equipo del usuario una acción que cambia algo, siempre con su confirmación en una tarjeta. Habituales: open_app {name} (solo las apps que el usuario permitió en el agente), kill_process {pid} (cierra un proceso suyo; primero usa top_processes para el pid). Si una no existe, el error trae la lista real.',
        parameters: {
          type: 'OBJECT',
          properties: { tool: { type: 'STRING', description: 'Nombre de la acción del equipo, ej. "open_app".' }, ...COMMON_ARGS },
          required: ['tool'],
        },
      },
      // Checks the computer and the action before the card is shown, so the
      // user confirms exactly what will run.
      prepare: async (args, context) => {
        const resolved = await resolveTool(await deviceUser(context), args.tool, args, { risk: 'confirm' });
        if (resolved.error) return { error: resolved.error };
        const fields = [
          { key: 'device', label: 'Equipo', value: resolved.device.name },
          { key: 'tool', label: 'Acción', value: resolved.tool.label },
          ...Object.entries(resolved.args).map(([key, value]) => ({ key, label: key, value: String(value) })),
        ];
        return {
          args: { tool: resolved.tool.name, ...(Object.keys(resolved.args).length ? { args_json: JSON.stringify(resolved.args) } : {}) },
          preview: { title: `${resolved.tool.label} en ${resolved.device.name}`, confirmLabel: 'Hacerlo', fields },
        };
      },
      run: async (args, context) => {
        const resolved = await resolveTool(await deviceUser(context), args.tool, args, { risk: 'confirm' });
        if (resolved.error) return { error: resolved.error };
        const outcome = await runOnDevice(resolved.device, resolved.tool, resolved.args);
        const full = { ...outcome, device: resolved.device.name, tool: resolved.tool };
        return { ...forModel(full), ...(outcome.error ? {} : { summary: summarizeResult(full) }) };
      },
      summarize: (result) => (result?.error ? undefined : clip(result?.summary || '', 120)),
    },
  ],
  webhook: null,
};
