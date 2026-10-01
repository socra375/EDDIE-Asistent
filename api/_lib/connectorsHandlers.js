// Everything under /api/connectors. The list for the hub, the "Hoy" panel's data, the
// scheduled job (cron) that sends reminders and the morning summary; OAuth
// starts/callbacks and incoming webhooks (Telegram, WhatsApp) will be routed
// here as their connectors arrive, all inside the same serverless function.
import { describeConnectors } from './connectors/registry.js';
import { getToday } from './todayHandlers.js';
import { handleTelegramRoute } from './telegram/handlers.js';
import { handleCronRequest } from './reminders/cron.js';
import { handleEpisodesRoute } from './episodes/handlers.js';
import { getSessionUser, SESSION_COOKIE_NAME } from './session.js';

// Works signed in or not: without a session (or without a database)
// account-based connectors simply show as "por conectar".
async function listConnectors(cookies) {
  let user = null;
  if (process.env.DATABASE_URL && cookies[SESSION_COOKIE_NAME]) {
    try {
      user = await getSessionUser(cookies[SESSION_COOKIE_NAME]);
    } catch {
      user = null;
    }
  }
  return { status: 200, json: { connectors: await describeConnectors({ user }), toolProviders: ['gemini', 'groq', 'openrouter'] } };
}

export async function handleConnectorsRequest({ method, path = [], cookies = {}, query = {}, headers = {}, body }) {
  if (path.length === 0) {
    if (method === 'GET') return listConnectors(cookies);
    return { status: 405, json: { error: 'Método no permitido.' } };
  }
  if (path.length === 1 && path[0] === 'today') {
    if (method === 'GET') return getToday({ query, cookies });
    return { status: 405, json: { error: 'Método no permitido.' } };
  }
  if (path.length === 1 && path[0] === 'cron') return handleCronRequest({ method, headers });
  if (path[0] === 'episodes') return handleEpisodesRoute({ method, path, cookies, body });
  if (path[0] === 'telegram') return handleTelegramRoute({ method, path, cookies, headers, body });
  return { status: 404, json: { error: 'Esta acción de conectores todavía no existe.' } };
}
