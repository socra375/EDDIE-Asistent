// Real current date and time in the user's time zone, so Eddie never guesses
// from its training data. No account or API key needed.

async function getCurrentDateTime(context) {
  const timezone = context.timezone || 'UTC';
  const now = new Date();
  let formatted;
  try {
    formatted = new Intl.DateTimeFormat('es', { dateStyle: 'full', timeStyle: 'medium', timeZone: timezone }).format(now);
  } catch {
    formatted = now.toISOString();
  }
  return { datetime_iso: now.toISOString(), formatted, timezone };
}

export default {
  id: 'clock',
  name: 'Hora y fecha',
  description: 'Eddie consulta la hora y la fecha reales en tu zona horaria, en vez de adivinarlas.',
  icon: 'clock',
  auth: null,
  requiredEnv: [],
  tools: [
    {
      label: 'Consultar la hora y la fecha',
      activity: 'Consultando la hora…',
      summarize: (result) => result.formatted,
      sensitive: false,
      declaration: {
        name: 'get_current_datetime',
        description:
          'Devuelve la fecha y hora actuales en la zona horaria del usuario. Úsala siempre que el usuario pregunte qué hora es, qué día es hoy, o cuando necesites la fecha/hora actual para tu respuesta.',
        parameters: {
          type: 'OBJECT',
          properties: {},
        },
      },
      run: (args, context) => getCurrentDateTime(context),
    },
  ],
  webhook: null,
};
