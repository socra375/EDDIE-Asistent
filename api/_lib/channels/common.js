// Pieces every chat channel (Telegram) shares: understanding a
// typed "sí" / "no", making a reply fit to be spoken, Eddie's voice, the
// text of a confirmation card and closing a cold conversation into memory.
import { synthesizeSpeech, MAX_SPEECH_CHARS } from '../speech.js';
import { MAX_IMAGE_CHARS } from '../images.js';
import { loadUserContext } from '../telegram/serverActions.js';
import { saveConversation } from '../episodes/recall.js';
import { episodesEnabled } from '../episodes/handlers.js';

export const IMAGE_PROMPT = '¿Qué ves en esta imagen?';
// The most a picture may weigh to fit a request (see api/_lib/images.js).
export const MAX_IMAGE_BYTES = Math.floor((MAX_IMAGE_CHARS * 3) / 4) - 1000;

const YES_RE = /^(si|sip|claro|dale|ok|okey|vale|de acuerdo|adelante|hazlo|procede|confirmo|confirmado|confirmalo|confirma|borrala|borralo|envialo|enviala|si por favor|si hazlo|si dale|si confirmo)$/;
const NO_RE = /^(no|nop|cancela|cancelar|cancelalo|cancelala|dejalo|dejala|mejor no|olvidalo|no gracias|no lo hagas|para)$/;

export function normalizeReply(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(eddie )+|( eddie)+$/g, '');
}

// "ok" (yes), "no", or null when the text isn't an answer to a card.
export function decisionFromText(text) {
  const reply = normalizeReply(String(text || ''));
  return YES_RE.test(reply) ? 'ok' : NO_RE.test(reply) ? 'no' : null;
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
// always goes out as a message too). An MP3 buffer, or null.
// `voiceId` is the user's pick in Configuración; synthesizeSpeech only
// accepts it if it's one of the configured voices.
export async function voiceFor(text, language, tag = 'channel', voiceId) {
  if (!process.env.ELEVENLABS_API_KEY) return null;
  let clean = speakable(text);
  if (!clean) return null;
  if (clean.length > MAX_SPEECH_CHARS) {
    const cut = Math.max(clean.lastIndexOf('. ', MAX_SPEECH_CHARS), clean.lastIndexOf('? ', MAX_SPEECH_CHARS), clean.lastIndexOf('! ', MAX_SPEECH_CHARS));
    clean = cut > 100 ? clean.slice(0, cut + 1) : clean.slice(0, MAX_SPEECH_CHARS);
  }
  try {
    const res = await synthesizeSpeech({ text: clean, language, voiceId });
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(`[${tag}] voice failed:`, err.message);
    return null;
  }
}

export function cardText(confirmation) {
  const { preview = {} } = confirmation;
  const lines = [preview.title || confirmation.label];
  for (const f of preview.fields || []) lines.push(`${f.label}: ${String(f.value ?? '').slice(0, 300)}`);
  lines.push('', '¿Lo hago? (Para cambiar algo, dímelo y lo preparo de nuevo.)');
  return lines.join('\n');
}

// Conversation memory for a chat thread: once it has gone quiet for a while
// (or the user starts over), what was said is summarized and kept, so Eddie
// can bring it up later on the web or in any channel. Never fails the message
// that triggered it; a provider error leaves the thread unmarked so a later
// message retries. `link` carries { userId, history, historyAt, episodeSaved };
// `markSaved(userId)` is the channel's own "this thread is kept" update.
const COLD_MINUTES = 30;
const MIN_HISTORY_TO_KEEP = 4;

export async function closeConversation(link, { source, markSaved, force = false }) {
  try {
    if (link.episodeSaved !== false || link.history.length < MIN_HISTORY_TO_KEEP) return;
    if (!process.env.GEMINI_API_KEY) return;
    const idleMinutes = link.historyAt ? (Date.now() - new Date(link.historyAt).getTime()) / 60000 : 0;
    if (!force && !(idleMinutes > COLD_MINUTES)) return;
    const ctx = await loadUserContext(link.userId);
    if (episodesEnabled(ctx.settings)) await saveConversation({ userId: link.userId, messages: link.history, source });
    await markSaved(link.userId);
  } catch (err) {
    console.error(`[${source}] keeping the conversation failed:`, err.message);
  }
}
