// Eddie on Telegram. The bot (api/_lib/telegram/) is another way to talk to the
// same Eddie, so this entry describes it for the Conectores hub and says whether
// the user's chat is linked (the card's buttons call /api/connectors/telegram/
// link|unlink|settings). Its one tool, send_to_telegram, lets Eddie deliver a
// finished result (a report, a draft…) there from the app instead of in the chat.
import { getLinkByUser, hasTelegramLink } from '../../telegram/store.js';
import { getBriefing, listPendingReminders } from '../../reminders/store.js';
import { sendDeliverable } from '../../telegram/mirror.js';
import { clip } from '../http.js';

// Eddie decides what is a result worth sending (a report, a draft, a plan…);
// greetings and short answers stay in the app.
async function sendToTelegram(args, context) {
  if (context.channel === 'telegram') return { delivered: false, note: 'Ya estás hablando por Telegram: da el resultado completo en tu respuesta.' };
  if (context.toTelegram === false) return { delivered: false, note: 'El usuario tiene apagado el envío a Telegram: entrega el resultado completo aquí en el chat.' };
  const user = await context.getUser?.();
  if (!user) return { delivered: false, note: 'Sin sesión no hay Telegram vinculado: entrega el resultado completo aquí en el chat.' };
  const out = await sendDeliverable({ userId: user.id, title: args.title, content: args.content });
  if (out.sent) {
    return {
      delivered: true,
      summary: `Envié a Telegram: «${clip(String(args.title || 'resultado'), 60)}»`,
      note: 'Ya está en el Telegram del usuario. En el chat NO repitas el contenido: di en una o dos frases qué enviaste (título y de qué trata) y ofrécele ajustarlo.',
    };
  }
  if (out.reason === 'not-linked') return { delivered: false, note: 'No tiene Telegram vinculado (se hace en Conectores → Telegram): entrega el resultado completo aquí en el chat y menciónale que puede vincularlo.' };
  if (out.reason === 'empty') return { error: 'No había contenido que enviar.' };
  return { error: 'No pude enviarlo a Telegram ahora mismo: entrega el resultado aquí en el chat.' };
}

export default {
  id: 'telegram',
  name: 'Telegram',
  description: 'Habla con Eddie desde Telegram: escríbele o mándale notas de voz y te contesta (también con su voz). Lo delicado te llega con botones para confirmar.',
  icon: 'send',
  category: 'comunicacion',
  auth: {
    type: 'telegram-link',
    isConnected: (user) => hasTelegramLink(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'APP_URL'],
  note: 'Solo responde en tu chat privado vinculado. Un bot de Telegram no puede hacer llamadas de teléfono: la "llamada" son notas de voz en ambos sentidos y el botón "Llamar a Eddie".',
  // Extra fields for the card (whether voice replies are always on).
  details: async (user) => {
    const link = user ? await getLinkByUser(user.id) : null;
    if (!link) return null;
    // The reminder tables come from a later migration: if they aren't there
    // yet, the card still shows the voice setting.
    const [briefing, pending] = await Promise.all([getBriefing(user.id).catch(() => null), listPendingReminders(user.id, 100).catch(() => [])]);
    return { voiceReplies: link.voiceReplies, briefing: briefing || { enabled: false, time: '07:00' }, pendingReminders: pending.length };
  },
  tools: [
    {
      label: 'Enviar un resultado a Telegram',
      activity: 'Enviándolo a Telegram…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'send_to_telegram',
        description:
          'Manda a Telegram del usuario el RESULTADO de un trabajo ya terminado (informe, resumen largo, redacción, borrador, plan, lista, agenda de la semana, tabla) para no llenar el chat. Conversa y pregunta todo en el chat y llámala solo al entregar. NO la uses para saludos, agradecimientos, respuestas cortas, preguntas, explicaciones breves ni confirmaciones. Si el usuario pide «mándamelo a Telegram», úsala aunque sea corto; si pide «aquí en el chat» o «léemelo», no. Las imágenes que creas ya llegan solas.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Título corto del resultado (máx. 100 caracteres).' },
            content: { type: 'STRING', description: 'El resultado completo y listo para leer, en texto plano (sin Markdown).' },
          },
          required: ['title', 'content'],
        },
      },
      run: (args, context) => sendToTelegram(args, context),
    },
  ],
  webhook: null,
};
