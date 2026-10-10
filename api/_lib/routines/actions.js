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

export const DEFAULT_SONG = 'Creed - Lonely';
export const ACTION_TYPES = ['summary', 'play_music', 'notify'];
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

// Runs every action in order and joins what each one has to say into one
// message. Never throws: an action that fails says so in its own line
// instead of losing the rest of the routine.
export async function runRoutineActions(actions, { user, timezone }) {
  const lines = [];
  for (const action of actions) {
    if (action.type === 'summary') lines.push(await runSummary(user, timezone));
    else if (action.type === 'play_music') lines.push(await runPlayMusic(user, action));
    else lines.push(action.text);
  }
  return lines.join('\n\n');
}
