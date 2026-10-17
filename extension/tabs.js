// Orders about the tabs already open (the routines «a las 3 cierra YouTube»): open pages, close tabs, edit tabs. The server
// decides what and when (api/_lib/routines/tabs.js, plans.js); this only does it.
//
// The tabs' addresses are read here, on this computer, only to see which ones belong to the sites an order names (the
// `tabs` permission): they are not stored, not sent anywhere, and nothing is read from inside any page. Never touched: a pinned
// tab when closing, Eddie's own tab, and the tab of a browser task that is running (the «⏳ Eddie» group).
export const MAX_TABS_PER_STEP = 30;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const EDIT_OPS = ['reload', 'go_to', 'pin', 'unpin', 'mute', 'unmute'];

// The same rule as the server's normalizeSite («https://www.YouTube.com/x» → «youtube.com»); a test keeps them equal.
export function normalizeSite(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let host;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '');
  if (host.length > 80 || !DOMAIN_RE.test(host) || /^[\d.]+$/.test(host) || /\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host)) return null;
  return host;
}

// Whether the address belongs to one of the sites (the site itself or any of its subdomains).
export function siteMatches(address, sites) {
  let host;
  try {
    host = new URL(address).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}

// Which tabs an order is about. `own` is Eddie's own address (never touched).
export function pickTabs(tabs, sites, { own = '', includePinned = false } = {}) {
  const wanted = (Array.isArray(sites) ? sites : []).map(normalizeSite).filter(Boolean);
  if (!wanted.length) return [];
  let ownHost = '';
  try {
    ownHost = own ? new URL(own).hostname.toLowerCase() : '';
  } catch {
    ownHost = '';
  }
  return tabs
    .filter((t) => t.id != null && t.url && siteMatches(t.url, wanted) && (includePinned || !t.pinned))
    .filter((t) => {
      try {
        return !ownHost || new URL(t.url).hostname.toLowerCase() !== ownHost;
      } catch {
        return false;
      }
    })
    .slice(0, MAX_TABS_PER_STEP);
}

// Runs the steps in order. `io` brings what only the background page has: openPage(url), eddieTabIds(), own address, the
// rule for which addresses may be opened (openableUrl). → { opened, closed, edited }
export async function runSteps(steps, io) {
  const done = { opened: 0, closed: 0, edited: 0 };
  for (const step of (Array.isArray(steps) ? steps : []).slice(0, 10)) {
    try {
      if (step.type === 'open') {
        for (const url of (step.urls || []).slice(0, 8)) if (await io.openPage(url)) done.opened += 1;
      } else if (step.type === 'close') {
        let ids = [];
        if (step.scope === 'eddie') ids = await io.eddieTabIds();
        if (step.sites?.length) ids = ids.concat(pickTabs(await chrome.tabs.query({}), step.sites, { own: io.own }).map((t) => t.id));
        ids = [...new Set(ids)].slice(0, MAX_TABS_PER_STEP);
        if (ids.length) await chrome.tabs.remove(ids);
        done.closed += ids.length;
      } else if (step.type === 'edit' && EDIT_OPS.includes(step.op)) {
        const target = step.op === 'go_to' ? io.openableUrl(step.url) : null;
        if (step.op === 'go_to' && !target) continue;
        for (const tab of pickTabs(await chrome.tabs.query({}), step.sites, { own: io.own, includePinned: true })) {
          if (step.op === 'reload') await chrome.tabs.reload(tab.id);
          else if (step.op === 'go_to') await chrome.tabs.update(tab.id, { url: target });
          else if (step.op === 'pin' || step.op === 'unpin') await chrome.tabs.update(tab.id, { pinned: step.op === 'pin' });
          else await chrome.tabs.update(tab.id, { muted: step.op === 'mute' });
          done.edited += 1;
        }
      }
    } catch {
      // one step failing (a tab closed meanwhile) does not stop the next ones
    }
  }
  return done;
}
