// Eddie's own planning tool, not a service: for a request that takes several
// actions (or includes something delicate) the model writes the plan down
// first, and the app shows it above the steps that follow. Hidden from the
// Conectores hub and always on.
import { clip } from '../http.js';

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
  ],
  webhook: null,
};
