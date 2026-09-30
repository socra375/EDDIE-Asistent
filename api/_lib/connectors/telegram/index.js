// Eddie on Telegram. Not a set of tools for the model: the bot (api/_lib/
// telegram/) is another way to talk to the same Eddie, so this entry only
// describes it for the Conectores hub and says whether the user's chat is
// linked. The card's buttons call /api/connectors/telegram/link|unlink|settings.
import { getLinkByUser, hasTelegramLink } from '../../telegram/store.js';

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
    return link ? { voiceReplies: link.voiceReplies } : null;
  },
  tools: [],
  webhook: null,
};
