// Everything Eddie answers in the app also reaches the user's Telegram (drafts,
// tasks, agenda, edits…), so it is at hand on the phone: the answer, a line for
// each thing he did, and a note when a card is waiting for their OK in the app.
// The text also goes into the chat's own thread, so they can keep going from
// Telegram ("hazlo más corto") with Eddie knowing what was said. Best effort:
// never throws and never makes the app's answer wait long.
import { sendMessage } from './api.js';
import { getLinkByUser, saveHistory } from './store.js';

const MAX_RECEIPTS = 5;

export function mirrorText({ answer = '', steps = [], confirmations = [] }) {
  const text = String(answer).trim();
  const receipts = [];
  for (const step of steps) {
    const summary = typeof step?.summary === 'string' ? step.summary.trim() : '';
    if (step?.status === 'done' && summary && !text.includes(summary) && !receipts.includes(summary)) receipts.push(summary);
  }
  const lines = [text];
  if (receipts.length) lines.push(receipts.slice(0, MAX_RECEIPTS).map((r) => `✓ ${r}`).join('\n'));
  const waiting = confirmations.map((c) => String(c?.label || c?.preview?.title || '').trim()).filter(Boolean);
  if (waiting.length) lines.push(`⏳ Falta tu confirmación en la app: ${waiting.slice(0, 3).join(' · ')}`);
  return lines.filter(Boolean).join('\n\n');
}

export async function mirrorToTelegram({ userId, question = '', answer = '', steps = [], confirmations = [] }) {
  try {
    if (!userId || !process.env.TELEGRAM_BOT_TOKEN || !process.env.DATABASE_URL) return false;
    const text = mirrorText({ answer, steps, confirmations });
    if (!text) return false;
    const link = await getLinkByUser(userId);
    if (!link) return false;
    const sent = await sendMessage(link.chatId, text);
    if (!sent.ok) return false;
    const asked = String(question).trim();
    if (asked && answer.trim()) await saveHistory(userId, [...link.history, { role: 'user', content: asked }, { role: 'assistant', content: answer.trim() }]);
    return true;
  } catch (err) {
    console.error('[telegram] mirroring the answer failed:', err.message);
    return false;
  }
}
