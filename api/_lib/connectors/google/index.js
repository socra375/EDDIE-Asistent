// The user's Google account, connected through the existing Google login
// (api/_lib/authHandlers.js). Today Tasks use it to add events to Calendar
// and the chat to save replies to Drive; tools for Eddie to read and create
// events by voice arrive in session 12, and Gmail in sessions 9–11.
import { hasGoogleCredentials } from '../../googleCredentials.js';

export default {
  id: 'google',
  name: 'Google Calendar y Drive',
  description: 'Con tu cuenta de Google: agrega tareas a tu Calendario desde Tareas y guarda respuestas del chat en Drive.',
  icon: 'calendar',
  auth: {
    type: 'google-login',
    isConnected: (user) => hasGoogleCredentials(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  note: 'Eddie podrá consultar y crear eventos por voz en la sesión 12.',
  tools: [],
  webhook: null,
};
