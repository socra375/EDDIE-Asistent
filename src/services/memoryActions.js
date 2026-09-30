import { getMemory, saveMemory, getSettings } from '../utils/storage';
import { addItem, upsertProject, removeItems } from './memory';

// Fired after Eddie changes the memory from the chat, so the Memoria module
// and the settings context re-read it without a reload (same idea as
// TASKS_CHANGED_EVENT for tasks).
export const MEMORY_CHANGED_EVENT = 'eddie:memory-changed';

const CATEGORY_OF = { perfil: 'profile', preferencia: 'preferences', decision: 'decisions', conocimiento: 'knowledge', contexto: 'context' };

// Applies what the memory tools asked for (the `actions` of the finished
// answer) to the local memory; the sync bridge mirrors it to the account.
// Nothing is saved while the user has memory switched off in Configuración.
// Returns the one-line labels for the chat ("Recordé: …").
export function applyMemoryActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return [];
  if (getSettings().memoryEnabled === false) return [];
  let memory = getMemory();
  const applied = [];
  for (const action of actions) {
    let result = null;
    if (action?.type === 'memory_add') {
      const category = CATEGORY_OF[action.category] || action.category;
      result = addItem(memory, { category, key: action.key, text: action.text, project: action.project, days: action.days });
      if (result.changed) applied.push(`Recordé: ${result.label}`);
    } else if (action?.type === 'memory_project') {
      result = upsertProject(memory, action.project || {});
      if (result.changed) applied.push(result.label);
    } else if (action?.type === 'memory_forget' && Array.isArray(action.ids)) {
      const out = removeItems(memory, action.ids);
      result = { memory: out.memory, changed: out.removed > 0 };
      if (out.removed) applied.push(`Olvidé ${out.removed} ${out.removed === 1 ? 'recuerdo' : 'recuerdos'}`);
    }
    if (result?.changed) memory = result.memory;
  }
  if (applied.length) {
    saveMemory(memory);
    window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT, { detail: applied }));
  }
  return applied;
}
