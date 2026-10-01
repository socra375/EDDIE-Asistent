// The scheduled job behind GET /api/connectors/cron: sends the reminders
// whose time has come and the morning summaries due now, all on Telegram.
//
// It is safe to call as often as you like, and from several places at once:
// every reminder and every summary-day is claimed with one atomic update
// before it is sent, so nothing goes out twice.
import { sendMessage } from '../telegram/api.js';
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

export async function runScheduledJobs({ now = new Date(), send = sendMessage } = {}) {
  const result = { reminders: 0, briefings: 0, failed: 0 };

  for (const reminder of await dueReminders()) {
    if (!(await claimReminder(reminder.id))) continue;
    const res = await send(reminder.chatId, reminderText(reminder, now));
    if (res?.ok) result.reminders += 1;
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
      const res = await send(b.chatId, text);
      if (!res?.ok) throw new Error('Telegram no aceptó el mensaje');
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
