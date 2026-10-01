// /api/connectors/whatsapp/*: the webhook Meta calls (GET to verify the
// address, POST for every message) and the three actions the app's
// Conectores card uses (link, unlink, settings).
import { requireUser } from '../session.js';
import { isOwner, ownerEmails } from '../connectors/github/index.js';
import { handleWebhook, verifyWebhook, WHATSAPP_ENV } from './bot.js';
import { displayNumber } from './api.js';
import { createLinkCode, deleteLink, getLinkByUser, setVoiceReplies } from './store.js';

const missingEnv = () => WHATSAPP_ENV.filter((name) => !process.env[name]);

function validTimezone(tz) {
  if (typeof tz !== 'string' || tz.length > 100) return 'UTC';
  try {
    new Intl.DateTimeFormat('es', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

// When EDDIE_OWNER_EMAIL is set, only the owner can link a phone: Eddie
// spends the owner's AI quota and can reach the owner's connected accounts.
const mayLink = (user) => ownerEmails().length === 0 || isOwner(user);

async function linkRequest(cookies, body) {
  const user = await requireUser(cookies);
  const missing = missingEnv();
  if (missing.length) return { status: 503, json: { error: `Falta configurar en Vercel: ${missing.join(', ')}.` } };
  if (!mayLink(user)) return { status: 403, json: { error: 'Solo el dueño de Eddie puede vincular WhatsApp.' } };
  const number = await displayNumber();
  if (!number) return { status: 502, json: { error: 'No pude leer el número de WhatsApp de Eddie: revisa WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID.' } };
  const { code, minutes } = await createLinkCode(user.id, validTimezone(body?.timezone));
  const message = `VINCULAR ${code}`;
  return { status: 200, json: { code, minutes, number, message, url: `https://wa.me/${number}?text=${encodeURIComponent(message)}` } };
}

export async function handleWhatsappRoute({ method, path = [], cookies = {}, query = {}, headers = {}, body, rawBody }) {
  const action = path[1];
  if (action === 'webhook') {
    if (method === 'GET') return verifyWebhook(query);
    if (method === 'POST') return handleWebhook({ rawBody, body, headers });
    return { status: 405, json: { error: 'Método no permitido.' } };
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
    if (!(await getLinkByUser(user.id))) return { status: 409, json: { error: 'WhatsApp no está vinculado.' } };
    await setVoiceReplies(user.id, body.voiceReplies);
    return { status: 200, json: { ok: true, voiceReplies: body.voiceReplies } };
  }
  return { status: 404, json: { error: 'Esa acción de WhatsApp no existe.' } };
}
