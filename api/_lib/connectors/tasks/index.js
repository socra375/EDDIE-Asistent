// Eddie's own task list (the Tareas module). Tasks live in the browser, and
// in Postgres when the user is signed in, so these tools don't write
// anything themselves: they validate the request against the tasks the
// browser sent along (context.tasks) and emit an action that the app
// applies once the answer is complete (see applyTaskActions in the app).
import { resolveDate } from '../dates.js';

const PRIORITIES = ['alta', 'media', 'baja'];

export function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Accepts YYYY-MM-DD or everyday words ("hoy", "mañana", "el viernes"),
// resolved in the user's time zone (see ../dates.js).
export function resolveDueDate(value, timezone) {
  return resolveDate(value, timezone);
}

// Best pending task for a spoken description: exact match, then containment
// either way, then shared words. Ambiguous or empty → null plus candidates.
export function findTask(tasks, description, { includeDone = false } = {}) {
  const wanted = normalize(description);
  const pending = (tasks || []).filter((t) => (includeDone || !t.done) && t.title);
  if (!wanted || !pending.length) return { task: null, candidates: [] };
  const wantedWords = new Set(wanted.split(' ').filter((w) => w.length > 2));
  const scored = pending
    .map((t) => {
      const title = normalize(t.title);
      let score = 0;
      if (title === wanted) score = 100;
      else if (title.includes(wanted) || wanted.includes(title)) score = 60;
      else {
        const shared = title.split(' ').filter((w) => wantedWords.has(w)).length;
        score = wantedWords.size ? (shared / wantedWords.size) * 50 : 0;
      }
      return { t, score };
    })
    .filter((s) => s.score >= 25)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { task: null, candidates: [] };
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { task: null, candidates: scored.filter((s) => s.score === scored[0].score).map((s) => s.t.title) };
  }
  return { task: scored[0].t, candidates: [] };
}

function createTask(args, context) {
  const title = String(args.title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!title) return { error: 'La tarea necesita un título.' };
  const dueDate = resolveDueDate(args.due_date, context.timezone);
  if (dueDate === undefined) return { error: `No entendí la fecha "${args.due_date}". Usa AAAA-MM-DD, "hoy", "mañana" o un día de la semana.` };
  const priority = PRIORITIES.includes(args.priority) ? args.priority : 'media';
  const duplicate = (context.tasks || []).find((t) => !t.done && normalize(t.title) === normalize(title));
  if (duplicate) return { error: `Ya existe una tarea pendiente llamada "${duplicate.title}".` };
  const task = { title, dueDate, priority };
  context.emit?.({ type: 'create_task', task });
  return { created: true, task, note: 'La tarea aparecerá en el módulo Tareas al terminar tu respuesta.' };
}

function describeMatchError(description, candidates) {
  return candidates.length
    ? { error: `Hay varias tareas parecidas: ${candidates.join('; ')}. Pregunta cuál.` }
    : { error: `No encontré una tarea que coincida con "${description}".` };
}

// Deleting can't be undone, so it goes through the confirmation card: prepare
// finds the exact task (pending or done) and describes it; run deletes it.
function prepareDelete(args, context) {
  const { task, candidates } = findTask(context.tasks, args.title, { includeDone: true });
  if (!task) return describeMatchError(args.title, candidates);
  const fields = [{ key: 'title', label: 'Tarea', value: task.title }];
  if (task.done) fields.push({ key: 'state', label: 'Estado', value: 'Completada' });
  return {
    args: { title: task.title },
    preview: { title: 'Borrar tarea', confirmLabel: 'Borrar', danger: true, fields },
  };
}

function deleteTask(args, context) {
  const { task } = findTask(context.tasks, args.title, { includeDone: true });
  if (!task) return { error: `La tarea "${args.title}" ya no existe.` };
  context.emit?.({ type: 'delete_task', id: task.id, title: task.title });
  return { deleted: true, title: task.title, summary: `Borré la tarea "${task.title}".` };
}

function completeTask(args, context) {
  const { task, candidates } = findTask(context.tasks, args.title);
  if (!task) return describeMatchError(args.title, candidates);
  context.emit?.({ type: 'complete_task', id: task.id, title: task.title });
  return { completed: true, title: task.title };
}

export default {
  id: 'tasks',
  name: 'Tareas',
  description: 'Eddie crea tareas, las marca como hechas y, con tu confirmación, las borra, desde el chat o por voz.',
  icon: 'check',
  category: 'asistente',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Crear tareas',
      activity: 'Anotando la tarea…',
      summarize: (result) => `Tarea creada: «${result.task.title}»${result.task.dueDate ? ` (${result.task.dueDate})` : ''}`,
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'create_task',
        description:
          'Crea una tarea en la lista del usuario cuando te pide anotar o agendar algo pendiente ("anota comprar pan", "tengo que entregar el informe el viernes"). Si pide que le AVISES a una hora o tras un tiempo ("recuérdame a las 5", "avísame en 20 minutos"), usa set_reminder en vez de una tarea.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Qué hay que hacer, breve y en infinitivo, p. ej. "Comprar pan".' },
            due_date: { type: 'STRING', description: 'Fecha límite opcional: AAAA-MM-DD, "hoy", "mañana", "pasado mañana" o un día de la semana ("viernes").' },
            priority: { type: 'STRING', enum: PRIORITIES, description: 'Prioridad; "media" si el usuario no dice nada.' },
          },
          required: ['title'],
        },
      },
      run: (args, context) => createTask(args, context),
    },
    {
      label: 'Marcar tareas como hechas',
      activity: 'Marcando la tarea…',
      summarize: (result) => `Tarea completada: «${result.title}»`,
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'complete_task',
        description: 'Marca como completada una tarea pendiente del usuario ("ya compré el pan", "marca como hecho el informe").',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'El título de la tarea o una descripción parecida.' },
          },
          required: ['title'],
        },
      },
      run: (args, context) => completeTask(args, context),
    },
    {
      label: 'Borrar tareas',
      activity: 'Preparando la confirmación…',
      sensitive: true,
      declaration: {
        name: 'delete_task',
        description:
          'Borra una tarea de la lista del usuario (pendiente o hecha). Siempre pide confirmación al usuario con una tarjeta antes de borrarla; tú solo la propones.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'El título de la tarea o una descripción parecida.' },
          },
          required: ['title'],
        },
      },
      prepare: (args, context) => prepareDelete(args, context),
      run: (args, context) => deleteTask(args, context),
    },
  ],
  webhook: null,
};
