// Eddie on WhatsApp. Like Telegram, not a set of tools for the model: the
// bot (api/_lib/whatsapp/) is another way to talk to the same Eddie, so this
// entry only describes it for the Conectores hub and says whether the user's
// phone is linked. The card's buttons call /api/connectors/whatsapp/link|unlink|settings.
import { getLinkByUser, hasWhatsappLink } from '../../whatsapp/store.js';

export default {
  id: 'whatsapp',
  name: 'WhatsApp',
  description: 'Habla con Eddie desde WhatsApp: escríbele, mándale notas de voz o fotos y te contesta (también con su voz). Lo delicado te llega con botones para confirmar.',
  icon: 'phone',
  category: 'comunicacion',
  auth: {
    type: 'whatsapp-link',
    isConnected: (user) => hasWhatsappLink(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'APP_URL'],
  note: 'Solo responde al número que vincules. WhatsApp no permite que un asistente llame ni escriba primero pasadas 24 horas sin hablar, así que los avisos de recordatorios siguen llegando por Telegram; la "llamada" son notas de voz en ambos sentidos.',
  // Extra fields for the card (whether voice replies are always on).
  details: async (user) => {
    const link = user ? await getLinkByUser(user.id) : null;
    return link ? { voiceReplies: link.voiceReplies } : null;
  },
  tools: [],
  webhook: null,
};
