// Eddie on WhatsApp (Meta's Cloud API). One webhook receives every event; a
// linked phone talks to the very same brain as the web app and Telegram —
// providers, tools, memory, tasks — and Eddie answers in text, and with its
// own voice when the user sent a voice note. Confirmations arrive as
// WhatsApp reply buttons.
//
// Limits worth knowing: free-form replies only work within 24 hours of the
// user's last message (always true when answering), and the Cloud API cannot
// place or receive phone calls.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { transcribeAudio, MAX_AUDIO_BYTES } from '../transcribe.js';
import { askEddie, runConfirmed } from '../channels/brain.js';
import { IMAGE_PROMPT, MAX_IMAGE_BYTES, closeConversation as closeThread, decisionFromText, cardText, voiceFor } from '../channels/common.js';
import { safeYoutubeUrl } from '../connectors/youtube/index.js';
import { buildBriefing } from '../reminders/briefing.js';
import { listPendingReminders } from '../reminders/store.js';
import { whenLabel } from '../connectors/reminders/index.js';
import { sendText, sendButtons, sendAudio, markRead, downloadMedia } from './api.js';
import { consumeLinkCode, getLinkByWa, deleteLink, setVoiceReplies, saveHistory, markEpisodeSaved, markMessageSeen, addPending, takePending, latestPending } from './store.js';

export const WHATSAPP_ENV = ['DATABASE_URL', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'APP_URL'];

const NOT_LINKED =
  'Hola, soy Eddie. Este número todavía no está vinculado a tu cuenta.\n\nAbre la app de Eddie → Conectores → WhatsApp → "Vincular WhatsApp" y envíame el mensaje que te dará.';

const HELP = [
  'Soy Eddie, el mismo de la app, ahora en tu WhatsApp.',
  '',
  '• Escríbeme o mándame una nota de voz: te contesto con mi voz.',
  '• Mándame una foto (con o sin pregunta) y te digo qué veo.',
  '• Puedo mirar tu agenda y tus correos, crear tareas, recordar cosas, buscar en internet, revisar tus repos…',
  '• Lo delicado (enviar un correo, borrar algo) te llega con botones para que tú decidas.',
  '',
  'Comandos:',
  '/voz on|off — que conteste siempre con voz, aunque me escribas',
  '/resumen — el resumen de tu día ahora mismo',
  '/recordatorios — tus avisos pendientes',
  '/nuevo — empezar una conversación nueva',
  '/desvincular — desconectar este número de tu cuenta',
  '',
  'Nota: WhatsApp no deja que un asistente te llame ni te escriba primero después de 24 horas sin hablar; los avisos de recordatorios siguen llegando por Telegram.',
].join('\n');

const WHATSAPP_NOTE =
  'Estás conversando con el usuario por WhatsApp, desde su teléfono: responde corto y directo (unas pocas frases), sin Markdown. Si te habla por nota de voz, contesta como si hablaras: frases cortas y naturales, sin listas ni enlaces. Las acciones delicadas le llegan como botones de Confirmar / Cancelar en el chat.';

const closeConversation = (link, options) => closeThread(link, { source: 'whatsapp', markSaved: markEpisodeSaved, ...options });

// ---- webhook security ------------------------------------------------------

const hmac = (secret, payload) => `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Meta signs the exact bytes it sends (X-Hub-Signature-256, HMAC-SHA256 with
// the app secret). When the platform hands us the raw bytes that is what is
// checked; when it only gives the parsed JSON, the bytes are rebuilt the way
// Meta writes them (compact, non-ASCII as \uXXXX, "/" as "\/") — any rebuild
// that matches proves the sender knew the secret, so nothing is lost.
export function signatureValid({ rawBody, body, header, secret }) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const candidates = [];
  if (rawBody) candidates.push(rawBody);
  if (body && typeof body === 'object') {
    const compact = JSON.stringify(body);
    const escaped = compact.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    candidates.push(compact, escaped, escaped.replace(/\//g, '\\/'), compact.replace(/\//g, '\\/'));
  }
  return candidates.some((c) => same(header, hmac(secret, c)));
}

// GET /api/connectors/whatsapp/webhook — Meta checks the address once, when it
// is saved in the dashboard: echo `hub.challenge` if the verify token matches.
export function verifyWebhook(query = {}) {
  const get = (k) => query[`hub.${k}`] ?? query.hub?.[k];
  const expected = String(process.env.WHATSAPP_VERIFY_TOKEN || '');
  const got = String(get('verify_token') || '');
  if (get('mode') === 'subscribe' && expected && same(got, expected) && get('challenge') != null) return { status: 200, text: String(get('challenge')) };
  return { status: 403, json: { error: 'Verificación no válida.' } };
}

// POST /api/connectors/whatsapp/webhook. Answers 200 once the signature
// checks out — a non-2xx makes Meta retry the same delivery.
export async function handleWebhook({ rawBody = null, body, headers = {} }) {
  const missing = WHATSAPP_ENV.filter((n) => !process.env[n]);
  if (missing.length) return { status: 503, json: { error: 'WhatsApp no está configurado.' } };
  if (!signatureValid({ rawBody, body, header: headers['x-hub-signature-256'], secret: process.env.WHATSAPP_APP_SECRET })) {
    return { status: 401, json: { error: 'No autorizado.' } };
  }
  if (body?.object !== 'whatsapp_business_account') return { status: 200, json: { ok: true } };
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      // Only what is addressed to our number (a delivery for another is ignored).
      if (value.metadata?.phone_number_id && String(value.metadata.phone_number_id) !== String(process.env.WHATSAPP_PHONE_NUMBER_ID)) continue;
      for (const message of value.messages || []) {
        try {
          if (message?.id && (await markMessageSeen(message.id))) await processMessage(message);
        } catch (err) {
          console.error('[whatsapp] message failed:', err);
        }
      }
    }
  }
  return { status: 200, json: { ok: true } };
}

// ---- one message -----------------------------------------------------------

const LINK_RE = /^\s*vincular\s+([a-z0-9]{8})\s*$/i;

async function processMessage(msg) {
  const wa = String(msg.from || '');
  if (!/^\d{6,20}$/.test(wa)) return undefined;
  markRead(msg.id).catch(() => {});

  const text = msg.type === 'text' ? String(msg.text?.body || '').trim() : '';
  const link0 = LINK_RE.exec(text);
  if (link0) return handleLink(wa, link0[1].toUpperCase());

  const link = await getLinkByWa(wa);
  if (!link) return sendText(wa, NOT_LINKED);

  // A tap on Confirmar / Cancelar.
  if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
    const m = /^(ok|no):([0-9a-f-]{36})$/i.exec(msg.interactive.button_reply?.id || '');
    return m ? resolvePending(link, m[2], m[1].toLowerCase()) : undefined;
  }

  const command = /^\/(\w+)(?:\s+(.*))?$/.exec(text) || (/^(ayuda|help)$/i.test(text) ? [text, 'ayuda'] : null);
  if (command) return handleCommand(link, command[1].toLowerCase(), (command[2] || '').trim());

  let userText = text;
  let viaVoice = false;
  let images = [];
  if (msg.type === 'audio') {
    viaVoice = true;
    userText = await transcribeVoice(wa, msg.audio);
    if (!userText) return undefined;
  } else if (msg.type === 'image') {
    images = await fetchImage(wa, msg.image);
    if (!images.length) return undefined;
    userText = String(msg.image?.caption || '').trim() || IMAGE_PROMPT;
  } else if (msg.type !== 'text' || !text) {
    if (['reaction', 'unsupported', 'system', 'ephemeral', 'request_welcome'].includes(msg.type)) return undefined;
    return sendText(wa, 'Por ahora entiendo texto, fotos y notas de voz.');
  }

  // "Sí" / "no" after a confirmation answers it, same as in the app.
  const pendingId = await latestPending(wa);
  if (pendingId) {
    const decision = decisionFromText(userText);
    if (decision) return resolvePending(link, pendingId, decision);
  }
  return runAssistant(link, userText, viaVoice, images);
}

async function handleLink(wa, code) {
  const userId = await consumeLinkCode(code, wa);
  if (!userId) return sendText(wa, 'Ese código no es válido o ya caducó. Genera uno nuevo en la app (Conectores → WhatsApp → Vincular).');
  const link = await getLinkByWa(wa);
  const name = link?.user?.name?.split(' ')[0];
  return sendText(wa, `Listo${name ? `, ${name}` : ''}: este número ya es tuyo. Escríbeme o mándame notas de voz y fotos.\n\n${HELP}`);
}

async function handleCommand(link, name, arg) {
  const { waId } = link;
  if (name === 'ayuda' || name === 'help' || name === 'start') return sendText(waId, HELP);
  if (name === 'nuevo') {
    await closeConversation(link, { force: true });
    await saveHistory(link.userId, []);
    return sendText(waId, 'Conversación nueva. ¿En qué te ayudo?');
  }
  if (name === 'voz') {
    const a = arg.toLowerCase();
    const on = a === 'on' || a === 'si' || a === 'sí' ? true : a === 'off' || a === 'no' ? false : !link.voiceReplies;
    await setVoiceReplies(link.userId, on);
    return sendText(waId, on ? 'Listo: te contesto siempre con mi voz.' : 'Listo: solo te contesto con voz cuando tú me mandes una nota de voz.');
  }
  if (name === 'resumen') {
    try {
      return await sendText(waId, await buildBriefing(link));
    } catch (err) {
      console.error('[whatsapp] briefing failed:', err);
      return sendText(waId, 'No pude armar tu resumen ahora. Inténtalo de nuevo en un momento.');
    }
  }
  if (name === 'recordatorios') {
    const pending = await listPendingReminders(link.userId);
    if (!pending.length) return sendText(waId, 'No tienes recordatorios pendientes. (Los avisos te llegan por Telegram.)');
    return sendText(waId, ['Tus recordatorios pendientes:', ...pending.slice(0, 20).map((r) => `• ${whenLabel(r.dueAt, link.timezone)} — ${r.text}`)].join('\n'));
  }
  if (name === 'desvincular') {
    await deleteLink(link.userId);
    return sendText(waId, 'Número desvinculado. Ya no respondo aquí hasta que lo vincules de nuevo desde la app.');
  }
  return sendText(waId, 'No conozco ese comando. Prueba /ayuda.');
}

// Voice note -> text with Whisper (the same transcription as the web app).
async function transcribeVoice(wa, audio) {
  const media = audio?.id ? await downloadMedia(audio.id) : null;
  if (!media) {
    await sendText(wa, 'No pude descargar tu nota de voz. Inténtalo otra vez.');
    return '';
  }
  if (media.bytes.length > MAX_AUDIO_BYTES) {
    await sendText(wa, 'Esa nota de voz es muy larga para transcribirla. Mándame fragmentos más cortos.');
    return '';
  }
  try {
    const { text } = await transcribeAudio({ audio: media.bytes, mimeType: String(media.mimeType || audio.mime_type || 'audio/ogg').split(';')[0], language: 'es' });
    if (!text) {
      await sendText(wa, 'No te entendí bien. ¿Me lo repites?');
      return '';
    }
    await sendText(wa, `🎙 “${text}”`);
    return text;
  } catch (err) {
    await sendText(wa, err.message || 'No pude transcribir tu nota de voz.');
    return '';
  }
}

const IMAGE_MIME = /^image\/(jpeg|png|webp)$/;

async function fetchImage(wa, image) {
  const media = image?.id ? await downloadMedia(image.id) : null;
  if (!media) {
    await sendText(wa, 'No pude descargar tu foto. Inténtalo otra vez.');
    return [];
  }
  const mimeType = String(media.mimeType || image.mime_type || '').split(';')[0];
  if (!IMAGE_MIME.test(mimeType)) {
    await sendText(wa, 'Ese formato de imagen no lo puedo leer (usa una foto normal, JPG o PNG).');
    return [];
  }
  if (media.bytes.length > MAX_IMAGE_BYTES) {
    await sendText(wa, 'Esa imagen es muy pesada para que la vea. Mándala comprimida (como foto normal).');
    return [];
  }
  return [{ mimeType, data: media.bytes.toString('base64') }];
}

async function runAssistant(link, text, viaVoice, images = []) {
  const { waId, userId } = link;
  const wantsVoice = viaVoice || link.voiceReplies;
  // The previous conversation, if it went cold, is kept while this answer is prepared.
  const closing = closeConversation(link);
  try {
    const { reply, receipt, confirmations, actions, language, voiceId } = await askEddie({ link, text, images, note: WHATSAPP_NOTE });
    await sendText(waId, reply + receipt);

    for (const c of confirmations) {
      const id = await addPending(userId, waId, { tool: c.tool, args: c.args, label: c.label });
      await sendButtons(waId, cardText(c), [
        { id: `ok:${id}`, title: `✅ ${c.preview?.confirmLabel || 'Confirmar'}` },
        { id: `no:${id}`, title: '✖ Cancelar' },
      ]);
    }

    // Pages Eddie meant to open (YouTube): the link goes out as a message.
    for (const action of actions.filter((a) => a?.type === 'open_url' || a?.type === 'play_video').slice(0, 2)) {
      const url = safeYoutubeUrl(action.url);
      const label = action.type === 'play_video' ? `${action.title || 'Video'}${action.channel ? ` · ${action.channel}` : ''}` : action.label || 'YouTube';
      if (url) await sendText(waId, `▶ ${String(label).slice(0, 100)}\n${url}`, { previewUrl: true });
    }

    if (wantsVoice) {
      const audio = await voiceFor(reply, language, 'whatsapp', voiceId);
      if (audio) await sendAudio(waId, audio);
    }
    await closing;
    await saveHistory(userId, [...link.history, { role: 'user', content: images.length ? `📷 ${text}` : text }, { role: 'assistant', content: reply + receipt }]);
  } catch (err) {
    await closing;
    console.error('[whatsapp] assistant failed:', err);
    await sendText(waId, `No pude completar eso: ${err.message || 'error inesperado'}.`);
  }
}

// Runs or cancels a confirmation, from its buttons or from a typed/spoken "sí" / "no".
async function resolvePending(link, pendingId, decision) {
  const { waId, userId } = link;
  const pending = await takePending(pendingId, waId);
  if (!pending || pending.user_id !== userId) return sendText(waId, 'Esa acción ya se resolvió o caducó.');
  if (decision === 'no') return sendText(waId, 'Cancelado, no hice nada.');
  try {
    const out = await runConfirmed({ link, pending });
    if (out.error) return sendText(waId, `No pude hacerlo: ${out.error}`);
    await sendText(waId, out.text);
    await saveHistory(userId, [...link.history, { role: 'assistant', content: out.summary }]);
    return undefined;
  } catch (err) {
    console.error('[whatsapp] confirm failed:', err);
    return sendText(waId, 'No pude completar la acción.');
  }
}
