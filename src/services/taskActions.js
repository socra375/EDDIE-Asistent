import { getTasks, saveTasks } from '../utils/storage';
import { remoteTasks } from './remote';

// Fired after Eddie changes the task list from the chat, so the Tareas
// module and the Inicio summary re-read it without a reload.
export const TASKS_CHANGED_EVENT = 'eddie:tasks-changed';

let idCounter = 0;
function localId() {
  idCounter += 1;
  return `task-${Date.now()}-eddie${idCounter}`;
}

// The tasks the chat tools may refer to (see api/_lib/connectors/tasks).
export function tasksForContext() {
  return getTasks()
    .slice(0, 50)
    .map((t) => ({ id: String(t.id), title: t.title, done: Boolean(t.done) }));
}

// Applies what the chat tools asked for (the `actions` of the finished
// answer): locally always, and on the server too when signed in — the same
// two places the Tareas module writes to. Returns a short summary for the UI.
export async function applyTaskActions(actions, { signedIn = false } = {}) {
  if (!Array.isArray(actions) || !actions.length) return [];
  const applied = [];
  for (const action of actions) {
    try {
      if (action?.type === 'create_task' && action.task?.title) {
        const draft = { title: action.task.title, dueDate: action.task.dueDate || null, priority: action.task.priority || 'media' };
        let created = null;
        if (signedIn) {
          const result = await remoteTasks.create(draft);
          created = result?.task || null;
        }
        // Re-read after the await: the user may have edited tasks meanwhile.
        saveTasks([...getTasks(), created || { id: localId(), ...draft, done: false }]);
        applied.push({ type: 'create_task', title: draft.title });
      } else if (action?.type === 'delete_task' && action.id) {
        const target = getTasks().find((t) => String(t.id) === String(action.id));
        if (!target) continue;
        if (signedIn) await remoteTasks.remove(target.id);
        saveTasks(getTasks().filter((t) => String(t.id) !== String(target.id)));
        applied.push({ type: 'delete_task', title: target.title });
      } else if (action?.type === 'complete_task' && action.id) {
        const target = getTasks().find((t) => String(t.id) === String(action.id));
        if (!target || target.done) continue;
        if (signedIn) await remoteTasks.update(target.id, { done: true });
        saveTasks(getTasks().map((t) => (String(t.id) === String(target.id) ? { ...t, done: true } : t)));
        applied.push({ type: 'complete_task', title: target.title });
      }
    } catch (err) {
      // The server write failed (offline, session expired): keep the change
      // locally anyway so the user's request isn't lost.
      console.error('[applyTaskActions]', err);
      if (action?.type === 'create_task' && action.task?.title) {
        saveTasks([...getTasks(), { id: localId(), title: action.task.title, dueDate: action.task.dueDate || null, priority: action.task.priority || 'media', done: false }]);
        applied.push({ type: 'create_task', title: action.task.title });
      } else if (action?.type === 'complete_task') {
        saveTasks(getTasks().map((t) => (String(t.id) === String(action.id) ? { ...t, done: true } : t)));
        applied.push({ type: 'complete_task', title: action.title });
      } else if (action?.type === 'delete_task') {
        saveTasks(getTasks().filter((t) => String(t.id) !== String(action.id)));
        applied.push({ type: 'delete_task', title: action.title });
      }
    }
  }
  if (applied.length) window.dispatchEvent(new CustomEvent(TASKS_CHANGED_EVENT, { detail: applied }));
  return applied;
}
