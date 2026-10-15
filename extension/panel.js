// Eddie in any web: the side panel (sidepanel.html) and what feeds it.
//   - opens from the keyboard (Alt+E), the popup's button or the right-click menu;
//   - the right-click menu asks Eddie about the selected text or the page;
//   - if the user turned it on, Eddie can read the page the user is looking at.
//
// Reading a page is the one new thing this file does, so it is narrow on purpose:
// only when the user switched "Leer la página que veo" on (it is off until they do, and
// the browser asks them for the permission itself), only the tab in front, only
// when the user sends Eddie a message with that switch on (never in the background), only
// its visible text — never a form's contents — and never a page that has a password field.
import { joinFrontTab } from './group.js';

const ALL_SITES = { origins: ['https://*/*'] };
const MAX_TEXT = 12000;
const MAX_SELECTION = 3000;
const ASK_FRESH_MS = 60_000;
const MENU_SELECTION = 'eddie-explain-selection';
const MENU_PAGE = 'eddie-summarize-page';

const local = (keys) => chrome.storage.local.get(keys);

export async function readPagesEnabled() {
  return (await local('readPages')).readPages === true;
}

// → { enabled, permitted }
export async function readPagesState() {
  return { enabled: await readPagesEnabled(), permitted: await chrome.permissions.contains(ALL_SITES) };
}

// The browser's own permission prompt is asked by the panel (it needs the user's click); this keeps the choice.
export async function setReadPages(enabled) {
  await chrome.storage.local.set({ readPages: Boolean(enabled) });
  return readPagesState();
}

// The tab the user is looking at: the front tab of the last browser window they used (not the panel's own).
async function frontTab() {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [tab] = await chrome.tabs.query(win?.id ? { active: true, windowId: win.id } : { active: true, currentWindow: true });
  return tab || null;
}

// Runs inside the page (injected): visible text only, a password field means "do not read this".
function extractPage(maxText, maxSelection) {
  if (document.querySelector('input[type="password"]')) return { sensitive: true };
  const selection = String(window.getSelection?.() || '').trim().slice(0, maxSelection);
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  const text = String(root?.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxText);
  return { selection, text, lang: document.documentElement.lang || '' };
}

// → { ok: true, url, title, selection, text, lang } | { ok: false, reason }
//   reason: disabled (the user has not turned it on), permission, no-tab, restricted (not an https page), sensitive, blocked
export async function pageContext() {
  if (!(await readPagesEnabled())) return { ok: false, reason: 'disabled' };
  if (!(await chrome.permissions.contains(ALL_SITES))) return { ok: false, reason: 'permission' };
  const tab = await frontTab();
  if (!tab?.id || !tab.url) return { ok: false, reason: 'no-tab' };
  if (!/^https:\/\//i.test(tab.url)) return { ok: false, reason: 'restricted' };
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPage, args: [MAX_TEXT, MAX_SELECTION] });
    if (result?.sensitive) return { ok: false, reason: 'sensitive', url: tab.url, title: tab.title || '' };
    return { ok: true, url: tab.url, title: String(tab.title || '').slice(0, 200), selection: result?.selection || '', text: result?.text || '', lang: result?.lang || '' };
  } catch {
    return { ok: false, reason: 'blocked', url: tab.url, title: tab.title || '' };
  }
}

export async function openPanel(windowId) {
  const id = windowId ?? (await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null))?.id;
  if (!id) return { ok: false, error: 'No hay ventana del navegador.' };
  try {
    await chrome.sidePanel.open({ windowId: id });
    await joinFrontTab(id); // the page Eddie opened on shows up under «Eddie» in the tab strip
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

// A question the right-click menu asked, waiting for the panel to pick it up.
async function rememberAsk(text) {
  await chrome.storage.session.set({ pendingAsk: { text, at: Date.now() } });
}

export async function takeAsk() {
  const { pendingAsk } = await chrome.storage.session.get('pendingAsk');
  if (!pendingAsk) return { ok: true, text: '' };
  await chrome.storage.session.remove('pendingAsk');
  return { ok: true, text: Date.now() - pendingAsk.at < ASK_FRESH_MS ? pendingAsk.text : '' };
}

// Called once from background.js.
export function registerPanel() {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open-eddie-panel') openPanel(tab?.windowId);
  });
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: MENU_SELECTION, title: 'Preguntarle a Eddie sobre «%s»', contexts: ['selection'] });
      chrome.contextMenus.create({ id: MENU_PAGE, title: 'Resumir esta página con Eddie', contexts: ['page'] });
    });
  });
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const text = info.menuItemId === MENU_SELECTION ? `Explícame esto de la página que veo: «${String(info.selectionText || '').slice(0, MAX_SELECTION)}»` : 'Resume esta página.';
    await rememberAsk(text);
    await openPanel(tab?.windowId);
  });
}
