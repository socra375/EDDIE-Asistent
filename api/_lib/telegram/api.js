// Thin client for the Telegram Bot API. TELEGRAM_BOT_TOKEN never leaves the
// server. Every call returns { ok, data } and never throws, so one failed
// message can't take the whole webhook down.
import { fetchJson } from '../connectors/http.js';

const MAX_TEXT = 4000; // Telegram's limit is 4096 characters per message

function base() {
  return `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;
}

export async function tg(method, payload = {}) {
  const { ok, data } = await fetchJson(`${base()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 10000,
    retries: 0,
  });
  return { ok: Boolean(ok && data?.ok), data: data?.result ?? null, error: data?.description };
}

// Long answers go out in pieces, breaking at paragraph/sentence boundaries.
export function splitMessage(text, max = MAX_TEXT) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('\n', max);
    if (cut < max / 2) cut = rest.lastIndexOf('. ', max) + 1;
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// Plain text on purpose: Eddie's answers are not Markdown (see personality.js).
// `extra` carries reply_markup (inline buttons) for the last piece.
export async function sendMessage(chatId, text, extra = {}) {
  const pieces = splitMessage(text);
  let last = { ok: false, data: null };
  for (let i = 0; i < pieces.length; i += 1) {
    const isLast = i === pieces.length - 1;
    last = await tg('sendMessage', { chat_id: chatId, text: pieces[i], disable_web_page_preview: true, ...(isLast ? extra : {}) });
  }
  return last;
}

export const editMessage = (chatId, messageId, text, extra = {}) =>
  tg('editMessageText', { chat_id: chatId, message_id: messageId, text: splitMessage(text)[0] || '…', disable_web_page_preview: true, ...extra });

export const answerCallback = (id, text = '') => tg('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 180) });

export const sendAction = (chatId, action = 'typing') => tg('sendChatAction', { chat_id: chatId, action });

// Eddie's voice, as a voice message. MP3 is accepted by sendVoice.
export async function sendVoice(chatId, audio, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, 200));
  form.append('voice', new Blob([audio], { type: 'audio/mpeg' }), 'eddie.mp3');
  try {
    const res = await fetch(`${base()}/sendVoice`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => null);
    return { ok: Boolean(res.ok && data?.ok) };
  } catch {
    return { ok: false };
  }
}

// A voice note the user sent: file_id -> bytes. Telegram bots can download
// files up to 20 MB, far above what a spoken message weighs.
export async function downloadFile(fileId) {
  const info = await tg('getFile', { file_id: fileId });
  if (!info.ok || !info.data?.file_path) return null;
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${info.data.file_path}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

let usernameCache = '';
export async function botUsername() {
  if (usernameCache) return usernameCache;
  const me = await tg('getMe');
  usernameCache = me.data?.username || '';
  return usernameCache;
}

export const COMMANDS = [
  { command: 'llamar', description: 'Llamar a Eddie: abre su pantalla de voz' },
  { command: 'voz', description: 'Que Eddie conteste con su voz (on/off)' },
  { command: 'nuevo', description: 'Empezar una conversación nueva' },
  { command: 'ayuda', description: 'Qué puede hacer Eddie por aquí' },
  { command: 'desvincular', description: 'Desconectar este chat de tu cuenta' },
];

// Registers everything Telegram needs to know about the bot: the webhook
// (with the secret Telegram must echo back), the command list, and the menu
// button that opens Eddie's own screen inside Telegram. Idempotent and cached
// for the life of the function instance.
let setupKey = '';
export async function ensureBotSetup({ appUrl, secret }) {
  const webhookUrl = `${appUrl.replace(/\/+$/, '')}/api/connectors/telegram/webhook`;
  const key = `${webhookUrl}|${secret}`;
  if (setupKey === key) return { ok: true, webhookUrl };
  const info = await tg('getWebhookInfo');
  if (!info.ok) return { ok: false, error: 'Telegram no respondió (¿TELEGRAM_BOT_TOKEN es correcto?).' };
  if (info.data?.url !== webhookUrl) {
    const set = await tg('setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    if (!set.ok) return { ok: false, error: `Telegram no aceptó el webhook: ${set.error || 'error desconocido'}.` };
  }
  await tg('setMyCommands', { commands: COMMANDS });
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Llamar a Eddie', web_app: { url: appUrl } } });
  setupKey = key;
  return { ok: true, webhookUrl };
}
