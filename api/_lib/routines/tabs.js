// Orders about the user's browser tabs, in a routine («a las 3 cierra YouTube», «al encender abre mi correo»): open pages,
// close tabs, and edit tabs (reload, send them to another page, pin, mute). They are carried out by the browser extension
// (extension/tabs.js), on its own clock when it can (routines/plans.js) and, as a back-up, from the cron.
//
// What they can never do: read a page, type in one, or touch a tab outside the sites named. Closing leaves pinned tabs and
// Eddie's own tab alone. A site is a domain («youtube.com» matches www.youtube.com and music.youtube.com too).
import { safeHttpsUrl } from '../browser/urls.js';

export const TAB_ACTION_TYPES = ['open_sites', 'close_tabs', 'edit_tabs'];
export const EDIT_OPS = ['reload', 'go_to', 'pin', 'unpin', 'mute', 'unmute'];
export const MAX_SITES = 8;
export const MAX_URLS = 8;

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// «https://www.YouTube.com/watch?v=1», «www.youtube.com» or «youtube.com» → «youtube.com»; null when it is not a public site.
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

const sitesOf = (value) => [...new Set((Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/)).map(normalizeSite).filter(Boolean))].slice(0, MAX_SITES);

// Checks one action of type close_tabs / edit_tabs. → { action } | { error } (written for the model)
export function cleanTabAction(a) {
  if (a.type === 'close_tabs') {
    const eddie = a.scope === 'eddie';
    const sites = sitesOf(a.sites);
    if (!eddie && !sites.length) return { error: 'La acción "close_tabs" necesita sites (los sitios cuyas pestañas cerrar, p. ej. ["youtube.com"]) o scope="eddie" para las pestañas del grupo «Eddie».' };
    return { action: { type: 'close_tabs', ...(eddie ? { scope: 'eddie' } : {}), ...(sites.length ? { sites } : {}) } };
  }
  const op = String(a.op || '').trim();
  if (!EDIT_OPS.includes(op)) return { error: `La acción "edit_tabs" necesita op: ${EDIT_OPS.join(', ')}.` };
  const sites = sitesOf(a.sites);
  if (!sites.length) return { error: 'La acción "edit_tabs" necesita sites: los sitios cuyas pestañas editar, p. ej. ["youtube.com"].' };
  if (op === 'go_to') {
    const url = safeHttpsUrl(String(a.url || '').trim());
    if (!url) return { error: 'Con op="go_to" hace falta url: una dirección https pública a la que llevar esas pestañas.' };
    return { action: { type: 'edit_tabs', op, sites, url } };
  }
  return { action: { type: 'edit_tabs', op, sites } };
}

// Clean open_sites urls (already validated by actions.js) → the steps the extension runs, in order.
export function stepsOf(actions) {
  const steps = [];
  for (const a of actions) {
    if (a.type === 'open_sites') steps.push({ type: 'open', urls: (a.urls || []).slice(0, MAX_URLS) });
    else if (a.type === 'close_tabs') steps.push({ type: 'close', ...(a.scope === 'eddie' ? { scope: 'eddie' } : {}), ...(a.sites?.length ? { sites: a.sites } : {}) });
    else if (a.type === 'edit_tabs') steps.push({ type: 'edit', op: a.op, sites: a.sites, ...(a.url ? { url: a.url } : {}) });
  }
  return steps;
}

export const hasTabActions = (actions) => (Array.isArray(actions) ? actions : []).some((a) => TAB_ACTION_TYPES.includes(a?.type));

const OP_WORDS = { reload: 'recarga', go_to: 'lleva a otra página', pin: 'fija', unpin: 'suelta', mute: 'silencia', unmute: 'activa el sonido de' };

export function describeTabAction(a) {
  if (a.type === 'close_tabs') return `cierra ${a.scope === 'eddie' ? 'las pestañas del grupo «Eddie»' : `las pestañas de ${a.sites.join(', ')}`}`;
  return `${OP_WORDS[a.op]} las pestañas de ${a.sites.join(', ')}${a.op === 'go_to' ? ` (a ${new URL(a.url).hostname.replace(/^www\./, '')})` : ''}`;
}

// A line for the notice a routine sends («Pedí al navegador: …»).
export function describeSteps(steps) {
  return steps
    .map((s) => {
      if (s.type === 'open') return `abrir ${s.urls.length} página${s.urls.length === 1 ? '' : 's'}`;
      if (s.type === 'close') return s.scope === 'eddie' ? 'cerrar las pestañas del grupo «Eddie»' : `cerrar ${s.sites.join(', ')}`;
      return `${OP_WORDS[s.op]} ${s.sites.join(', ')}`.replace(/^recarga/, 'recargar').replace(/^fija /, 'fijar ').replace(/^suelta /, 'soltar ').replace(/^silencia /, 'silenciar ').replace(/^lleva a otra página/, 'llevar a otra página');
    })
    .join('; ');
}

// The browser that has the extension, from the name it linked with («Chrome en Windows», «Edge en Windows»…): the agent
// starts THAT one, not the system's default (an extension only works in its own browser).
export function browserKind(name) {
  const n = String(name || '').toLowerCase();
  if (/edge/.test(n)) return 'edge';
  if (/brave/.test(n)) return 'brave';
  if (/opera/.test(n)) return 'opera';
  if (/vivaldi/.test(n)) return 'vivaldi';
  return 'chrome';
}
