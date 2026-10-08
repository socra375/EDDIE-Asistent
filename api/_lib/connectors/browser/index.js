// The user's own browser. Eddie asks a Chrome extension ("Eddie en tu
// navegador", linked from the hub) to open things for them: the meetings in
// their calendar at the right time (the extension does that by itself), the
// documents, sheets and presentations Eddie makes, YouTube, or any page they
// ask for. The places Eddie works from open at once; any other website goes
// through the confirmation card. See api/_lib/browser/ and extension/.
import { hasLink, linkByUser } from '../../browser/store.js';
import { EXTENSION_VERSION, requestOpen } from '../../browser/open.js';
import { isTrustedUrl, safeHttpsUrl } from '../../browser/urls.js';

const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');

function opened(result, label) {
  const what = label ? `«${label}»` : 'la página';
  if (result.error) return { error: result.error };
  return result.delivery === 'extension'
    ? { requested: true, delivery: 'extension', url: result.url, summary: `Abriendo ${what} en tu navegador.`, note: 'Se abre sola en unos segundos; no hace falta que el usuario haga nada.' }
    : {
        requested: true,
        delivery: 'page',
        url: result.url,
        summary: `Intenté abrir ${what}.`,
        note: 'El navegador no está vinculado con la extensión: si el navegador lo bloqueó, el chat muestra un botón para abrirlo. Dilo así, sin afirmar que ya se abrió.',
      };
}

async function openInBrowser(args, context) {
  if (!isTrustedUrl(args.url)) {
    return { error: 'Esa dirección no está entre los sitios que abro directamente (Google, YouTube, reuniones…). Usa open_website: pide confirmación al usuario.' };
  }
  return opened(await requestOpen(context, { url: args.url, label: args.label }), args.label);
}

function prepareWebsite(args) {
  const url = safeHttpsUrl(String(args.url || '').trim());
  if (!url) return { error: 'Dame una dirección web completa que empiece por https:// (sin contraseña ni direcciones internas).' };
  return {
    args: { url, ...(args.label ? { label: String(args.label).slice(0, 120) } : {}) },
    preview: { title: 'Abrir en tu navegador', confirmLabel: 'Abrir', fields: [{ key: 'url', label: 'Dirección', value: url }] },
  };
}

export default {
  id: 'browser',
  name: 'Tu navegador',
  description:
    'Eddie trabaja desde tu navegador a través de una extensión de Chrome: abre tus reuniones del calendario a su hora, abre los documentos, hojas y presentaciones que crea, YouTube y las páginas que le pidas, sin que tengas que hacer clic.',
  icon: 'globe',
  category: 'asistente',
  // Offered to the model only when the conversation touches the topic.
  route: /abre|abrir|abr[ií]r|navegador|pesta[ñn]a|enlace|\blink\b|p[aá]gina|sitio|reuni[oó]n|videollamada|\bmeet\b|zoom|teams|ll[eé]vame|ens[eé][ñn]ame/i,
  auth: {
    type: 'browser-link',
    isConnected: (user) => hasLink(user.id),
  },
  requiredEnv: ['DATABASE_URL'],
  note: 'La extensión solo abre pestañas: no lee ni controla lo que tienes abierto. Las páginas de Google, YouTube y reuniones se abren al instante; cualquier otra web pide tu confirmación.',
  details: async (user) => {
    const link = user ? await linkByUser(user.id) : null;
    if (!link) return { latestVersion: EXTENSION_VERSION };
    return { latestVersion: EXTENSION_VERSION, browser: { name: link.name, version: link.version, lastSeen: link.lastSeen, prefs: link.prefs } };
  },
  tools: [
    {
      label: 'Abrir en tu navegador',
      activity: 'Abriendo en tu navegador…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'open_in_browser',
        description:
          'Abre una página en el navegador del usuario, en una pestaña nueva, sin pedir confirmación. Solo para sitios de trabajo: documentos, hojas y presentaciones de Google, el calendario, la reunión (Meet, Zoom, Teams…) o YouTube. Para la reunión de un evento usa el meeting_url del evento. Para cualquier otro sitio web usa open_website.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Dirección completa, con https://.' },
            label: { type: 'STRING', description: 'Cómo llamarla al usuario (p. ej. "Reunión de ventas", "Informe de marzo").' },
          },
          required: ['url'],
        },
      },
      run: (args, context) => openInBrowser(args, context),
    },
    {
      label: 'Abrir una página web',
      activity: 'Preparando la página…',
      sensitive: true,
      declaration: {
        name: 'open_website',
        description: 'Abre en el navegador del usuario cualquier página web que él pida (p. ej. "abre amazon.com"). Muestra una tarjeta para que confirme antes de abrirla; tú solo das la dirección completa con https://.',
        parameters: {
          type: 'OBJECT',
          properties: {
            url: { type: 'STRING', description: 'Dirección completa, con https://.' },
            label: { type: 'STRING', description: 'Cómo llamarla al usuario.' },
          },
          required: ['url'],
        },
      },
      prepare: (args) => prepareWebsite(args),
      run: async (args, context) => {
        const result = opened(await requestOpen(context, { url: args.url, label: args.label }), args.label || hostOf(args.url));
        return result;
      },
    },
  ],
  webhook: null,
};
