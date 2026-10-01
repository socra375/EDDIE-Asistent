// Eddie's brain for chat channels (Telegram, WhatsApp): the same providers,
// tools, memory and tasks as the web app, but running on the server for a
// linked user. A channel brings a `link` ({ userId, timezone, user, history })
// and the surface note ("you're talking on Telegram…"), and gets back what to
// say, what changed and which confirmation cards to show.
import { callProvider } from '../providers.js';
import { confirmTool } from '../connectors/registry.js';
import { sanitizeConnectorIds } from '../handler.js';
import { buildSystemPrompt } from '../../../src/services/personality.js';
import { loadUserContext, applyActionsForUser } from '../telegram/serverActions.js';
import { recallBlock } from '../episodes/recall.js';

const ALLOWED_PROVIDERS = new Set(['gemini', 'claude', 'groq', 'openrouter']);

export async function askEddie({ link, text, images = [], note }) {
  const { userId } = link;
  const ctx = await loadUserContext(userId);
  const s = ctx.settings;
  const provider = ALLOWED_PROVIDERS.has(s.provider) ? s.provider : 'gemini';
  const model = typeof s.model === 'string' && s.model.length < 100 ? s.model : undefined;
  const language = /^[a-z]{2}$/.test(s.language || '') ? s.language : 'es';
  const off = sanitizeConnectorIds(s.disabledConnectors);
  const disabledConnectors = ctx.memoryOn ? off : [...new Set([...off, 'memory'])];
  const history = link.history.map((m) => ({ role: m.role, content: String(m.content) }));
  const recalled = off.includes('conversations') || !ctx.memoryOn ? '' : await recallBlock({ userId, messages: [...history, { role: 'user', content: text }], timezone: link.timezone });
  const system = `${buildSystemPrompt({
    mode: 'asistente',
    language,
    memory: ctx.memoryOn ? ctx.memory : null,
    query: text,
    tasks: ctx.tasks,
    disabledConnectors: off,
  })}${recalled ? `\n\n${recalled}` : ''}\n\n${note}`;
  const messages = [...history, { role: 'user', content: text, ...(images.length ? { images } : {}) }];

  // The answer arrives as pieces through onChunk (the result only carries
  // the metadata), same as the web stream.
  let answer = '';
  const result = await callProvider({
    provider,
    model,
    system,
    messages,
    context: { timezone: link.timezone, tasks: ctx.toolTasks, memory: ctx.memoryForTools, getUser: async () => link.user },
    disabledConnectors,
    onChunk: (piece) => {
      answer += piece;
    },
  });

  const changes = await applyActionsForUser(userId, result.actions, { memoryEnabled: ctx.memoryOn });
  const confirmations = result.confirmations || [];
  return {
    reply: answer.trim() || (confirmations.length ? 'Necesito tu confirmación:' : 'Listo.'),
    changes,
    receipt: changes.length ? `\n\n${changes.map((c) => `✓ ${c}`).join('\n')}` : '',
    confirmations,
    actions: result.actions || [],
    language,
  };
}

// Runs a card the user confirmed. → { text } on success (what to tell them:
// the summary plus what changed) or { error } with the reason.
export async function runConfirmed({ link, pending }) {
  const ctx = await loadUserContext(link.userId);
  const off = sanitizeConnectorIds(ctx.settings.disabledConnectors);
  const out = await confirmTool({
    name: pending.tool,
    args: pending.args,
    disabled: ctx.memoryOn ? off : [...new Set([...off, 'memory'])],
    context: { timezone: link.timezone, tasks: ctx.toolTasks, memory: ctx.memoryForTools, getUser: async () => link.user },
  });
  if (out.error) return { error: out.error };
  const changes = await applyActionsForUser(link.userId, out.actions, { memoryEnabled: ctx.memoryOn });
  const summary = out.result?.summary || 'Listo, hecho.';
  return { summary, text: `✅ ${summary}${changes.length ? `\n${changes.map((c) => `✓ ${c}`).join('\n')}` : ''}` };
}
