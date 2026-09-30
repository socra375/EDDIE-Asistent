// /api/connectors/telegram/*: the webhook Telegram calls, and the three
// actions the app's Conectores card uses (link, unlink, settings).
import { requireUser } from '../session.js';
import { isOwner, ownerEmails } from '../connectors/github/index.js';
import { handleWebhook } from './bot.js';
import { botUsername, ensureBotSetup, webhookStatus } from './api.js';
import { createLinkCode, deleteLink, getLinkByUser, setVoiceReplies } from './store.js';

export const TELEGRAM_ENV = ['DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'APP_URL'];

function missingEnv() {
  return TELEGRAM_ENV.filter((name) => !process.env[name]);
}

function validTimezone(tz) {
  if (typeof tz !== 'string' || tz.length > 100) return 'UTC';
  try {
    new Intl.DateTimeFormat('es', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

// When EDDIE_OWNER_EMAIL is set, only the owner can link a chat: the bot
// spends the owner's AI quota and can reach the owner's connected accounts.
function mayLink(user) {
  return ownerEmails().length === 0 || isOwner(user);
}

async function linkRequest(cookies, body) {
  const user = await requireUser(cookies);
  const missing = missingEnv();
  if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
  if (!mayLink(user)) return { status: 403, json: { error: 'Solo el dueño de Eddie puede vincular Telegram.' } };
  const setup = await ensureBotSetup({ appUrl: process.env.APP_URL, secret: process.env.TELEGRAM_WEBHOOK_SECRET });
  if (!setup.ok) return { status: 502, json: { error: setup.error } };
  const { code, minutes } = await createLinkCode(user.id, validTimezone(body?.timezone));
  const username = await botUsername();
  if (!username) return { status: 502, json: { error: 'No pude leer el nombre del bot de Telegram.' } };
  return { status: 200, json: { code, minutes, username, url: `https://t.me/${username}?start=${code}`, webhook: await webhookStatus() } };
}

export async function handleTelegramRoute({ method, path = [], cookies = {}, headers = {}, body }) {
  const action = path[1];
  if (action === 'webhook') {
    if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
    return handleWebhook({ headers, body });
  }
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  if (action === 'link') return linkRequest(cookies, body);
  if (action === 'unlink') {
    const user = await requireUser(cookies);
    await deleteLink(user.id);
    return { status: 200, json: { ok: true } };
  }
  if (action === 'settings') {
    const user = await requireUser(cookies);
    if (typeof body?.voiceReplies !== 'boolean') return { status: 400, json: { error: 'Falta voiceReplies (true o false).' } };
    if (!(await getLinkByUser(user.id))) return { status: 409, json: { error: 'Telegram no está vinculado.' } };
    await setVoiceReplies(user.id, body.voiceReplies);
    return { status: 200, json: { ok: true, voiceReplies: body.voiceReplies } };
  }
  return { status: 404, json: { error: 'Esa acción de Telegram no existe.' } };
}
