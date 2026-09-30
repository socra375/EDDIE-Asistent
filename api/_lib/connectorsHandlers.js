// Everything under /api/connectors. Today only the list for the hub; OAuth
// starts/callbacks and incoming webhooks (Telegram, WhatsApp) will be routed
// here as their connectors arrive, all inside the same serverless function.
import { describeConnectors } from './connectors/registry.js';
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

export async function handleConnectorsRequest({ method, path = [], cookies = {} }) {
  if (path.length === 0) {
    if (method === 'GET') return listConnectors(cookies);
    return { status: 405, json: { error: 'Método no permitido.' } };
  }
  return { status: 404, json: { error: 'Esta acción de conectores todavía no existe.' } };
}
