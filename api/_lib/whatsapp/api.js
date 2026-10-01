// Thin client for Meta's WhatsApp Cloud API (Graph API). WHATSAPP_TOKEN never
// leaves the server. Calls return { ok, data, error } and never throw, so one
// failed message can't take the whole webhook down.
import { fetchJson } from '../connectors/http.js';

const MAX_TEXT = 3500; // WhatsApp allows 4096 characters per text message
const BUTTON_TITLE_MAX = 20; // WhatsApp's limit for a reply button
const BUTTON_BODY_MAX = 1000;

// Meta keeps each Graph API version for about two years; WHATSAPP_GRAPH_VERSION
// moves it without touching the code.
const graphBase = () => `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`;
const authHeader = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });
const phoneId = () => process.env.WHATSAPP_PHONE_NUMBER_ID;

export async function graph(path, { method = 'POST', body } = {}) {
  const { ok, status, data } = await fetchJson(`${graphBase()}/${path}`, {
    method,
    headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    timeoutMs: 10000,
    retries: 0,
  });
  return { ok: Boolean(ok), status, data, error: data?.error?.message };
}

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

const send = (to, message) => graph(`${phoneId()}/messages`, { body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message } });

// Plain text (Eddie's answers aren't Markdown); long ones go out in pieces.
export async function sendText(to, text, { previewUrl = false } = {}) {
  let last = { ok: false };
  for (const piece of splitMessage(text)) last = await send(to, { type: 'text', text: { body: piece, preview_url: previewUrl } });
  return last;
}

// A message with up to three reply buttons: [{ id, title }].
export function sendButtons(to, bodyText, buttons) {
  return send(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(bodyText).slice(0, BUTTON_BODY_MAX) },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: String(b.title).slice(0, BUTTON_TITLE_MAX) } })) },
    },
  });
}

// Eddie's voice: the MP3 is uploaded as media, then sent as an audio message.
export async function sendAudio(to, audio) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'audio/mpeg');
  form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'eddie.mp3');
  try {
    const res = await fetch(`${graphBase()}/${phoneId()}/media`, { method: 'POST', headers: authHeader(), body: form, signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.id) return { ok: false };
    return send(to, { type: 'audio', audio: { id: data.id } });
  } catch {
    return { ok: false };
  }
}

// Blue ticks and the "typing…" bubble while Eddie thinks. Decoration: errors ignored.
export function markRead(messageId) {
  return graph(`${phoneId()}/messages`, { body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } } });
}

// A media file the user sent (voice note, photo): id → { bytes, mimeType }, or null.
export async function downloadMedia(mediaId) {
  const info = await graph(String(mediaId).replace(/[^\w-]/g, ''), { method: 'GET' });
  if (!info.ok || !info.data?.url) return null;
  try {
    // Only Meta's own hosts, and the token only goes to them.
    const host = new URL(info.data.url).hostname;
    if (!/(^|\.)(facebook\.com|fbcdn\.net|whatsapp\.net|fbsbx\.com)$/.test(host)) return null;
    const res = await fetch(info.data.url, { headers: authHeader(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: info.data.mime_type || res.headers.get('content-type') || '' };
  } catch {
    return null;
  }
}

let numberCache = { value: '', at: 0 };
// Eddie's phone number (digits only), for the wa.me link in the app.
export async function displayNumber() {
  if (numberCache.value && Date.now() - numberCache.at < 3600000) return numberCache.value;
  const res = await graph(`${phoneId()}?fields=display_phone_number`, { method: 'GET' });
  const digits = String(res.data?.display_phone_number || '').replace(/\D/g, '');
  if (digits) numberCache = { value: digits, at: Date.now() };
  return digits;
}
