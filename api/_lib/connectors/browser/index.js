// The user's own browser. Eddie asks a Chrome extension ("Eddie en tu
// navegador", linked from the hub) to open things for them: the meetings in
// their calendar at the right time (the extension does that by itself), the
// documents, sheets and presentations Eddie makes, YouTube, or any page they
// ask for. The places Eddie works from open at once; any other website goes
// through the confirmation card. See api/_lib/browser/ and extension/.
import { hasLink, linkByUser } from '../../browser/store.js';
import { EXTENSION_VERSION, requestOpen } from '../../browser/open.js';
import { isMessagingUrl, isTrustedUrl, safeHttpsUrl } from '../../browser/urls.js';
import { createTask, latestTaskFor, requestStop } from '../../browser/tasks.js';

const TASK_STATUS_WORD = { running: 'en curso', done: 'terminada', stopped: 'detenida', blocked: 'detenida por seguridad', error: 'con un error' };

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

// Vigilar una conversación o contestar mensajes "solo" no es una tarea de una
// sola confirmación: se rechaza antes de mostrar la tarjeta, en vez de dejar
// que el usuario confirme algo que no vamos a hacer.
const MONITOR_INTENT_RE = /\bcada\s|\bsiempre que\b|\btodos los mensajes\b|autom[aá]tic|vigil|monitor|en segundo plano|continuamente|24\/7|sin preguntar|apenas (llegue|reciba)/i;

function prepareBrowserTask(args) {
  const goal = String(args.goal || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const url = safeHttpsUrl(String(args.start_url || '').trim());
  if (!goal) return { error: 'Dime qué debe hacer Eddie en esa pestaña, en pocas palabras.' };
  if (!url) return { error: 'Dame la dirección web completa (https://) donde Eddie debe empezar.' };
  const messaging = isMessagingUrl(url);
  if (messaging && MONITOR_INTENT_RE.test(goal)) {
    return {
      error:
        'En redes sociales y mensajería, Eddie solo redacta una respuesta por tarea confirmada — nunca vigila conversaciones ni contesta mensajes de forma continua o automática. Pídemelo de a un mensaje a la vez.',
    };
  }
  return {
    args: { goal, start_url: url },
    preview: {
      title: 'Dejar que Eddie controle una pestaña de tu navegador',
      confirmLabel: 'Adelante, hazlo',
      danger: true,
      fields: [
        { key: 'start_url', label: 'Empieza en', value: url },
        { key: 'goal', label: 'Qué va a hacer', value: goal },
        ...(messaging ? [{ key: 'note', label: 'Importante', value: 'Solo redacta la respuesta; nunca la envía — tú decides si la mandas.' }] : []),
      ],
    },
  };
}

async function runBrowserTask(args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'No hay una sesión de usuario.' };
  if (!(await hasLink(user.id))) return { error: 'Tu navegador no está vinculado. Ve a Conectores → Tu navegador.' };
  const task = await createTask(user.id, { goal: args.goal, startUrl: args.start_url });
  const messaging = isMessagingUrl(args.start_url);
  return {
    taskId: task.id,
    summary: `Eddie va a abrir ${hostOf(args.start_url)} e intentar: ${args.goal}. Te aviso cuando termine o si necesita que tú sigas.`,
    note: messaging
      ? 'Se abre sola una pestaña nueva; Eddie lee la pantalla y escribe por su cuenta, pero en redes sociales y mensajería solo redacta la respuesta y la deja sin enviar — la revisas y la mandas tú. Nunca contraseñas, pagos ni datos personales. El usuario puede detenerla en cualquier momento desde el ícono de la extensión.'
      : 'Se abre sola una pestaña nueva y Eddie hace clics y escribe por su cuenta un momento, viendo solo esa pestaña (nunca contraseñas, pagos ni datos personales). El usuario puede detenerla en cualquier momento desde el ícono de la extensión.',
  };
}

async function browserTaskStatus(_args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'No hay una sesión de usuario.' };
  const task = await latestTaskFor(user.id);
  if (!task) return { summary: 'Eddie no ha hecho ninguna tarea en el navegador todavía.' };
  const word = TASK_STATUS_WORD[task.status] || task.status;
  return { ...task, summary: `La tarea «${task.goal}» está ${word} (acción ${task.actionCount} de ${task.maxActions}).${task.result ? ` ${task.result}` : ''}` };
}

async function browserTaskStop(_args, context) {
  const user = await context.getUser?.();
  if (!user) return { error: 'No hay una sesión de usuario.' };
  const stopped = await requestStop(user.id);
  return { summary: stopped ? 'Hecho: Eddie se detiene en su próximo paso.' : 'No había ninguna tarea en curso.' };
}

export default {
  id: 'browser',
  name: 'Tu navegador',
  description:
    'Eddie trabaja desde tu navegador a través de una extensión de Chrome: abre tus reuniones del calendario a su hora, abre los documentos, hojas y presentaciones que crea, YouTube y las páginas que le pidas, sin que tengas que hacer clic. Con tu confirmación, también puede controlar una pestaña por ti (hacer clics, escribir) para cumplir una tarea concreta en una web, como crear algo en Canva.',
  icon: 'globe',
  category: 'asistente',
  // Offered to the model only when the conversation touches the topic.
  route: /abre|abrir|abr[ií]r|navegador|pesta[ñn]a|enlace|\blink\b|p[aá]gina|sitio|reuni[oó]n|videollamada|\bmeet\b|zoom|teams|ll[eé]vame|ens[eé][ñn]ame|canva|dise[ñn]o/i,
  auth: {
    type: 'browser-link',
    isConnected: (user) => hasLink(user.id),
  },
  requiredEnv: ['DATABASE_URL'],
  note: 'Abrir páginas: la extensión solo abre pestañas, no lee lo que tienes abierto. Controlar una pestaña (browser_task) es distinto: el usuario confirma una vez, y mientras esa tarea dura Eddie sí ve una captura de esa pestaña y hace clics/escribe en ella — nunca fuera de esa pestaña, nunca en campos de contraseña o pago. En redes sociales y mensajería solo redacta la respuesta y nunca la envía: siempre la manda el usuario.',
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
    {
      label: 'Controlar una pestaña del navegador',
      activity: 'Preparando la tarea…',
      sensitive: true,
      declaration: {
        name: 'browser_task',
        description:
          'Deja que Eddie controle una pestaña del navegador del usuario (hacer clics, escribir) para cumplir una tarea concreta en una página web, por ejemplo crear un diseño en Canva. Pide confirmación una sola vez para toda la tarea, no para cada clic. Nunca la uses para iniciar sesión, pagar o escribir datos personales del usuario: para eso, dile que lo haga él mismo. En redes sociales o mensajería (Instagram, WhatsApp Web, Messenger, X…) solo redacta UNA respuesta por tarea y la deja sin enviar para que el usuario la revise y la mande él mismo; nunca la uses para vigilar una conversación o contestar mensajes de forma continua o automática — eso va contra las condiciones de esos servicios y nadie revisaría lo que se manda.',
        parameters: {
          type: 'OBJECT',
          properties: {
            start_url: { type: 'STRING', description: 'Dirección completa (https://) donde empieza la tarea, p. ej. https://www.canva.com/' },
            goal: { type: 'STRING', description: 'Qué debe lograr Eddie en esa pestaña, en una frase concreta y breve.' },
          },
          required: ['start_url', 'goal'],
        },
      },
      prepare: (args) => prepareBrowserTask(args),
      run: (args, context) => runBrowserTask(args, context),
    },
    {
      label: 'Estado de la tarea del navegador',
      activity: 'Consultando…',
      risk: 'read',
      sensitive: false,
      declaration: {
        name: 'browser_task_status',
        description: 'Consulta cómo va (o cómo terminó) la última tarea que Eddie hizo controlando una pestaña del navegador (browser_task).',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: (args, context) => browserTaskStatus(args, context),
    },
    {
      label: 'Detener la tarea del navegador',
      activity: 'Deteniendo…',
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'browser_task_stop',
        description: 'Detiene de inmediato la tarea que Eddie esté haciendo ahora mismo controlando una pestaña del navegador (browser_task).',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: (args, context) => browserTaskStop(args, context),
    },
  ],
  webhook: null,
};
