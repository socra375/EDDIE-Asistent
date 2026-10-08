// The meetings in the user's Google Calendar that the browser can open on its
// own: the next hours of events that carry a video-call link. The extension
// asks for this list every few minutes and sets one alarm per meeting, so the
// call opens at its time even when Eddie's tab is closed.
import { getValidAccessToken, hasGoogleCredentials } from '../googleCredentials.js';
import { clip, fetchJson } from '../connectors/http.js';
import { meetingProvider, safeHttpsUrl } from './urls.js';

const CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const URL_IN_TEXT = /https:\/\/[^\s<>"'\\)\]]+/g;
// Not meetings: the calendar's other kinds of event.
const NOT_MEETINGS = new Set(['outOfOffice', 'focusTime', 'workingLocation']);
// Events that started this long ago are still listed, so a meeting that began
// while the browser was closed can be joined when it opens.
const LOOK_BACK_MINUTES = 15;
const MAX_EVENTS = 30;

const unescapeHtml = (text) => String(text || '').replace(/&amp;/g, '&');

// { url, provider } for the video call of an event, or null. Google's own
// links (Meet) come first, then any video entry point, then the services named
// in the place or the description. Only the known meeting services count
// (Meet, Zoom, Teams, Webex…), wherever the link was found: whoever invites the
// user chooses an event's links, and one of them opens by itself at the start,
// so an address of any other site is never opened that way.
export function meetingLink(event) {
  const direct = [event?.hangoutLink, ...(event?.conferenceData?.entryPoints || []).filter((e) => e?.entryPointType === 'video').map((e) => e.uri)];
  const written = [event?.location, event?.description].flatMap((text) => (unescapeHtml(text).match(URL_IN_TEXT) || []).map((found) => found.replace(/[.,;:!?]+$/, '')));
  for (const raw of [...direct, ...written]) {
    const url = safeHttpsUrl(String(raw || ''));
    const provider = url ? meetingProvider(url) : null;
    if (url && provider) return { url, provider };
  }
  return null;
}

// One calendar event as a meeting to open, or null when it isn't one: no call
// link, an all-day or already-ended event, cancelled, or one the user declined.
export function shapeMeeting(event, now = new Date()) {
  if (!event || event.status === 'cancelled' || NOT_MEETINGS.has(event.eventType)) return null;
  if (!event.start?.dateTime) return null; // all-day
  if ((event.attendees || []).some((a) => a?.self && a.responseStatus === 'declined')) return null;
  const link = meetingLink(event);
  if (!link) return null;
  const startsAt = new Date(event.start.dateTime);
  const endsAt = new Date(event.end?.dateTime || event.start.dateTime);
  if (Number.isNaN(startsAt.getTime()) || endsAt.getTime() <= now.getTime()) return null;
  return {
    id: String(event.id || ''),
    title: clip(event.summary, 120) || 'Reunión',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    url: link.url,
    provider: link.provider,
  };
}

// → { meetings, reason? }. `reason` says why the list is empty when Google can't be read.
export async function upcomingMeetings(userId, { now = new Date(), hours = 24 } = {}) {
  if (!(await hasGoogleCredentials(userId))) return { meetings: [], reason: 'no_google' };
  let token;
  try {
    token = await getValidAccessToken(userId);
  } catch {
    return { meetings: [], reason: 'google_expired' };
  }
  const params = new URLSearchParams({
    timeMin: new Date(now.getTime() - LOOK_BACK_MINUTES * 60000).toISOString(),
    timeMax: new Date(now.getTime() + hours * 3600000).toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(MAX_EVENTS),
  });
  const { ok, status, data } = await fetchJson(`${CALENDAR}?${params}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 8000 });
  if (!ok) return { meetings: [], reason: status === 401 || status === 403 ? 'google_denied' : 'google_error' };
  return { meetings: (data?.items || []).map((e) => shapeMeeting(e, now)).filter(Boolean) };
}
