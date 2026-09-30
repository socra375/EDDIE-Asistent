// Eddie on Telegram. One webhook receives every update; a linked chat talks
// to the very same brain as the web app — same providers, tools, memory and
// tasks — and Eddie answers in text, and with its own voice when the user
// spoke to it (a voice note in, a voice note out: the closest thing to a
// call a bot can do; Telegram bots cannot place or receive phone calls).
import { timingSafeEqual } from 'node:crypto';
import { callProvider } from '../providers.js';
import { confirmTool } from '../connectors/registry.js';
import { sanitizeConnectorIds } from '../handler.js';
import { transcribeAudio, MAX_AUDIO_BYTES } from '../transcribe.js';
import { synthesizeSpeech, MAX_SPEECH_CHARS } from '../speech.js';
import { buildSystemPrompt } from '../../../src/services/personality.js';
import { sendMessage, editMessage, answerCallback, sendAction, sendVoice, downloadFile, tg } from './api.js';
import { consumeLinkCode, getLinkByChat, deleteLink, setVoiceReplies, saveHistory, markUpdateSeen, addPending, takePending, latestPending } from './store.js';
import { loadUserContext, applyActionsForUser } from './serverActions.js';
import { safeYoutubeUrl } from '../connectors/youtube/index.js';

const ALLOWED_PROVIDERS = new Set(['gemini', 'claude', 'groq', 'openrouter']);

const NOT_LINKED =
  'Hola, soy Eddie. Este chat todavía no está vinculado a tu cuenta.\n\nAbre la app de Eddie → Conectores → Telegram → "Vincular Telegram" y pulsa el enlace que te dará.';

const HELP = [
  'Soy Eddie, el mismo de la app, ahora en tu Telegram.',
  '',
  '• Escríbeme o mándame una nota de voz: te contesto con mi voz.',
  '• Puedo mirar tu agenda y tus correos, crear tareas, recordar cosas, buscar en internet, revisar tus repos…',
  '• Lo delicado (enviar un correo, borrar algo) te llega con botones ✅ / ✖ para que tú decidas.',
  '',
  'Comandos:',
  '/llamar — abre mi pantalla de voz dentro de Telegram',
  '/voz on|off — que conteste siempre con voz, aunque me escribas',
  '/nuevo — empezar una conversación nueva',
  '/desvincular — desconectar este chat de tu cuenta',
].join('\n');

// What the model needs to know about this surface.
const TELEGRAM_NOTE =
  'Estás conversando con el usuario por Telegram, desde su teléfono: responde corto y directo (unas pocas frases), sin Markdown. Si te habla por nota de voz, contesta como si hablaras: frases cortas y naturales, sin listas ni enlaces. Las acciones delicadas le llegan como botones ✅ / ✖ en el chat.';

const YES_RE = /^(si|sip|claro|dale|ok|okey|vale|de acuerdo|adelante|hazlo|procede|confirmo|confirmado|confirmalo|confirma|borrala|borralo|envialo|enviala|si por favor|si hazlo|si dale|si confirmo)$/;
const NO_RE = /^(no|nop|cancela|cancelar|cancelalo|cancelala|dejalo|dejala|mejor no|olvidalo|no gracias|no lo hagas|para)$/;

function normalizeReply(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(eddie )+|( eddie)+$/g, '');
}

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
  try {
    if (await markUpdateSeen(update.update_id)) await processUpdate(update);
  } catch (err) {
    console.error('[telegram] update failed:', err);
  }
  return { status: 200, json: { ok: true } };
}

async function processUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  // Private chats only: Eddie answers nobody in a group.
  if (!msg || msg.chat?.type !== 'private' || msg.from?.is_bot) return undefined;
  const chatId = msg.chat.id;
  const text = String(msg.text || '').trim();

  const command = /^\/([a-z_]+)(?:@\w+)?(?:\s+(.*))?$/i.exec(text);
  if (command && command[1].toLowerCase() === 'start') return handleStart(chatId, (command[2] || '').trim());

  const link = await getLinkByChat(chatId);
  if (!link) return sendMessage(chatId, NOT_LINKED);
  if (command) return handleCommand(link, command[1].toLowerCase(), (command[2] || '').trim());

  let userText = text;
  let viaVoice = false;
  const voice = msg.voice || msg.audio;
  if (voice) {
    viaVoice = true;
    userText = await transcribeVoice(chatId, voice);
    if (!userText) return undefined;
  } else if (!text) {
    return sendMessage(chatId, 'Por ahora entiendo texto y notas de voz.');
  }

  // "Sí" / "no" after a confirmation card answers it, same as in the app.
  const pendingId = await latestPending(chatId);
  if (pendingId) {
    const reply = normalizeReply(userText);
    const decision = YES_RE.test(reply) ? 'ok' : NO_RE.test(reply) ? 'no' : null;
    if (decision) return resolvePending(link, pendingId, decision, null);
  }
  return runAssistant(link, userText, viaVoice);
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

// Text that reads well aloud: no links, symbols or emoji.
export function speakable(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_`#>~|]+/g, '')
    .replace(/✓|✔|✅|✖|🎙|📞|▶/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Eddie's voice for the start of the answer (one request is capped, so a long
// answer is voiced up to its last whole sentence within the cap; the full text
// always goes out as a message too).
async function voiceFor(text, language) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  let clean = speakable(text);
  if (!clean) return null;
  if (clean.length > MAX_SPEECH_CHARS) {
    const cut = Math.max(clean.lastIndexOf('. ', MAX_SPEECH_CHARS), clean.lastIndexOf('? ', MAX_SPEECH_CHARS), clean.lastIndexOf('! ', MAX_SPEECH_CHARS));
    clean = cut > 100 ? clean.slice(0, cut + 1) : clean.slice(0, MAX_SPEECH_CHARS);
  }
  try {
    const res = await synthesizeSpeech({ text: clean, language });
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error('[telegram] voice failed:', err.message);
    return null;
  }
}

function cardText(confirmation) {
  const { preview = {} } = confirmation;
  const lines = [preview.title || confirmation.label];
  for (const f of preview.fields || []) lines.push(`${f.label}: ${String(f.value ?? '').slice(0, 300)}`);
  lines.push('', '¿Lo hago? (Para cambiar algo, dímelo y lo preparo de nuevo.)');
  return lines.join('\n');
}

async function runAssistant(link, text, viaVoice) {
  const { chatId, userId } = link;
  const wantsVoice = viaVoice || link.voiceReplies;
  await sendAction(chatId, wantsVoice ? 'record_voice' : 'typing');
  const typing = setInterval(() => sendAction(chatId, wantsVoice ? 'record_voice' : 'typing'), 4000);
  try {
    const ctx = await loadUserContext(userId);
    const s = ctx.settings;
    const provider = ALLOWED_PROVIDERS.has(s.provider) ? s.provider : 'gemini';
    const model = typeof s.model === 'string' && s.model.length < 100 ? s.model : undefined;
    const language = /^[a-z]{2}$/.test(s.language || '') ? s.language : 'es';
    const off = sanitizeConnectorIds(s.disabledConnectors);
    const disabledConnectors = ctx.memoryOn ? off : [...new Set([...off, 'memory'])];
    const system = `${buildSystemPrompt({
      mode: 'asistente',
      language,
      memory: ctx.memoryOn ? ctx.memory : null,
      query: text,
      tasks: ctx.tasks,
      disabledConnectors: off,
    })}\n\n${TELEGRAM_NOTE}`;
    const messages = [...link.history, { role: 'user', content: text }].map((m) => ({ role: m.role, content: String(m.content) }));

    // The answer arrives as pieces through onChunk (the result only carries
    // the metadata), same as the web stream.
    let answer = '';
    const result = await callProvider({
      provider,
      model,
      system,
      messages,
      context: { timezone: link.timezone, tasks: ctx.toolTasks, memory: ctx.memoryForTools, getUser: async () => link.user },
      disabledConnectors,
      onChunk: (piece) => {
        answer += piece;
      },
    });

    const changes = await applyActionsForUser(userId, result.actions, { memoryEnabled: ctx.memoryOn });
    let reply = answer.trim() || (result.confirmations?.length ? 'Necesito tu confirmación:' : 'Listo.');
    const receipt = changes.length ? `\n\n${changes.map((c) => `✓ ${c}`).join('\n')}` : '';
    await sendMessage(chatId, reply + receipt);

    for (const c of result.confirmations || []) {
      const id = await addPending(userId, chatId, { tool: c.tool, args: c.args, label: c.label });
      await sendMessage(chatId, cardText(c), {
        reply_markup: { inline_keyboard: [[{ text: `✅ ${c.preview?.confirmLabel || 'Confirmar'}`, callback_data: `ok:${id}` }, { text: '✖ Cancelar', callback_data: `no:${id}` }]] },
      });
    }

    // Pages Eddie meant to open (YouTube): a bot can't open a browser, so the
    // link goes out with a button that opens it on the phone (or in the app).
    for (const action of (result.actions || []).filter((a) => a?.type === 'open_url' || a?.type === 'play_video').slice(0, 2)) {
      const url = safeYoutubeUrl(action.url);
      const label = action.type === 'play_video' ? `${action.title || 'Video'}${action.channel ? ` · ${action.channel}` : ''}` : action.label || 'YouTube';
      if (url) await sendMessage(chatId, `▶ ${String(label).slice(0, 100)}`, { reply_markup: { inline_keyboard: [[{ text: action.type === 'play_video' ? '▶ Reproducir' : '▶ Abrir', url }]] } });
    }

    if (wantsVoice) {
      const audio = await voiceFor(reply, language);
      if (audio) await sendVoice(chatId, audio);
    }
    reply = reply + receipt;
    await saveHistory(userId, [...link.history, { role: 'user', content: text }, { role: 'assistant', content: reply }]);
  } catch (err) {
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
    const ctx = await loadUserContext(userId);
    const off = sanitizeConnectorIds(ctx.settings.disabledConnectors);
    const out = await confirmTool({
      name: pending.tool,
      args: pending.args,
      disabled: ctx.memoryOn ? off : [...new Set([...off, 'memory'])],
      context: { timezone: link.timezone, tasks: ctx.toolTasks, memory: ctx.memoryForTools, getUser: async () => link.user },
    });
    if (out.error) return finish(`No pude hacerlo: ${out.error}`);
    const changes = await applyActionsForUser(userId, out.actions, { memoryEnabled: ctx.memoryOn });
    const summary = out.result?.summary || 'Listo, hecho.';
    const text = `✅ ${summary}${changes.length ? `\n${changes.map((c) => `✓ ${c}`).join('\n')}` : ''}`;
    await finish(text);
    await saveHistory(userId, [...link.history, { role: 'assistant', content: summary }]);
    return undefined;
  } catch (err) {
    console.error('[telegram] confirm failed:', err);
    return finish('No pude completar la acción.');
  }
}

export { tg };
