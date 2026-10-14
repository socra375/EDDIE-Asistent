// What a routine (api/_lib/routines/run.js) is allowed to do when it fires:
// a fixed, safe menu of actions — never an arbitrary or sensitive tool call,
// since nobody is there to confirm a card when a routine runs on its own.
// Each action contributes one line (or block) to the message the user gets.
//
// buildBriefing is imported lazily (inside runSummary, not up here): it
// pulls in todayHandlers.js -> registry.js -> every connector, including
// this file's own connector (routines/index.js) -> this file. A static
// import here would make that a real circular import; a dynamic one
// resolves after every module has already finished loading, so the cycle
// never matters.
import { resolveVideo, watchUrl } from '../connectors/youtube/index.js';
import { requestOpen } from '../browser/open.js';
import { hasLink } from '../browser/store.js';
import { safeHttpsUrl } from '../browser/urls.js';

export const DEFAULT_SONG = 'Creed - Lonely';
export const ACTION_TYPES = ['summary', 'play_music', 'notify', 'agent', 'open_sites', 'say'];
// A task given to Eddie to carry out on his own (see runAgent): how long he gets before it is reported as unfinished.
const AGENT_TIMEOUT_MS = 40_000;
const MAX_ACTIONS = 5;

// Checks and normalizes the actions the model wants to store on a routine.
// → { actions } ready to save, or { error } written for the model.
export function validateActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return { error: `Dame al menos una acción. Las acciones posibles son: ${ACTION_TYPES.join(', ')}.` };
  if (actions.length > MAX_ACTIONS) return { error: `Máximo ${MAX_ACTIONS} acciones por rutina.` };
  const clean = [];
  for (const a of actions) {
    if (!a || !ACTION_TYPES.includes(a.type)) return { error: `«${a?.type}» no es una acción válida. Las acciones posibles son: ${ACTION_TYPES.join(', ')}.` };
    if (a.type === 'notify') {
      const text = String(a.text || '').trim();
      if (!text) return { error: 'La acción "notify" necesita un texto (qué avisar).' };
      clean.push({ type: 'notify', text: text.slice(0, 300) });
    } else if (a.type === 'open_sites') {
      const urls = (Array.isArray(a.urls) ? a.urls : String(a.urls || '').split(/[\s,;]+/)).map((u) => safeHttpsUrl(String(u).trim())).filter(Boolean);
      if (!urls.length) return { error: 'La acción "open_sites" necesita urls: direcciones https públicas, p. ej. ["https://www.youtube.com","https://web.whatsapp.com"].' };
      clean.push({ type: 'open_sites', urls: [...new Set(urls)].slice(0, 8) });
    } else if (a.type === 'say') {
      const text = String(a.text || '').replace(/\s+/g, ' ').trim();
      if (!text) return { error: 'La acción "say" necesita text: lo que dirá en voz alta.' };
      clean.push({ type: 'say', text: text.slice(0, 300) });
    } else if (a.type === 'agent') {
      const prompt = String(a.prompt || '').trim();
      if (prompt.length < 5) return { error: 'La acción "agent" necesita un prompt: la tarea que Eddie debe hacer solo (mínimo 5 caracteres).' };
      clean.push({ type: 'agent', prompt: prompt.slice(0, 600) });
    } else if (a.type === 'play_music') {
      const query = String(a.query || '').trim();
      clean.push({ type: 'play_music', ...(query ? { query: query.slice(0, 120) } : {}) });
    } else {
      clean.push({ type: 'summary' });
    }
  }
  return { actions: clean };
}

// A short, human description of what a routine does, for list_routines and
// the confirmation after creating one.
export function describeActions(actions) {
  return actions
    .map((a) => {
      if (a.type === 'summary') return 'el resumen del día';
      if (a.type === 'open_sites') return `abre ${a.urls.map((u) => new URL(u).hostname.replace(/^www\./, '')).join(', ')}`;
      if (a.type === 'say') return `dice en voz alta «${a.text}»`;
      if (a.type === 'agent') return `Eddie hace solo: «${a.prompt.slice(0, 80)}${a.prompt.length > 80 ? '…' : ''}»`;
      if (a.type === 'play_music') return `pone "${a.query || DEFAULT_SONG}"`;
      return `avisa "${a.text}"`;
    })
    .join(', ');
}

async function runSummary(user, timezone) {
  try {
    const { buildBriefing } = await import('../reminders/briefing.js');
    return await buildBriefing({ userId: user.id, timezone, user }, new Date());
  } catch (err) {
    return `No pude armar el resumen: ${err.message}`;
  }
}

async function runPlayMusic(user, action) {
  const query = action.query || DEFAULT_SONG;
  if (!(await hasLink(user.id))) return `🎵 Quería poner "${query}", pero no tienes tu navegador vinculado (Conectores → Tu navegador).`;
  try {
    const { video } = await resolveVideo(query);
    const url = video ? watchUrl(video.videoId) : `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const label = video ? `${video.title}${video.channel ? ` (${video.channel})` : ''}` : query;
    const opened = await requestOpen({ getUser: async () => user }, { url, label });
    if (opened.error) return `🎵 No pude poner "${query}": ${opened.error}`;
    return `🎵 Puse "${label}" en tu navegador.`;
  } catch (err) {
    return `🎵 No pude poner "${query}": ${err.message}`;
  }
}

// Pages for the user's browser (the extension takes them when the browser is running).
async function runOpenSites(user, action) {
  if (!(await hasLink(user.id))) return `🌐 Quería abrir ${action.urls.length} página(s), pero no tienes tu navegador vinculado (Conectores → Tu navegador).`;
  let opened = 0;
  for (const url of action.urls) {
    const out = await requestOpen({ getUser: async () => user }, { url, label: '' });
    if (!out.error) opened += 1;
  }
  return `🌐 Pedí abrir ${opened} página${opened === 1 ? '' : 's'} en tu navegador.`;
}

// A background agent: Eddie takes the task like a message from the user, with all his
// tools, memory and notes, but nobody is there to answer. So he cannot ask anything or
// confirm anything (a delicate action is reported as pending, never done), and he does not
// touch the routines or the user's browser. brain.js is imported lazily for the same
// reason as buildBriefing above.
async function runAgent(user, timezone, action) {
  try {
    const { askEddie } = await import('../channels/brain.js');
    const note = 'Estás ejecutando una tarea programada por el usuario y él NO está presente: no puedes hacerle preguntas ni esperar confirmaciones. Haz todo lo que puedas con tus herramientas y responde con el resultado en pocas frases claras (máximo 6 líneas), listo para leer en una notificación. Si algo no se puede hacer sin su permiso, dilo en una línea en vez de intentarlo.';
    const work = askEddie({ link: { userId: user.id, timezone, user, history: [] }, text: action.prompt, note, disable: ['routines', 'browser'] });
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve(null), AGENT_TIMEOUT_MS);
    });
    const out = await Promise.race([work, timeout]);
    clearTimeout(timer);
    if (!out) return `🤖 No alcancé a terminar «${action.prompt.slice(0, 60)}» a tiempo: pídemelo en el chat.`;
    const pending = (out.confirmations || []).map((c) => c.preview?.title || c.tool).filter(Boolean);
    return `${out.reply}${out.receipt || ''}${pending.length ? `\n\n⚠ Falta tu permiso para: ${pending.join(', ')} (no lo hice).` : ''}`;
  } catch (err) {
    return `🤖 No pude hacer «${action.prompt.slice(0, 60)}»: ${err.message}`;
  }
}

// Runs every action in order and joins what each one has to say into one
// message. Never throws: an action that fails says so in its own line
// instead of losing the rest of the routine.
export async function runRoutineActions(actions, { user, timezone, skip = [] }) {
  const lines = [];
  for (const action of actions) {
    if (skip.includes(action.type)) continue; // already done by the computer itself (routines/boot.js)
    if (action.type === 'summary') lines.push(await runSummary(user, timezone));
    else if (action.type === 'agent') lines.push(await runAgent(user, timezone, action));
    else if (action.type === 'open_sites') lines.push(await runOpenSites(user, action));
    else if (action.type === 'say') lines.push('🔈 Decir en voz alta solo funciona al encender el PC.');
    else if (action.type === 'play_music') lines.push(await runPlayMusic(user, action));
    else lines.push(action.text);
  }
  return lines.join('\n\n');
}
