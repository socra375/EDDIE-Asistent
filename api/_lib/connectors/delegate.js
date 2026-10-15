// The door to Eddie's specialists. It is not a connector of its own (nothing to switch on in the hub): the registry
// builds this tool only for a request that touches two or more specialist areas (accounts, reception, marketing,
// research), and then offers it in place of their individual tools. Each specialist works with just its own tools
// and playbook, so the main model keeps a short menu and the parts of a request can be done at the same time.

export function delegateTool(team) {
  const ids = team.map((c) => c.id);
  return {
    label: 'Pasar la tarea a un especialista',
    activity: 'Poniendo al especialista a trabajar…',
    risk: 'read',
    declaration: {
      name: 'delegar',
      description: `Pasa una parte de la petición al especialista que corresponde y te devuelve el resultado. Si la petición toca varias áreas, llama a esta herramienta una vez por especialista en la misma respuesta: trabajan a la vez. Especialistas: ${team.map((c) => `${c.id} (${c.role.name}: ${c.role.does})`).join('; ')}.`,
      parameters: {
        type: 'OBJECT',
        properties: {
          agente: { type: 'STRING', enum: ids, description: 'Quién se encarga: ' + ids.join(', ') + '.' },
          tarea: {
            type: 'STRING',
            description: 'La tarea completa y autosuficiente: nombres, montos, fechas y horas tal como las dijo el usuario. El especialista no ve la conversación, solo esto.',
          },
        },
        required: ['agente', 'tarea'],
      },
    },
    run: async ({ agente, tarea }, context) => {
      const member = team.find((c) => c.id === agente);
      if (!member) return { error: `Ese especialista no está disponible: ${agente}.` };
      if (!String(tarea || '').trim()) return { error: 'Falta la tarea para el especialista.' };
      if (!context.delegate) return { error: 'La delegación no está disponible en esta petición.' };
      return context.delegate({ connector: member, task: String(tarea).trim() });
    },
    summarize: (result) => (result?.error ? '' : `${result?.especialista || 'Especialista'}: listo`),
  };
}

// What the main model is told about its team (rides on the system prompt like the connectors' playbooks).
export function teamGuide(team) {
  const members = team.map((c) => `- ${c.id} — ${c.role.name}: ${c.role.does}.`).join('\n');
  return `TU EQUIPO — cómo y cuándo:
Esta petición toca varias áreas y tienes especialistas. Para esas áreas usa la herramienta «delegar» (agente + tarea):
${members}
1. Una llamada por especialista, todas en la misma respuesta (trabajan a la vez). Si una parte depende del resultado de otra (primero investigar y luego el guion), haz primero la que se necesita y delega la siguiente después, pasándole lo encontrado dentro de la tarea.
2. La tarea va completa y autosuficiente: el especialista no ve la conversación. Incluye nombres, montos, fechas y horas tal como los dijo el usuario; no inventes lo que falte.
3. Lo que puedas resolver tú con tus otras herramientas, resuélvelo tú; no delegues por delegar.
4. Cuando vuelvan, junta todo en una sola respuesta natural. No digas que se lo pasaste a otro, ni nombres a los especialistas ni la herramienta.
5. Si algo quedó pendiente de confirmación, dile en una frase qué es y que confirme la tarjeta; nunca digas que ya está hecho. Si un especialista falló, dilo con sinceridad y ofrece intentarlo de nuevo.`;
}
