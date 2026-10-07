// What Eddie sends to the user's Telegram from the app: only RESULTS, not the
// conversation. He chats and asks as usual in the app and, when a job ends in
// something worth keeping (a report, a draft, a plan, a week's agenda), he
// sends it with the `send_to_telegram` tool so the chat stays light; the
// pictures he creates go along too. Greetings, thanks and short answers stay in
// the app. The text also goes into the Telegram thread's own history, so the
// user can keep going from there ("hazlo más corto") with Eddie knowing it.
import { sendMessage, sendPhoto } from './api.js';
import { getLinkByUser, saveHistory } from './store.js';
import { getMediaFile } from '../media/store.js';

const MAX_TITLE = 100;
const MAX_CONTENT = 12000;

// → { sent: true } | { sent: false, reason: 'unavailable' | 'not-linked' | 'failed' | 'empty' }
export async function sendDeliverable({ userId, title = '', content = '' }) {
  try {
    if (!userId || !process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) return { sent: false, reason: 'unavailable' };
    const body = String(content).trim().slice(0, MAX_CONTENT);
    if (!body) return { sent: false, reason: 'empty' };
    const link = await getLinkByUser(userId);
    if (!link) return { sent: false, reason: 'not-linked' };
    const head = String(title).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
    const text = head ? `📄 ${head}\n\n${body}` : body;
    const result = await sendMessage(link.chatId, text);
    if (!result.ok) return { sent: false, reason: 'failed' };
    // Keeps the thread coherent: the next message from Telegram knows what arrived.
    const history = [...link.history];
    if (!history.length || history[history.length - 1].role === 'assistant') history.push({ role: 'user', content: `Pedí en la app: ${head || 'un resultado'}` });
    await saveHistory(userId, [...history, { role: 'assistant', content: text }]).catch(() => {});
    return { sent: true };
  } catch (err) {
    console.error('[telegram] sending the result failed:', err.message);
    return { sent: false, reason: 'failed' };
  }
}

// The pictures a set of actions created (`show_image`), sent to a Telegram chat as photos.
// `userId` owns them: only their own gallery is ever read. Returns how many went out.
export async function sendCreatedImages(userId, chatId, actions, { max = 3 } = {}) {
  let sent = 0;
  try {
    const ids = (Array.isArray(actions) ? actions : []).filter((a) => a?.type === 'show_image' && /^[0-9a-f-]{36}$/i.test(String(a.id || ''))).map((a) => a.id);
    for (const id of [...new Set(ids)].slice(0, max)) {
      const file = await getMediaFile(userId, id);
      if (!file) continue;
      const result = await sendPhoto(chatId, file.buffer, { caption: file.prompt, mime: file.mime });
      if (result.ok) sent += 1;
    }
  } catch (err) {
    console.error('[telegram] sending the pictures failed:', err.message);
  }
  return sent;
}

// The same, for the app: looks up the user's linked chat.
export async function mirrorImagesToTelegram({ userId, actions }) {
  try {
    if (!userId || !process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) return 0;
    if (!(Array.isArray(actions) && actions.some((a) => a?.type === 'show_image'))) return 0;
    const link = await getLinkByUser(userId);
    return link ? await sendCreatedImages(userId, link.chatId, actions) : 0;
  } catch (err) {
    console.error('[telegram] mirroring the pictures failed:', err.message);
    return 0;
  }
}
