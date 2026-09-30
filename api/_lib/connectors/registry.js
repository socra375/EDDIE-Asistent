// The list of connectors and the only door between the AI and their tools.
// Each connector lives in its own folder and follows the contract in
// docs/eddie-2-arquitectura.md; adding one means importing it here.
import clock from './clock/index.js';
import weather from './weather/index.js';
import google from './google/index.js';
import gmail from './gmail/index.js';
import websearch from './websearch/index.js';
import news from './news/index.js';
import wikipedia from './wikipedia/index.js';
import currency from './currency/index.js';
import tasks from './tasks/index.js';
import { PLANNED_CONNECTORS } from './planned.js';
import { randomUUID } from 'node:crypto';
import { validateArgs } from './validate.js';

export const CONNECTORS = [clock, weather, tasks, websearch, news, wikipedia, currency, gmail, google];

function missingEnv(connector, env) {
  return (connector.requiredEnv || []).filter((name) => !env[name]);
}

// Tools the AI may call in this request: connectors configured on the
// server that the user hasn't switched off in the hub.
function activeTools({ disabled = [], env = process.env } = {}) {
  const off = new Set(disabled);
  return CONNECTORS.filter((c) => !off.has(c.id) && missingEnv(c, env).length === 0).flatMap((c) => c.tools);
}

const MAX_CONFIRMATIONS = 3;

function toolError(name, err) {
  return { error: `La herramienta "${name}" falló inesperadamente: ${err?.message || 'error desconocido'}.` };
}

// A sensitive tool (sending, deleting…) never runs straight from the model.
// Its optional prepare(args, ctx) checks and completes the request (e.g.
// finds the exact task) and describes it for the confirmation card; without
// one, the arguments are shown as they are.
async function prepareSensitive(tool, args, context) {
  if (!tool.prepare) {
    return {
      args,
      preview: {
        title: tool.label,
        confirmLabel: 'Confirmar',
        fields: Object.entries(args || {}).map(([key, value]) => ({ key, label: key, value: String(value) })),
      },
    };
  }
  return tool.prepare(args || {}, context);
}

// Never lets a tool crash the chat request: an unknown or switched-off tool,
// invalid arguments, or an exception inside the tool all become an { error }
// result fed back to the model instead of aborting the answer.
async function runTool(tools, name, args, context, hooks) {
  const tool = tools.find((t) => t.declaration.name === name);
  if (!tool) return { error: `Herramienta desconocida o desactivada: ${name}` };

  const validationError = validateArgs(tool.declaration, args);
  if (validationError) return { error: validationError };

  hooks.onActivity?.({ tool: name, label: tool.activity || `${tool.label}…` });

  // Actions like sending or deleting need the user's explicit OK: instead of
  // running, the request becomes a confirmation card in the chat (see
  // confirmTool), and the model is told to ask rather than claim it's done.
  if (tool.sensitive) {
    if (hooks.confirmations.length >= MAX_CONFIRMATIONS) {
      return { error: 'Ya hay varias acciones esperando confirmación; pide al usuario que las resuelva primero.' };
    }
    let prepared;
    try {
      prepared = await prepareSensitive(tool, args, context);
    } catch (err) {
      return toolError(name, err);
    }
    if (prepared?.error) return { error: prepared.error };
    hooks.confirmations.push({ id: randomUUID(), tool: name, label: tool.label, args: prepared.args, preview: prepared.preview });
    return {
      status: 'awaiting_confirmation',
      instruction:
        'No se ha hecho todavía. El usuario ve una tarjeta para confirmar, editar o cancelar esta acción. Dile en una frase qué vas a hacer y que confirme; nunca digas que ya está hecho.',
    };
  }

  try {
    return await tool.run(args || {}, context);
  } catch (err) {
    return toolError(name, err);
  }
}

// What one chat request can use: the declarations to offer the model and a
// function to run whichever one it picks. `context` carries the user's time
// zone, location and task list for tools that need them. Tools that change
// something in the app (a new task) call context.emit(action); those actions
// collect in `actions`, and sensitive requests in `confirmations`, and both
// reach the browser with the finished answer. `onActivity` hears each tool
// as it starts, for the "Buscando en internet…" line in the app.
export function createToolset({ disabled = [], context = {}, env = process.env, onActivity } = {}) {
  const tools = activeTools({ disabled, env });
  const actions = [];
  const confirmations = [];
  const toolContext = { ...context, emit: (action) => actions.push(action) };
  return {
    declarations: tools.map((t) => t.declaration),
    execute: (name, args) => runTool(tools, name, args, toolContext, { onActivity, confirmations }),
    actions,
    confirmations,
    // A failed attempt's side effects don't carry over to the fallback.
    reset() {
      actions.length = 0;
      confirmations.length = 0;
    },
  };
}

// Runs a sensitive tool the user just confirmed in the chat (POST
// /api/chat?action=confirm). The model isn't involved: the arguments are
// the ones on the card, possibly edited by the user, so they are validated
// and prepared again, and the connector must still be on and configured.
export async function confirmTool({ name, args, disabled = [], context = {}, env = process.env }) {
  const tool = activeTools({ disabled, env }).find((t) => t.declaration.name === name);
  if (!tool) return { error: 'Esa acción ya no está disponible (el conector está apagado o sin configurar).' };
  if (!tool.sensitive) return { error: 'Esa acción no necesita confirmación.' };
  const validationError = validateArgs(tool.declaration, args);
  if (validationError) return { error: validationError };
  const actions = [];
  const toolContext = { ...context, emit: (action) => actions.push(action) };
  try {
    const prepared = await prepareSensitive(tool, args, toolContext);
    if (prepared?.error) return { error: prepared.error };
    const result = await tool.run(prepared.args, toolContext);
    if (result?.error) return { error: result.error };
    return { result, actions };
  } catch (err) {
    return toolError(name, err);
  }
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
        connectScope: c.auth?.scope || null,
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
