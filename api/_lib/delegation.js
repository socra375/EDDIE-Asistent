// Eddie as a team. When a request touches two specialist areas (accounts and reception, research and marketing…),
// the main model hands each one its part with the `delegar` tool; this runs that part: a small model call of its
// own, with only the specialist's tools and playbook, whose written result goes back to the main model. Several
// delegations asked together run at the same time.
//
// Cards and results are shared with the main request: a specialist that needs the user's OK raises the same card
// the main model would have, and nothing it does is hidden from the receipt. A specialist never delegates in turn.
import { createToolset } from './connectors/registry.js';

export const MAX_DELEGATIONS = 3;
// Past this a specialist is left behind: the main answer still has to fit in the function's time (vercel.json).
export const SPECIALIST_DEADLINE_MS = 22000;
const RESULT_MAX_CHARS = 2500;

function nowText(timezone) {
  try {
    return new Date().toLocaleString('es', { timeZone: timezone || 'UTC', dateStyle: 'full', timeStyle: 'short' });
  } catch {
    return new Date().toISOString();
  }
}

function specialistPrompt(role, timezone, guide) {
  return `Eres «${role.name}», un especialista dentro de Eddie, el asistente personal. Eddie te pasa UNA tarea; la haces con tus herramientas y le devuelves el resultado.
- Haz lo que pide la tarea y nada más. No inventes datos: si falta algo imprescindible, dilo en una frase en lugar de adivinar.
- Respóndele a Eddie (no al usuario), en español y breve: de 2 a 5 frases o una lista corta con lo concreto (cifras, fechas, nombres, lo que quedó hecho).
- Si una acción queda esperando la confirmación del usuario, di exactamente cuál; nunca digas que ya está hecha.
- Ahora es ${nowText(timezone)}.${guide ? `\n\n${guide}` : ''}`;
}

// `callOne({ provider, model, system, messages, toolset, onChunk })` runs one provider (the one the main request uses
// is tried first, then the others); `state` says which that is right now; `base` is the main request's context
// (without `delegate`, so a specialist can't hand work on); `shared` its arrays of actions, cards and steps.
export function createDelegator({ callOne, state, base, shared, onStep, disabled = [], env = process.env }) {
  let count = 0;

  return async function delegate({ connector, task }) {
    if (count >= MAX_DELEGATIONS) return { error: 'Ya se pasaron varias tareas en esta petición; resuélvelo con lo que ya tienes o dile al usuario que lo pida por partes.' };
    count += 1;

    const cardsBefore = shared.confirmations.length;
    let stopped = false;
    const toolset = createToolset({ disabled, context: base, env, onStep, only: [connector.id], shared });
    const guarded = {
      ...toolset,
      execute: (name, args) => (stopped ? Promise.resolve({ error: 'Se acabó el tiempo de esta tarea.' }) : toolset.execute(name, args)),
    };
    const system = specialistPrompt(connector.role, base.timezone, toolset.guide);
    const chain = [state.provider, ...(state.chain || [])].filter((p, i, all) => p && p !== 'claude' && all.indexOf(p) === i);

    const attempt = async () => {
      let lastError = null;
      for (const provider of chain) {
        let text = '';
        try {
          await callOne({
            provider,
            model: provider === state.provider ? state.model : undefined,
            system,
            messages: [{ role: 'user', content: task }],
            toolset: guarded,
            onChunk: (chunk) => {
              text += chunk;
            },
          });
          if (text.trim()) return { text: text.trim() };
        } catch (err) {
          lastError = err;
          // Whatever the failed attempt started (a card) is kept: it is real and the user can still resolve it.
          if (stopped) break;
        }
      }
      return { error: lastError?.message || 'No dio ninguna respuesta.' };
    };

    let timer;
    const outcome = await Promise.race([
      attempt(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ error: 'Tardó demasiado.' }), SPECIALIST_DEADLINE_MS);
      }),
    ]);
    clearTimeout(timer);
    stopped = true;

    const pending = shared.confirmations.length - cardsBefore;
    if (outcome.error) {
      return { especialista: connector.role.name, error: `${connector.role.name} no pudo hacerlo: ${outcome.error}`, ...(pending > 0 ? { pendiente_confirmacion: pending } : {}) };
    }
    return {
      especialista: connector.role.name,
      resultado: outcome.text.length > RESULT_MAX_CHARS ? `${outcome.text.slice(0, RESULT_MAX_CHARS)}…` : outcome.text,
      ...(pending > 0
        ? { pendiente_confirmacion: pending, instruccion: 'Hay acciones esperando que el usuario las confirme en una tarjeta; dile qué son y que confirme. No digas que ya están hechas.' }
        : {}),
    };
  };
}
