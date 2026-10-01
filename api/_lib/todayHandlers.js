// GET /api/connectors/today — everything the "Hoy" panel needs from the
// user's connected services in one request: today's and tomorrow's agenda
// (Google Calendar), unread mail that looks important (Gmail) and the day's
// headlines (Google News). Weather and tasks are read in the browser.
//
// The data comes from the same connector tools Eddie uses in the chat, so
// the panel and the assistant always agree and follow the same rules: a
// connector the user switched off in the hub isn't queried, and account data
// only flows with the user's own session.
import { createToolset } from './connectors/registry.js';
import { hasGmailAccess } from './googleCredentials.js';
import { sanitizeConnectorIds } from './handler.js';
import { lazySessionUser } from './session.js';
import { localParts } from './connectors/dates.js';

// Unread, recent, and not the bulk categories Gmail already sorts out: a
// decent stand-in for "important" that needs no extra permission.
const IMPORTANT_MAIL_QUERY = 'is:unread in:inbox -category:promotions -category:social -category:updates -category:forums newer_than:3d';

function validTimezone(value) {
  if (typeof value !== 'string' || value.length > 60) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

// One section's state, so the panel can explain itself when empty:
//   ok            data below
//   off           the user switched the connector off
//   needs_setup   the server lacks its configuration (keys, database)
//   needs_login   sign in with Google to see it
//   needs_connect signed in, but Gmail isn't connected yet
//   error         the service failed; `message` says why
async function section({ id, tool, args, disabled, toolset, user, extra }) {
  if (disabled.includes(id)) return { status: 'off' };
  if (!toolset.declarations.some((d) => d.name === tool)) return { status: 'needs_setup' };
  if (extra?.needsAccount) {
    if (!user) return { status: 'needs_login' };
    if (extra.check && !(await extra.check(user))) return { status: 'needs_connect' };
  }
  const result = await toolset.execute(tool, args);
  if (result?.error) return { status: 'error', message: result.error };
  return { status: 'ok', ...result };
}

// The three live sections for one user. Shared by the "Hoy" panel and the
// morning summary the scheduled job sends on Telegram.
export async function collectToday({ timezone, disabled = [], getUser }) {
  const toolset = createToolset({ disabled, context: { timezone, getUser } });
  const user = await getUser();

  const [calendar, mail, news] = await Promise.all([
    section({
      id: 'google',
      tool: 'list_events',
      args: { from: 'hoy', to: 'mañana' },
      disabled,
      toolset,
      user,
      extra: { needsAccount: true },
    }),
    section({
      id: 'gmail',
      tool: 'search_emails',
      args: { query: IMPORTANT_MAIL_QUERY, max_results: 6 },
      disabled,
      toolset,
      user,
      extra: { needsAccount: true, check: (u) => hasGmailAccess(u.id) },
    }),
    section({ id: 'news', tool: 'get_news', args: {}, disabled, toolset, user }),
  ]);
  return { user, calendar, mail, news };
}

export async function getToday({ query = {}, cookies = {} }) {
  const timezone = validTimezone(query.tz);
  const disabled = sanitizeConnectorIds(typeof query.off === 'string' ? query.off.split(',') : []);
  const { user, calendar, mail, news } = await collectToday({ timezone, disabled, getUser: lazySessionUser(cookies) });

  return {
    status: 200,
    headers: { 'Cache-Control': 'private, no-store' },
    json: {
      generatedAt: new Date().toISOString(),
      timezone,
      signedIn: Boolean(user),
      user: user ? { name: user.name || null } : null,
      today: localParts(new Date().toISOString(), timezone).date,
      calendar: calendar.status === 'ok' ? { status: 'ok', events: calendar.events } : calendar,
      mail: mail.status === 'ok' ? { status: 'ok', emails: mail.emails } : mail,
      news: news.status === 'ok' ? { status: 'ok', headlines: news.headlines } : news,
    },
  };
}
