import { getMemory, saveMemory, getSettings } from '../utils/storage';
import { applyActions } from './memory';

// Fired after Eddie changes the memory from the chat, so the Memoria module
// and the settings context re-read it without a reload (same idea as
// TASKS_CHANGED_EVENT for tasks).
export const MEMORY_CHANGED_EVENT = 'eddie:memory-changed';

// Applies what the memory tools asked for (the `actions` of the finished
// answer) to the local memory; the sync bridge mirrors it to the account.
// Nothing is saved while the user has memory switched off in Configuración.
// Returns the one-line labels for the chat ("Recordé: …").
export function applyMemoryActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return [];
  if (getSettings().memoryEnabled === false) return [];
  const { memory, applied } = applyActions(getMemory(), actions);
  if (applied.length) {
    saveMemory(memory);
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT, { detail: applied }));
  }
  return applied;
}
