// How the chat talks to Notas without importing it: the provider
// (context/NotesContext.jsx) fills these in while it is mounted, and the chat
// asks them for "toma notas durante 10 minutos" and the wording of its answers.
export const NOTES_EVENT = 'eddie:notes'; // detail.action: 'show' (open the Notas screen)

export const notesBridge = {
  isSupported: () => true,
  isDictating: () => false,
  defaultMinutes: () => 10,
  // Opens a blank sheet and starts listening for `minutes` (null = the saved default).
  // → { minutes, clamped }
  start: ({ minutes } = {}) => ({ minutes: minutes ?? 10, clamped: false }),
  // → { words: number } of the sheet that was being written, or null if nothing was running.
  stop: () => null,
  show: () => {},
};
