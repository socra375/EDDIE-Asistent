// The scheduled job behind GET /api/connectors/cron: sends the reminders
// whose time has come and the morning summaries due now, all on Telegram.
//
// It is safe to call as often as you like, and from several places at once:
// every reminder and every summary-day is claimed with one atomic update
// before it is sent, so nothing goes out twice.
import { sendMessage } from '../telegram/api.js';
import { sendPush } from '../push/send.js';
import { localParts } from '../connectors/dates.js';
import { buildBriefing } from './briefing.js';
import { claimBriefingDay, claimReminder, dueReminders, enabledBriefings, purgeOldReminders, releaseBriefingDay, releaseReminder } from './store.js';

// A summary that would arrive this long after its hour isn't sent (nobody
// wants the "morning" summary at 3 pm); the next day's goes out as usual.
const BRIEFING_WINDOW_MINUTES = 180;
// A reminder this late says so, instead of pretending to be on time.
const LATE_REMINDER_MINUTES = 15;

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

export function reminderText(reminder, now = new Date()) {
  const lateMs = now.getTime() - new Date(reminder.dueAt).getTime();
  if (lateMs > LATE_REMINDER_MINUTES * 60000) {
    return `⏰ Recordatorio (era para las ${localParts(reminder.dueAt, reminder.timezone).time}): ${reminder.text}`;
  }
  return `⏰ Recordatorio: ${reminder.text}`;
}

// Telegram only when it is configured: a push-only user must not hit its API.
const telegramSend = (chatId, text) => (process.env.TELEGRAM_BOT_TOKEN ? sendMessage(chatId, text) : { ok: false });

// What the notification on the phone says for a reminder.
export function reminderPush(reminder, now = new Date()) {
  const lateMs = now.getTime() - new Date(reminder.dueAt).getTime();
  const body = lateMs > LATE_REMINDER_MINUTES * 60000 ? `(era para las ${localParts(reminder.dueAt, reminder.timezone).time}) ${reminder.text}` : reminder.text;
  return { title: 'Recordatorio', body, url: '/', tag: `reminder-${reminder.id}` };
}

// The summary as a notification: its first lines, and a tap opens "Hoy".
export function briefingPush(text) {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const [head = 'Resumen de la mañana', ...rest] = lines;
  return { title: head.replace(/^[^\p{L}\p{N}]+/u, '') || 'Resumen de la mañana', body: rest.slice(0, 4).join(' · '), url: '/?modulo=hoy', tag: 'eddie-briefing' };
}

// Telegram (if linked) and the devices with notifications on: it counts as
// delivered if either one got it.
async function deliver({ userId, chatId }, text, notification, { send, push }) {
  let ok = false;
  if (chatId) ok = Boolean((await send(chatId, text))?.ok);
  const sent = await push(userId, notification).catch((err) => {
    console.error('[cron] push failed:', err.message);
    return null;
  });
  return ok || (sent?.sent ?? 0) > 0;
}

export async function runScheduledJobs({ now = new Date(), send = telegramSend, push = sendPush } = {}) {
  const result = { reminders: 0, briefings: 0, failed: 0 };

  for (const reminder of await dueReminders()) {
    if (!(await claimReminder(reminder.id))) continue;
    const delivered = await deliver(reminder, reminderText(reminder, now), reminderPush(reminder, now), { send, push });
    if (delivered) result.reminders += 1;
    else {
      await releaseReminder(reminder.id);
      result.failed += 1;
    }
  }

  for (const b of await enabledBriefings()) {
    let local;
    try {
      local = localParts(now.toISOString(), b.timezone);
    } catch {
      continue;
    }
    if (b.lastSentOn === local.date) continue;
    const late = toMinutes(local.time) - toMinutes(b.time);
    if (late < 0 || late > BRIEFING_WINDOW_MINUTES) continue;
    if (!(await claimBriefingDay(b.userId, local.date))) continue;
    try {
      const text = await buildBriefing(b, now);
      const delivered = await deliver(b, text, briefingPush(text), { send, push });
      if (!delivered) throw new Error('ni Telegram ni las notificaciones lo aceptaron');
      result.briefings += 1;
    } catch (err) {
      console.error('[cron] briefing failed:', err.message);
      await releaseBriefingDay(b.userId, local.date).catch(() => {});
      result.failed += 1;
    }
  }

  await purgeOldReminders().catch(() => {});
  return result;
}
