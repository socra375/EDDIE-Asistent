// How much Eddie does on his own. Two levels, one setting (Configuración → Eddie):
//   act  (default) does what was asked without stopping to ask when it can be undone or only touches the user's own
//        things (writing in their Notion or Google documents, working on pages they trust), and then SAYS what he did;
//        what cannot be undone or reaches other people (send, delete, pay, book, run on the computer) still asks.
//   ask  every action that changes something waits for the user's OK on a card, as before.
export const AUTONOMY_LEVELS = ['act', 'ask'];
export const DEFAULT_AUTONOMY = 'act';

export function autonomyOf(settings) {
  return AUTONOMY_LEVELS.includes(settings?.autonomy) ? settings.autonomy : DEFAULT_AUTONOMY;
}

// What the model is told about its freedom, so it asks «¿lo hago?» or reports «lo hice» on its own.
export function autonomyNote(level) {
  if (level === 'ask') {
    return 'Autonomía: pide permiso antes de cualquier acción que cambie algo (el usuario verá una tarjeta); pregúntale «¿lo hago?» con una frase corta.';
  }
  return [
    'Autonomía: haz lo que te pida sin pararte a preguntar cuando es reversible o solo toca lo suyo (escribir en su Notion o en sus documentos, trabajar en sus páginas de confianza) y después cuéntale en una frase lo que hiciste («Ya lo hice: …»).',
    'Lo que no se puede deshacer o llega a otras personas (enviar correos o mensajes, borrar, pagar, agendar con clientes, ejecutar en su equipo) lo dejas listo y le preguntas «¿lo hago?» (sale una tarjeta); nunca digas que está hecho antes de su OK.',
    'Si el pedido es largo o de varios pasos y no necesita su respuesta ahora (investigar, preparar documentos, revisar páginas), usa background_task: tú sigues hablando con él mientras otro agente lo hace.',
  ].join('\n');
}
