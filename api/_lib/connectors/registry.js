// The list of connectors and the only door between the AI and their tools.
// Each connector lives in its own folder and follows the contract in
// docs/eddie-2-arquitectura.md; adding one means importing it here.
import clock from './clock/index.js';
import weather from './weather/index.js';
import google from './google/index.js';
import websearch from './websearch/index.js';
import news from './news/index.js';
import wikipedia from './wikipedia/index.js';
import currency from './currency/index.js';
import tasks from './tasks/index.js';
import { PLANNED_CONNECTORS } from './planned.js';
import { validateArgs } from './validate.js';

export const CONNECTORS = [clock, weather, tasks, websearch, news, wikipedia, currency, google];

function missingEnv(connector, env) {
  return (connector.requiredEnv || []).filter((name) => !env[name]);
}

// Tools the AI may call in this request: connectors configured on the
// server that the user hasn't switched off in the hub.
function activeTools({ disabled = [], env = process.env } = {}) {
  const off = new Set(disabled);
  return CONNECTORS.filter((c) => !off.has(c.id) && missingEnv(c, env).length === 0).flatMap((c) => c.tools);
}

// Never lets a tool crash the chat request: an unknown or switched-off tool,
// invalid arguments, or an exception inside the tool all become an { error }
// result fed back to the model instead of aborting the answer.
async function runTool(tools, name, args, context) {
  const tool = tools.find((t) => t.declaration.name === name);
  if (!tool) return { error: `Herramienta desconocida o desactivada: ${name}` };

  const validationError = validateArgs(tool.declaration, args);
  if (validationError) return { error: validationError };

  // Actions like sending or deleting need the user's explicit OK, and the
  // confirmation step in the chat arrives in session 8 — until then a
  // sensitive tool never runs.
  if (tool.sensitive) {
    return { error: `La acción "${tool.label}" necesita tu confirmación, y confirmar desde el chat todavía no está disponible.` };
  }

  try {
    return await tool.run(args || {}, context);
  } catch (err) {
    return { error: `La herramienta "${name}" falló inesperadamente: ${err?.message || 'error desconocido'}.` };
  }
}

// What one chat request can use: the declarations to offer the model and a
// function to run whichever one it picks. `context` carries the user's time
// zone, location and task list for tools that need them. Tools that change
// something in the app (a new task) call context.emit(action); those actions
// collect in `actions` and reach the browser with the finished answer.
export function createToolset({ disabled = [], context = {}, env = process.env } = {}) {
  const tools = activeTools({ disabled, env });
  const actions = [];
  const toolContext = { ...context, emit: (action) => actions.push(action) };
  return {
    declarations: tools.map((t) => t.declaration),
    execute: (name, args) => runTool(tools, name, args, toolContext),
    actions,
  };
}

async function isConnected(connector, user) {
  if (!user || !connector.auth?.isConnected) return false;
  try {
    return await connector.auth.isConnected(user);
  } catch {
    return false;
  }
}

// Public view for the hub (GET /api/connectors): no secrets, only names of
// missing environment variables. Status is one of:
//   ready         configured and needs no account
//   connected     the user's account is linked
//   needs_account configured, but the user still has to connect
//   needs_setup   missing environment variables on the server
//   planned       arrives in a later session
// Whether the user switched a connector off lives in their settings, not here.
export async function describeConnectors({ user = null, env = process.env } = {}) {
  const built = await Promise.all(
    CONNECTORS.map(async (c) => {
      const missing = missingEnv(c, env);
      let status = 'ready';
      if (missing.length) status = 'needs_setup';
      else if (c.auth) status = (await isConnected(c, user)) ? 'connected' : 'needs_account';
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        auth: c.auth?.type || null,
        status,
        missingEnv: missing,
        note: (typeof c.note === 'function' ? c.note(env) : c.note) || null,
        tools: c.tools.map((t) => ({ name: t.declaration.name, label: t.label, sensitive: Boolean(t.sensitive) })),
      };
    }),
  );
  const planned = PLANNED_CONNECTORS.map((p) => ({ ...p, auth: null, status: 'planned', missingEnv: [], note: null, tools: [] }));
  return [...built, ...planned];
}
