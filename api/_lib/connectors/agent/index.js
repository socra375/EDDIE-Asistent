// Eddie's own planning tool, not a service: for a request that takes several
// actions (or includes something delicate) the model writes the plan down
// first, and the app shows it above the steps that follow. Hidden from the
// Conectores hub and always on.
import { clip } from '../http.js';
import { createJob } from '../../agentjobs/store.js';

const MAX_STEPS = 8;

function makePlan(args) {
  const goal = clip(args.goal, 160);
  const steps = (Array.isArray(args.steps) ? args.steps : [])
    .filter((s) => typeof s === 'string')
    .map((s) => clip(s, 120))
    .filter(Boolean);
  if (!goal) return { error: 'El plan necesita un objetivo.' };
  if (steps.length < 2) return { error: 'Un plan necesita al menos dos pasos; para una sola acción, hazla directamente.' };
  if (steps.length > MAX_STEPS) return { error: `Un plan puede tener como máximo ${MAX_STEPS} pasos; agrúpalos.` };
  return {
    ok: true,
    goal,
    steps,
    note: 'Plan registrado y visible para el usuario. Ejecútalo paso a paso con tus herramientas (las acciones delicadas piden confirmación), comprueba cada resultado y al final informa qué se hizo.',
  };
}

// Hands a long request to a second agent that works while the conversation goes on (api/_lib/agentjobs/). The app
// starts it when it sees the `agent_job` action and tells the user when it is done.
async function backgroundTask(args, context) {
  if (context.channel === 'job') return { error: 'Ya estás trabajando en segundo plano: haz tú el trabajo, no lo repartas.' };
  const task = clip(args.task, 1500);
  const label = clip(args.label, 60) || clip(task, 60);
  if (!task) return { error: 'Dime qué debe hacer el agente, con todos los datos que necesite.' };
  const user = await context.getUser?.();
  if (!user) return { error: 'Para trabajar en segundo plano el usuario debe iniciar sesión en Eddie.' };
  const made = await createJob(user.id, { label, task, timezone: context.timezone });
  if (made.error) return { error: made.error };
  context.emit?.({ type: 'agent_job', id: made.job.id, label });
  return {
    ok: true,
    label,
    summary: `Tarea en segundo plano: ${label}`,
    note: 'Otro agente ya está trabajando en esto. Dile al usuario en una frase corta qué le encargaste (sin decir que ya terminó) y sigue conversando con él; cuando termine, Eddie le avisa solo.',
  };
}

export default {
  id: 'agent',
  name: 'Planificador',
  description: 'Eddie planea los pedidos de varios pasos antes de ejecutarlos.',
  icon: 'check',
  category: 'asistente',
  hidden: true,
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Plan',
      activity: 'Armando el plan…',
      sensitive: false,
      declaration: {
        name: 'make_plan',
        description:
          'Escribe el plan antes de ejecutar un pedido que necesita 3 o más acciones, o que incluye algo delicado (enviar, borrar, mover). No la uses para una sola acción ni para preguntas. Después de llamarla, ejecuta los pasos con tus otras herramientas.',
        parameters: {
          type: 'OBJECT',
          properties: {
            goal: { type: 'STRING', description: 'Qué se quiere lograr, en una frase.' },
            steps: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Los pasos en orden, cada uno corto (2 a 8).' },
          },
          required: ['goal', 'steps'],
        },
      },
      summarize: (result) => result.goal,
      detail: (result) => result.steps,
      run: (args) => makePlan(args),
    },
    {
      label: 'Tarea en segundo plano',
      activity: 'Encargando la tarea…',
      sensitive: false,
      risk: 'write',
      declaration: {
        name: 'background_task',
        description:
          'Encarga un pedido largo a un segundo agente que lo hace en segundo plano mientras sigues hablando con el usuario. Úsala para investigar, preparar o editar documentos, revisar sus páginas o juntar información de varias fuentes cuando no necesita la respuesta ahora.',
        parameters: {
          type: 'OBJECT',
          properties: {
            task: { type: 'STRING', description: 'Qué debe hacer el agente, completo y autosuficiente (nombres, enlaces, datos): no verá esta conversación.' },
            label: { type: 'STRING', description: 'Título corto de la tarea (máx. 60 caracteres).' },
          },
          required: ['task'],
        },
      },
      summarize: (result) => result.summary,
      run: backgroundTask,
    },
  ],
  guide:
    'Segundo plano: si el pedido es largo o de varios pasos y el usuario no necesita la respuesta ahora (investigar, preparar o editar documentos, revisar sus páginas, resumir varias fuentes), usa background_task con todos los datos en «task» y sigue la charla; no lo uses para respuestas rápidas, preguntas ni una sola acción. Si pide algo «en segundo plano» o «mientras tanto», úsala siempre.',
  webhook: null,
};
