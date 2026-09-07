import { getValidAccessToken } from './googleCredentials.js';
import { requireUser } from './session.js';

async function calendarFetch(accessToken, path, options = {}) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'Google Calendar respondió con un error.');
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  return data;
}

export async function listUpcomingEvents(cookies) {
  const user = await requireUser(cookies);
  const accessToken = await getValidAccessToken(user.id);
  const timeMin = new Date().toISOString();
  const data = await calendarFetch(
    accessToken,
    `calendars/primary/events?timeMin=${encodeURIComponent(timeMin)}&maxResults=20&singleEvents=true&orderBy=startTime`,
  );
  const events = (data.items || []).map((e) => ({
    id: e.id,
    title: e.summary,
    start: e.start?.date || e.start?.dateTime,
    htmlLink: e.htmlLink,
  }));
  return { status: 200, json: { events } };
}

// Creates an all-day Calendar event from a task's due date. Google's
// all-day events use an exclusive end date, so it's set to the day after.
export async function createEventFromTask(cookies, body) {
  const user = await requireUser(cookies);
  if (!body?.title || !body?.dueDate) {
    const err = new Error('Se requiere un título y una fecha de entrega para crear el evento.');
    err.code = 'BAD_REQUEST';
    throw err;
  }
  const accessToken = await getValidAccessToken(user.id);
  const nextDay = new Date(`${body.dueDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const event = await calendarFetch(accessToken, 'calendars/primary/events', {
    method: 'POST',
    body: JSON.stringify({
      summary: body.title,
      description: 'Creado desde Eddie',
      start: { date: body.dueDate },
      end: { date: nextDay.toISOString().slice(0, 10) },
    }),
  });
  return { status: 200, json: { eventId: event.id, htmlLink: event.htmlLink } };
}
