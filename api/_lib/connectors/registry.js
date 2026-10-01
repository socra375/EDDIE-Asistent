// The list of connectors and the only door between the AI and their tools.
// Each connector lives in its own folder and follows the contract in
// docs/eddie-2-arquitectura.md; adding one means importing it here.
import clock from './clock/index.js';
import calculator from './calculator/index.js';
import weather from './weather/index.js';
import google from './google/index.js';
import gmail from './gmail/index.js';
import websearch from './websearch/index.js';
import news from './news/index.js';
import wikipedia from './wikipedia/index.js';
import currency from './currency/index.js';
import tasks from './tasks/index.js';
import memory from './memory/index.js';
import agent from './agent/index.js';
import github from './github/index.js';
import notion from './notion/index.js';
import telegram from './telegram/index.js';
import whatsapp from './whatsapp/index.js';
import probe from './probe/index.js';
import youtube from './youtube/index.js';
import reminders from './reminders/index.js';
import conversations from './conversations/index.js';
import { PLANNED_CONNECTORS } from './planned.js';
import { randomUUID } from 'node:crypto';
import { validateArgs } from './validate.js';
import { clip } from './http.js';

export const CONNECTORS = [agent, clock, calculator, weather, tasks, reminders, memory, conversations, websearch, news, wikipedia, currency, gmail, google, github, notion, youtube, telegram, whatsapp, probe];

function missingEnv(connector, env) {
  return (connector.requiredEnv || []).filter((name) => !env[name]);
}

// What the AI may do with a tool, for the hub and for reviewing a connector:
//   read     looks something up, changes nothing
//   write    changes something small and reversible in Eddie (a task)
//   confirm  sensitive: never runs without the user's OK on a card
export function toolRisk(tool) {
  return tool.sensitive ? 'confirm' : tool.risk || 'read';
}

// Intent routing. Offering every tool on every message costs tokens (Groq's
// free plan has 8K per minute) and gives a small model more ways to pick the
// wrong one, so a connector with a `route` regex is offered only when the
// conversation touches its topic; connectors without one (planner, clock,
// calculator, tasks, web search) are always on. When `intent` is omitted
// (the Hoy summary, tests) every active connector is offered.
const INTENT_MAX = 600;

export function intentFromMessages(messages = [], memory = []) {
  const text = (m) => (typeof m?.content === 'string' ? m.content : '');
  const users = messages.filter((m) => m?.role === 'user').slice(-2);
  const assistant = messages.filter((m) => m?.role === 'assistant').slice(-1);
  // The last answer counts too, so a bare "sí, mándalo" still points at email.
  const intent = [...assistant, ...users].map((m) => text(m).slice(0, INTENT_MAX)).join('\n');
  // A project saved in memory with a repo brings GitHub along when it is named
  // ("¿cómo va Gestor Empresarial?") even without the word "GitHub".
  const plain = normalizeIntent(intent);
  const names = (Array.isArray(memory) ? memory : [])
    .filter((m) => m?.c === 'projects' && / · repo: /.test(m.t || ''))
    .map((m) => normalizeIntent(String(m.t).split(' · ')[0]))
    .filter((n) => n.length > 2);
  return names.some((n) => plain.includes(n)) ? `${intent}\nGitHub` : intent;
}

function normalizeIntent(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function matchesIntent(connector, intent) {
  if (intent == null || !connector.route) return true;
  return connector.route.test(intent);
}

// Connectors the AI may use in this request: configured on the server, not
// switched off in the hub, and relevant to what the user is talking about.
function activeConnectors({ disabled = [], env = process.env, intent } = {}) {
  const off = new Set(disabled);
  // Entries without tools (Telegram, WhatsApp, the local probe) only describe a channel for the hub.
  return CONNECTORS.filter((c) => c.tools.length > 0 && !off.has(c.id) && missingEnv(c, env).length === 0 && matchesIntent(c, intent));
}

// Connectors the user could still use by name, whatever the topic — only the
// confirmation and Hoy paths need this, and they skip routing entirely.
function activeTools(options = {}) {
  return activeConnectors(options).flatMap((c) => c.tools);
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

// What the user sees of each tool call, as a "step": running while it works,
// then done / error / waiting (for their confirmation) with a one-line
// result, and whether the result was read back and verified. Steps stream
// to the app as they change and travel in the final event, so the chat keeps
// a receipt of what Eddie actually did instead of only what it said.
const STEP_TEXT_MAX = 160;

function beginStep(tool, name, hooks) {
  const step = { id: `s${hooks.steps.length + 1}`, tool: name, label: tool.label, activity: tool.activity || `${tool.label}…`, status: 'running' };
  hooks.steps.push(step);
  hooks.onStep?.({ ...step });
  return step;
}

function outcomeOf(tool, result, args, context) {
  if (result?.error) return { status: 'error', summary: clip(result.error, STEP_TEXT_MAX) };
  if (result?.status === 'awaiting_confirmation') return { status: 'waiting', summary: 'Espera tu confirmación' };
  const outcome = { status: 'done' };
  let summary;
  let detail;
  try {
    summary = tool.summarize?.(result, args, context);
    detail = tool.detail?.(result, args);
  } catch {
    // A summary is decoration: never let it break the call.
  }
  summary = clip(summary ?? result?.summary ?? '', STEP_TEXT_MAX);
  if (summary) outcome.summary = summary;
  if (typeof result?.verified === 'boolean') outcome.verified = result.verified;
  if (Array.isArray(detail)) outcome.detail = detail.slice(0, 8).map((d) => clip(d, 120));
  return outcome;
}

// Never lets a tool crash the chat request: an unknown or switched-off tool,
// invalid arguments, or an exception inside the tool all become an { error }
// result fed back to the model instead of aborting the answer.
async function runTool(tools, name, args, context, hooks) {
  const tool = tools.find((t) => t.declaration.name === name);
  if (!tool) return { error: `Herramienta desconocida o desactivada: ${name}` };

  const step = beginStep(tool, name, hooks);
  const finish = (result) => {
    Object.assign(step, outcomeOf(tool, result, args, context));
    hooks.onStep?.({ ...step });
    return result;
  };

  const validationError = validateArgs(tool.declaration, args);
  if (validationError) return finish({ error: validationError });

  // Actions like sending or deleting need the user's explicit OK: instead of
  // running, the request becomes a confirmation card in the chat (see
  // confirmTool), and the model is told to ask rather than claim it's done.
  if (tool.sensitive) {
    if (hooks.confirmations.length >= MAX_CONFIRMATIONS) {
      return finish({ error: 'Ya hay varias acciones esperando confirmación; pide al usuario que las resuelva primero.' });
    }
    let prepared;
    try {
      prepared = await prepareSensitive(tool, args, context);
    } catch (err) {
      return finish(toolError(name, err));
    }
    if (prepared?.error) return finish({ error: prepared.error });
    hooks.confirmations.push({ id: randomUUID(), stepId: step.id, tool: name, label: tool.label, args: prepared.args, preview: prepared.preview });
    return finish({
      status: 'awaiting_confirmation',
      instruction:
        'No se ha hecho todavía. El usuario ve una tarjeta para confirmar, editar o cancelar esta acción. Dile en una frase qué vas a hacer y que confirme; nunca digas que ya está hecho.',
    });
  }

  try {
    return finish(await tool.run(args || {}, context));
  } catch (err) {
    return finish(toolError(name, err));
  }
}

// What one chat request can use: the declarations to offer the model and a
// function to run whichever one it picks. `context` carries the user's time
// zone, location and task list for tools that need them. Tools that change
// something in the app (a new task) call context.emit(action); those actions
// collect in `actions`, and sensitive requests in `confirmations`, and both
// reach the browser with the finished answer. `intent` (text of the latest
// messages) narrows the connectors offered; `offered` lists the ones kept.
// `onStep` hears every step as it
// starts and ends (for the live "Eddie está trabajando" list); `steps` keeps
// the final state of each for the receipt.
export function createToolset({ disabled = [], context = {}, env = process.env, onStep, intent } = {}) {
  const connectors = activeConnectors({ disabled, env, intent });
  const tools = connectors.flatMap((c) => c.tools);
  const actions = [];
  const confirmations = [];
  const steps = [];
  const toolContext = { ...context, emit: (action) => actions.push(action) };
  return {
    offered: connectors.map((c) => c.id),
    declarations: tools.map((t) => t.declaration),
    execute: (name, args) => runTool(tools, name, args, toolContext, { onStep, confirmations, steps }),
    actions,
    confirmations,
    steps,
    // A failed attempt's side effects don't carry over to the fallback.
    reset() {
      actions.length = 0;
      confirmations.length = 0;
      steps.length = 0;
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

// Card-specific extras (a connector's own `details(user)`), never fatal.
async function safeDetails(connector, user) {
  if (!user || !connector.details) return null;
  try {
    return await connector.details(user);
  } catch {
    return null;
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
    CONNECTORS.filter((c) => !c.hidden).map(async (c) => {
      const missing = missingEnv(c, env);
      let status = 'ready';
      if (missing.length) status = 'needs_setup';
      else if (c.auth) status = (await isConnected(c, user)) ? 'connected' : 'needs_account';
      return {
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        category: c.category || 'otros',
        routing: c.route ? 'topic' : 'always',
        auth: c.auth?.type || null,
        connectScope: c.auth?.scope || null,
        status,
        missingEnv: missing,
        note: (typeof c.note === 'function' ? c.note(env) : c.note) || null,
        details: (await safeDetails(c, user)) || undefined,
        tools: c.tools.map((t) => ({ name: t.declaration.name, label: t.label, sensitive: Boolean(t.sensitive), risk: toolRisk(t) })),
      };
    }),
  );
  const planned = PLANNED_CONNECTORS.map((p) => ({ ...p, auth: null, status: 'planned', missingEnv: [], note: null, tools: [] }));
  return [...built, ...planned];
}
