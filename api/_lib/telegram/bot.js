// Eddie on Telegram. One webhook receives every update; a linked chat talks
// to the very same brain as the web app — same providers, tools, memory and
// tasks — and Eddie answers in text, and with its own voice when the user
// spoke to it (a voice note in, a voice note out: the closest thing to a
// call a bot can do; Telegram bots cannot place or receive phone calls).
import { timingSafeEqual } from 'node:crypto';
import { transcribeAudio, MAX_AUDIO_BYTES } from '../transcribe.js';
import { sendMessage, editMessage, answerCallback, sendAction, sendVoice, downloadFile, tg } from './api.js';
import { consumeLinkCode, getLinkByChat, deleteLink, setVoiceReplies, saveHistory, markEpisodeSaved, markUpdateSeen, addPending, takePending, latestPending } from './store.js';
import { askEddie, runConfirmed } from '../channels/brain.js';
import { IMAGE_PROMPT, MAX_IMAGE_BYTES, cardText, closeConversation as closeThread, decisionFromText, speakable, voiceFor } from '../channels/common.js';
import { safeYoutubeUrl } from '../connectors/youtube/index.js';
import { buildBriefing } from '../reminders/briefing.js';
import { listPendingReminders } from '../reminders/store.js';
import { whenLabel } from '../connectors/reminders/index.js';
import { restoreTanda, takeRequest, usageFor, usageLine } from '../usage/store.js';
import { sendCreatedImages } from './mirror.js';

const NOT_LINKED =
  'Hola, soy Eddie. Este chat todavía no está vinculado a tu cuenta.\n\nAbre la app de Eddie → Conectores → Telegram → "Vincular Telegram" y pulsa el enlace que te dará.';

const HELP = [
  'Soy Eddie, el mismo de la app, ahora en tu Telegram.',
  '',
  '• Escríbeme o mándame una nota de voz: te contesto con mi voz.',
  '• Mándame una foto (con o sin pregunta) y te digo qué veo.',
  '• Puedo mirar tu agenda y tus correos, crear tareas, recordar cosas, buscar en internet, revisar tus repos…',
  '• Pídeme que te avise de algo ("recuérdame llamar a mamá a las 5") y te escribo a esa hora.',
  '• Lo delicado (enviar un correo, borrar algo) te llega con botones ✅ / ✖ para que tú decidas.',
  '',
  'Comandos:',
  '/llamar — abre mi pantalla de voz dentro de Telegram',
  '/voz on|off — que conteste siempre con voz, aunque me escribas',
  '/resumen — el resumen de tu día ahora mismo',
  '/recordatorios — tus avisos pendientes',
  '/uso — cuántas peticiones llevas en esta tanda (mañana / tarde)',
  '/restaurar — devolverle a la tanda actual todo su cupo',
  '/nuevo — empezar una conversación nueva',
  '/desvincular — desconectar este chat de tu cuenta',
].join('\n');

// Conversation memory for this thread (see channels/common.js).
const closeConversation = (link, options) => closeThread(link, { source: 'telegram', markSaved: markEpisodeSaved, ...options });

// What the model needs to know about this surface.
const TELEGRAM_NOTE =
  'Estás conversando con el usuario por Telegram, desde su teléfono: responde corto y directo (unas pocas frases), sin Markdown. Si te habla por nota de voz, contesta como si hablaras: frases cortas y naturales, sin listas ni enlaces. Las acciones delicadas le llegan como botones ✅ / ✖ en el chat.';

function secretMatches(headers) {
  const expected = Buffer.from(String(process.env.TELEGRAM_WEBHOOK_SECRET || ''));
  const got = Buffer.from(String(headers['x-telegram-bot-api-secret-token'] || ''));
  return expected.length > 0 && expected.length === got.length && timingSafeEqual(expected, got);
}

// Entry point for POST /api/connectors/telegram/webhook. Always answers 200
// once the secret checks out — a non-2xx makes Telegram retry the same update.
export async function handleWebhook({ headers = {}, body }) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET || !process.env.DATABASE_URL) {
    return { status: 503, json: { error: 'Telegram no está configurado.' } };
  }
  if (!secretMatches(headers)) return { status: 401, json: { error: 'No autorizado.' } };
  const update = body && typeof body === 'object' ? body : null;
  if (!update || !Number.isSafeInteger(update.update_id)) return { status: 200, json: { ok: true } };
  const startedAt = Date.now();
  try {
    if (await markUpdateSeen(update.update_id)) await processUpdate(update, startedAt);
  } catch (err) {
    console.error('[telegram] update failed:', err);
  }
  return { status: 200, json: { ok: true } };
}

async function processUpdate(update, startedAt = Date.now()) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  // Private chats only: Eddie answers nobody in a group.
  if (!msg || msg.chat?.type !== 'private' || msg.from?.is_bot) return undefined;
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();
  const photo = pickPhoto(msg);

  const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(text);
  if (command && command[1].toLowerCase() === 'start') return handleStart(chatId, (command[2] || '').trim());

  const link = await getLinkByChat(chatId);
  if (!link) return sendMessage(chatId, NOT_LINKED);
  if (command) return handleCommand(link, command[1].toLowerCase(), (command[2] || '').trim());

  let userText = text;
  let viaVoice = false;
  let images = [];
  const voice = msg.voice || msg.audio;
  if (voice) {
    viaVoice = true;
    userText = await transcribeVoice(chatId, voice);
    if (!userText) return undefined;
  } else if (photo) {
    images = await downloadImage(chatId, photo);
    if (!images.length) return undefined;
    userText = String(msg.caption || '').trim() || IMAGE_PROMPT;
  } else if (msg.document && !text) {
    return sendMessage(chatId, 'Para que vea una imagen, mándala como foto (JPG, PNG, WebP o GIF de hasta unos 900 KB).');
  } else if (!text) {
    return sendMessage(chatId, 'Por ahora entiendo texto, fotos y notas de voz.');
  }

  // "Sí" / "no" after a confirmation card answers it, same as in the app.
  const pendingId = await latestPending(chatId);
  if (pendingId) {
    const decision = decisionFromText(userText);
    if (decision) return resolvePending(link, pendingId, decision, null);
  }
  return runAssistant(link, userText, viaVoice, images, startedAt);
}

// A photo (Telegram sends several sizes, smallest first) or an image sent as
// a file, when it is one Eddie can read.
const IMAGE_MIME = /^image\/(jpeg|png|webp|gif)$/;

export function pickPhoto(msg) {
  if (Array.isArray(msg.photo) && msg.photo.length) {
    const fits = msg.photo.filter((p) => !p.file_size || p.file_size <= MAX_IMAGE_BYTES);
    const best = fits.at(-1) || msg.photo[0];
    return { file_id: best.file_id, file_size: best.file_size, mime_type: 'image/jpeg' };
  }
  const doc = msg.document;
  if (doc && IMAGE_MIME.test(doc.mime_type || '') && (!doc.file_size || doc.file_size <= MAX_IMAGE_BYTES)) return { file_id: doc.file_id, file_size: doc.file_size, mime_type: doc.mime_type };
  return null;
}

async function downloadImage(chatId, photo) {
  await sendAction(chatId, 'typing');
  const bytes = await downloadFile(photo.file_id);
  if (!bytes) {
    await sendMessage(chatId, 'No pude descargar tu foto. Inténtalo otra vez.');
    return [];
  }
  if (bytes.length > MAX_IMAGE_BYTES) {
    await sendMessage(chatId, 'Esa imagen es muy pesada para que la vea. Mándala como foto normal (comprimida).');
    return [];
  }
  return [{ mimeType: photo.mime_type, data: Buffer.from(bytes).toString('base64') }];
}

async function handleStart(chatId, arg) {
  if (!arg) {
    const link = await getLinkByChat(chatId);
    return sendMessage(chatId, link ? `Aquí estoy, ${link.user.name?.split(' ')[0] || 'listo'}. Escríbeme o mándame una nota de voz.\n\n${HELP}` : NOT_LINKED);
  }
  const code = arg.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const userId = await consumeLinkCode(code, chatId);
  if (!userId) return sendMessage(chatId, 'Ese código no es válido o ya caducó. Genera uno nuevo en la app (Conectores → Telegram → Vincular).');
  const link = await getLinkByChat(chatId);
  const name = link?.user?.name?.split(' ')[0];
  return sendMessage(chatId, `Listo${name ? `, ${name}` : ''}: este chat ya es tuyo. Desde aquí puedes escribirme o mandarme notas de voz, y usar el botón "Llamar a Eddie".\n\n${HELP}`);
}

async function handleCommand(link, name, arg) {
  const { chatId } = link;
  if (name === 'ayuda' || name === 'help') return sendMessage(chatId, HELP);
  if (name === 'nuevo') {
    await closeConversation(link, { force: true });
    await saveHistory(link.userId, []);
    return sendMessage(chatId, 'Conversación nueva. ¿En qué te ayudo?');
  }
  if (name === 'voz') {
    const a = arg.toLowerCase();
    const on = a === 'on' || a === 'si' || a === 'sí' ? true : a === 'off' || a === 'no' ? false : !link.voiceReplies;
    await setVoiceReplies(link.userId, on);
    return sendMessage(chatId, on ? 'Listo: te contesto siempre con mi voz.' : 'Listo: solo te contesto con voz cuando tú me mandes una nota de voz.');
  }
  if (name === 'llamar') {
    const appUrl = process.env.APP_URL;
    if (!appUrl || !/^https:\/\//.test(appUrl)) return sendMessage(chatId, 'Para llamar a Eddie desde aquí, falta configurar APP_URL (con https) en Vercel. Mientras tanto, mándame una nota de voz.');
    return sendMessage(chatId, 'Toca el botón y háblame: se abre mi pantalla de voz dentro de Telegram. (Si tu teléfono no deja usar el micrófono ahí, mándame una nota de voz y te contesto igual.)', {
      reply_markup: { inline_keyboard: [[{ text: '📞 Llamar a Eddie', web_app: { url: appUrl } }]] },
    });
  }
  if (name === 'resumen') {
    await sendAction(chatId, 'typing');
    try {
      return await sendMessage(chatId, await buildBriefing(link));
    } catch (err) {
      console.error('[telegram] briefing failed:', err);
      return sendMessage(chatId, 'No pude armar tu resumen ahora. Inténtalo de nuevo en un momento.');
    }
  }
  if (name === 'recordatorios') {
    const pending = await listPendingReminders(link.userId);
    if (!pending.length) return sendMessage(chatId, 'No tienes recordatorios pendientes. Pídeme uno, por ejemplo: "recuérdame llamar a mamá a las 5".');
    return sendMessage(chatId, ['Tus recordatorios pendientes:', ...pending.slice(0, 20).map((r) => `• ${whenLabel(r.dueAt, link.timezone)} — ${r.text}`)].join('\n'));
  }
  if (name === 'uso' || name === 'restaurar') {
    const usage = name === 'restaurar' ? await restoreTanda(link.userId, { timezone: link.timezone }) : await usageFor(link.userId, { timezone: link.timezone });
    return sendMessage(chatId, `${name === 'restaurar' ? 'Listo, restauré la tanda actual.\n' : ''}${usageLine(usage)}`);
  }
  if (name === 'desvincular') {
    await deleteLink(link.userId);
    return sendMessage(chatId, 'Chat desvinculado. Ya no respondo aquí hasta que lo vincules de nuevo desde la app.');
  }
  return sendMessage(chatId, 'No conozco ese comando. Prueba /ayuda.');
}

// Voice note -> text with Whisper (the same transcription as the web app).
async function transcribeVoice(chatId, voice) {
  if (voice.file_size && voice.file_size > MAX_AUDIO_BYTES) {
    await sendMessage(chatId, 'Esa nota de voz es muy larga para transcribirla. Mándame fragmentos más cortos.');
    return '';
  }
  await sendAction(chatId, 'typing');
  const audio = await downloadFile(voice.file_id);
  if (!audio) {
    await sendMessage(chatId, 'No pude descargar tu nota de voz. Inténtalo otra vez.');
    return '';
  }
  try {
    const { text } = await transcribeAudio({ audio, mimeType: voice.mime_type || 'audio/ogg', language: 'es' });
    if (!text) {
      await sendMessage(chatId, 'No te entendí bien. ¿Me lo repites?');
      return '';
    }
    await sendMessage(chatId, `🎙 “${text}”`);
    return text;
  } catch (err) {
    await sendMessage(chatId, err.message || 'No pude transcribir tu nota de voz.');
    return '';
  }
}

// Vercel stops the function at 60 s without a word: the user gets an answer (or
// an honest "it took too long") before that, never silence.
const ANSWER_BUDGET_MS = Number.parseInt(process.env.TELEGRAM_ANSWER_BUDGET_MS, 10) || 54000;

function withDeadline(promise, ms) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise.then((value) => ({ value })), late]).finally(() => clearTimeout(timer));
}

async function runAssistant(link, text, viaVoice, images = [], startedAt = Date.now()) {
  const { chatId, userId } = link;
  // The day's allowance, split in tandas: past it Eddie says so instead of answering.
  const slot = await takeRequest(userId, { timezone: link.timezone });
  if (!slot.allowed) return sendMessage(chatId, slot.message);
  let replied = false;
  const wantsVoice = viaVoice || link.voiceReplies;
  await sendAction(chatId, wantsVoice ? 'record_voice' : 'typing');
  const typing = setInterval(() => sendAction(chatId, wantsVoice ? 'record_voice' : 'typing'), 4000);
  // The previous conversation, if it went cold, is kept while this answer is prepared.
  const closing = closeConversation(link);
  try {
    const outcome = await withDeadline(askEddie({ link, text, images, note: TELEGRAM_NOTE }), Math.max(8000, ANSWER_BUDGET_MS - (Date.now() - startedAt)));
    if (outcome.timedOut) {
      await closing;
      await slot.release();
      replied = true;
      return await sendMessage(chatId, '⏱ Esta vez tardé demasiado en pensar y no alcancé a responderte. No te descontó la petición: inténtalo de nuevo (si es algo largo, divídelo en partes).');
    }
    const { reply, receipt, confirmations, actions, language, voiceId } = outcome.value;
    replied = true;
    await sendMessage(chatId, reply + receipt);

    for (const c of confirmations) {
      const id = await addPending(userId, chatId, { tool: c.tool, args: c.args, label: c.label });
      await sendMessage(chatId, cardText(c), {
        reply_markup: { inline_keyboard: [[{ text: `✅ ${c.preview?.confirmLabel || 'Confirmar'}`, callback_data: `ok:${id}` }, { text: '✖ Cancelar', callback_data: `no:${id}` }]] },
      });
    }

    // Pages Eddie meant to open (YouTube): a bot can't open a browser, so the
    // link goes out with a button that opens it on the phone (or in the app).
    for (const action of actions.filter((a) => a?.type === 'open_url' || a?.type === 'play_video').slice(0, 2)) {
      const url = safeYoutubeUrl(action.url);
      const label = action.type === 'play_video' ? `${action.title || 'Video'}${action.channel ? ` · ${action.channel}` : ''}` : action.label || 'YouTube';
      if (url) await sendMessage(chatId, `▶ ${String(label).slice(0, 100)}`, { reply_markup: { inline_keyboard: [[{ text: action.type === 'play_video' ? '▶ Reproducir' : '▶ Abrir', url }]] } });
    }

    // Pictures Eddie made while answering go out as photos.
    await sendCreatedImages(userId, chatId, actions);

    if (wantsVoice) {
      const audio = await voiceFor(reply, language, 'telegram', voiceId);
      if (audio) await sendVoice(chatId, audio);
    }
    await closing;
    await saveHistory(userId, [...link.history, { role: 'user', content: images.length ? `📷 ${text}` : text }, { role: 'assistant', content: reply + receipt }]);
  } catch (err) {
    await closing;
    if (!replied) await slot.release();
    console.error('[telegram] assistant failed:', err);
    await sendMessage(chatId, `No pude completar eso: ${err.message || 'error inesperado'}.`);
  } finally {
    clearInterval(typing);
  }
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  const m = /^(ok|no):([0-9a-f-]{36})$/i.exec(cb.data || '');
  if (!chatId || !m) return answerCallback(cb.id);
  const link = await getLinkByChat(chatId);
  if (!link) return answerCallback(cb.id, 'Este chat no está vinculado.');
  return resolvePending(link, m[2], m[1].toLowerCase(), { callbackId: cb.id, messageId });
}

// Runs or cancels a confirmation, from its buttons (`via` set) or from a
// typed/spoken "sí" / "no".
async function resolvePending(link, pendingId, decision, via) {
  const { chatId, userId } = link;
  const pending = await takePending(pendingId, chatId);
  const finish = async (text) => {
    if (via?.messageId) await editMessage(chatId, via.messageId, text, { reply_markup: { inline_keyboard: [] } });
    else await sendMessage(chatId, text);
  };
  if (!pending || pending.user_id !== userId) {
    if (via) await answerCallback(via.callbackId, 'Esa acción ya se resolvió o caducó.');
    return finish('Esa acción ya se resolvió o caducó.');
  }
  if (decision === 'no') {
    if (via) await answerCallback(via.callbackId, 'Cancelado');
    return finish('Cancelado, no hice nada.');
  }
  if (via) await answerCallback(via.callbackId, 'Haciéndolo…');
  try {
    const out = await runConfirmed({ link, pending });
    if (out.error) return finish(`No pude hacerlo: ${out.error}`);
    await finish(out.text);
    await saveHistory(userId, [...link.history, { role: 'assistant', content: out.summary }]);
    return undefined;
  } catch (err) {
    console.error('[telegram] confirm failed:', err);
    return finish('No pude completar la acción.');
  }
}

export { tg, speakable };
