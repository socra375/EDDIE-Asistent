// Eddie's memory of past conversations. The notes themselves are written
// automatically (the app and the Telegram bot close a conversation and save
// a summary, see api/_lib/episodes/) and the most relevant ones are handed to
// Eddie before every answer; this tool is for when the user asks outright
// ("¿de qué hablamos la semana pasada?", "¿qué me dijiste sobre…?").
import { countEpisodes } from '../../episodes/store.js';
import { recallForTool } from '../../episodes/recall.js';
import { clip } from '../http.js';

function whenText(iso, timezone) {
  try {
    return new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone || 'UTC' }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

async function searchConversations(args, context) {
  const query = clip(args.query, 300);
  if (!query) return { error: 'Dime qué buscar en las conversaciones pasadas.' };
  const user = await context.getUser?.();
  if (!user) return { error: 'Para recordar conversaciones pasadas inicia sesión con Google (Configuración → Cuenta de Google).' };
  const found = await recallForTool(user.id, query);
  if (!found.length) {
    return { count: 0, note: 'No encontré nada parecido en las conversaciones guardadas. Díselo al usuario sin inventar; recuerda que solo se guardan conversaciones de más de unos mensajes.' };
  }
  return {
    count: found.length,
    conversations: found.map((e) => ({ when: whenText(e.createdAt, context.timezone), summary: e.summary })),
    note: 'Son notas resumidas de conversaciones anteriores: úsalas como contexto y di de cuándo son.',
  };
}

export default {
  id: 'conversations',
  name: 'Recuerdos de conversaciones',
  description: 'Eddie guarda un resumen de tus conversaciones (en la app y en Telegram) y recuerda lo que viene al caso cuando vuelves a hablar de un tema. Puedes verlos y borrarlos en Memoria.',
  icon: 'memory',
  category: 'asistente',
  // Offered when the user asks about past conversations; the automatic
  // recall doesn't need the tool.
  route: /hablamos|conversaci[oó]n|conversamos|me dijiste|te dije|te cont[eé]|la otra vez|vez pasada|semana pasada|el mes pasado|record[aá]s|recuerdas|te acuerdas|acuerdas de|qu[eé] (dijimos|decidimos|acordamos)|antes (dijimos|hablamos)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL', 'GEMINI_API_KEY'],
  note: 'Solo con sesión iniciada. Guarda un resumen corto (nunca la conversación completa) con un vector de significado para encontrarlo después. Nada de contraseñas ni tarjetas. Al apagar este conector o la Memoria, Eddie deja de guardar y de consultar; lo ya guardado se ve y se borra en Memoria.',
  details: async (user) => ({ count: await countEpisodes(user.id) }),
  tools: [
    {
      label: 'Buscar en conversaciones pasadas',
      activity: 'Recordando conversaciones anteriores…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result.count ? `${result.count} recuerdo${result.count === 1 ? '' : 's'} encontrado${result.count === 1 ? '' : 's'}` : 'Sin recuerdos parecidos'),
      declaration: {
        name: 'search_conversations',
        description:
          'Busca en las conversaciones pasadas del usuario con Eddie (por significado) cuando pregunta qué hablaron, qué decidieron o qué le dijiste antes ("¿qué decidimos del proyecto?", "¿de qué hablamos ayer?"). Para datos que el usuario te pidió guardar (perfil, preferencias, proyectos) usa recall.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'De qué trató lo que busca, en pocas palabras (p. ej. "decisión sobre la base de datos del proyecto").' } },
          required: ['query'],
        },
      },
      run: (args, context) => searchConversations(args, context),
    },
  ],
  webhook: null,
};
