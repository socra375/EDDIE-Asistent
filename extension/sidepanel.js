// The side panel: Eddie's own page (its compact "panel" mode) in a frame, beside whatever
// website you are on. This page is the go-between: it answers the frame's request for the page you
// are looking at (only if you allowed it), hands it a question the right-click menu asked, and
// falls back to opening Eddie in its own small window when a frame can't hold the session.
import { serverOrigin } from './urls.js';

const DEFAULT_SERVER = 'https://eddie-asistent.vercel.app';
const READY_WAIT_MS = 9000;
const $ = (id) => document.getElementById(id);
const ask = (message) => chrome.runtime.sendMessage(message);

let origin = DEFAULT_SERVER;
let ready = false;

function note(text, bad = false) {
  $('bar').hidden = !text && $('allow').hidden && $('login').hidden && $('window').hidden;
  $('note').textContent = text || '';
  $('note').className = bad ? 'bad' : '';
}

function toFrame(message) {
  $('frame').contentWindow?.postMessage({ source: 'eddie-extension', ...message }, origin);
}

async function openWindow() {
  const screenW = globalThis.screen?.availWidth || 1280;
  await chrome.windows.create({ url: `${origin}/?panel=1`, type: 'popup', width: 420, height: 760, left: Math.max(0, screenW - 440), top: 40 });
}

async function refreshAllow() {
  const state = await ask({ type: 'panel-state' });
  $('allow').hidden = Boolean(state?.enabled && state?.permitted);
  return state;
}

async function answerContext(id) {
  const context = await ask({ type: 'page-context' });
  toFrame({ type: 'context', id, context });
}

window.addEventListener('message', async (event) => {
  if (event.origin !== origin || event.source !== $('frame').contentWindow || event.data?.source !== 'eddie-panel') return;
  const data = event.data;
  if (data.type === 'ready') {
    ready = true;
    $('window').hidden = true;
    $('login').hidden = data.user !== false;
    await refreshAllow();
    note(data.user === false ? 'Para hablar con Eddie, inicia sesión (se abre en una pestaña; vuelve aquí después).' : '');
    const { text } = await ask({ type: 'take-ask' });
    if (text) toFrame({ type: 'ask', text });
  } else if (data.type === 'context-request') {
    await answerContext(data.id);
  }
});

$('allow').addEventListener('click', async () => {
  // Asked here, from the click: the browser only shows its permission prompt for the user's own action.
  const granted = await chrome.permissions.request({ origins: ['https://*/*'] });
  if (!granted) return note('Sin ese permiso Eddie no puede leer la página. Puedes hablarle igual.', true);
  await ask({ type: 'set-read-pages', enabled: true });
  await refreshAllow();
  note('Listo: cuando le escribas a Eddie con «Usar esta página» activado, leerá la página que estés viendo.');
});

$('login').addEventListener('click', () => chrome.tabs.create({ url: origin }));
$('window').addEventListener('click', openWindow);

// A question from the right-click menu while the panel was already open.
chrome.storage.session.onChanged.addListener(async (changes) => {
  if (!changes.pendingAsk?.newValue || !ready) return;
  const { text } = await ask({ type: 'take-ask' });
  if (text) toFrame({ type: 'ask', text });
});

async function start() {
  const stored = await chrome.storage.local.get('server');
  origin = serverOrigin(stored.server || DEFAULT_SERVER) || DEFAULT_SERVER;
  $('frame').src = `${origin}/?panel=1`;
  setTimeout(() => {
    if (ready) return;
    $('window').hidden = false;
    note('Eddie no terminó de cargar aquí (puede que tu navegador no deje guardar la sesión dentro del panel).', true);
  }, READY_WAIT_MS);
}

start();
