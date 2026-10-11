// Eddie en tu navegador — the part that runs all the time.
//
// Mostly, it just opens tabs: it never reads a page, a tab's address or
// anything the user types.
//   1. Every half minute it asks Eddie's server for the pages Eddie wants
//      opened (a document it just made, a link the user asked for).
//   2. Every ten minutes it asks for the meetings in the user's calendar,
//      and sets an alarm per meeting: the call opens at its time (a minute
//      before, by default) even when Eddie's tab is closed.
//   3. Eddie's own page can hand it a page to open straight away (no waiting
//      for the half minute, no pop-up blocker), and link the browser.
// Each page opens once: a page is identified by the id Eddie gave it, and a
// meeting by its id and start, both remembered for a few days.
//
// The one exception: a "browser task" (see runTaskLoop below) the user
// explicitly confirmed in Eddie's chat. Only for that one tab, only for as
// long as the task runs, Eddie does look (a screenshot) and does act (a
// click, a key, some typed text) — through the Chrome DevTools protocol
// (`chrome.debugger`), never a content script, so it never reads page data
// outside of what a screenshot shows. The user can stop it any time from
// this extension's own popup.
import { openableUrl, serverOrigin } from './urls.js';

const DEFAULT_SERVER = 'https://eddie-asistent.vercel.app';
const POLL_ALARM = 'eddie-poll';
const AGENDA_ALARM = 'eddie-agenda';
const MEETING_ALARM = 'eddie-meet:';
const POLL_EVERY_MINUTES = 0.5;
const AGENDA_EVERY_MINUTES = 10;
// A meeting that began while the browser was closed can still be joined for this long.
const LATE_JOIN_MS = 15 * 60000;
const REMEMBER_MS = 3 * 24 * 3600000;
const SAME_PAGE_MS = 5000;
const VERSION = chrome.runtime.getManifest().version;

const read = (keys) => chrome.storage.local.get(keys);
const write = (values) => chrome.storage.local.set(values);

// One thing at a time: the page, the poll and an alarm can all want the same tab.
let chain = Promise.resolve();
const serial = (fn) => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
};

const recent = new Map(); // address → time, to ignore the same page asked twice at once

// ---- Opening ----

// Opens the tab. Callers go through `openPage` (one at a time); a task already
// inside the queue (a meeting) uses this directly.
async function openNow(raw, { id } = {}) {
  const url = openableUrl(raw);
  if (!url) return false;
  if (id) {
    const { seen = {} } = await read('seen');
    if (seen[id]) return true;
    const now = Date.now();
    for (const key of Object.keys(seen)) if (now - seen[key] > REMEMBER_MS) delete seen[key];
    seen[id] = now;
    await write({ seen });
  }
  const last = recent.get(url);
  if (last && Date.now() - last < SAME_PAGE_MS) return true;
  recent.set(url, Date.now());
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  return true;
}

const openPage = (raw, options) => serial(() => openNow(raw, options));

const meetingKey = (m) => `${m.id}@${m.startsAt}`;

function openMeeting(m) {
  return serial(async () => {
    const key = meetingKey(m);
    const { opened = {} } = await read('opened');
    if (opened[key]) return;
    const now = Date.now();
    for (const k of Object.keys(opened)) if (now - opened[k] > REMEMBER_MS) delete opened[k];
    opened[key] = now;
    await write({ opened });
    await openNow(m.url);
  });
}

// ---- Talking to Eddie ----

async function api(path, body = {}) {
  const { server = DEFAULT_SERVER, token } = await read(['server', 'token']);
  if (!token) throw new Error('not-linked');
  const res = await fetch(`${server}/api/connectors/browser/agent/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    await unlink();
    throw new Error('unlinked');
  }
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

async function setStatus(error) {
  if (error) await write({ lastError: error });
  else await write({ lastError: '', lastOk: Date.now() });
  await chrome.action.setBadgeText({ text: error ? '!' : '' });
  if (error) await chrome.action.setBadgeBackgroundColor({ color: '#c0392b' });
}

async function keepPrefs(prefs) {
  if (!prefs) return false;
  const before = (await read('prefs')).prefs;
  await write({ prefs });
  return JSON.stringify(before) !== JSON.stringify(prefs);
}

async function poll() {
  try {
    const data = await api('next');
    const changed = await keepPrefs(data.prefs);
    for (const command of data.commands || []) await openPage(command.url, { id: command.id });
    if (data.task) await maybeStartTask(data.task);
    await setStatus('');
    if (changed) await refreshAgenda();
  } catch (err) {
    if (err.message !== 'not-linked' && err.message !== 'unlinked') await setStatus(err.message);
  }
}

// ---- Browser tasks: look at one tab (a screenshot), decide one action, act,
// look again — until the task says it's done, hits a safety limit, or the
// user stops it from the popup. Everything goes through chrome.debugger
// (the Chrome DevTools protocol): no content script, nothing read from the
// page beyond what a screenshot shows. ----

const TASK_STEP_DELAY_MS = 900;
const CLIENT_MAX_ACTIONS = 30;
const KEY_DEFS = {
  Enter: { keyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Tab: { keyCode: 9, code: 'Tab', key: 'Tab' },
  Escape: { keyCode: 27, code: 'Escape', key: 'Escape' },
  Backspace: { keyCode: 8, code: 'Backspace', key: 'Backspace' },
};

let runningTaskId = null; // guards against starting the same task twice in one worker lifetime

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(finish, 15000);
  });
}

// The PNG's own pixel size (not the CSS viewport size): lets a click land
// where the model meant it, whatever the page's zoom or device pixel ratio.
async function imageDims(base64) {
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const dims = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return dims;
  } catch {
    return null;
  }
}

// chrome.debugger's Input.* coordinates are CSS pixels; the model answers in
// the screenshot's own pixel grid. `scale` converts one to the other.
async function performAction(tabId, action, scale) {
  const target = { tabId };
  if (action.action === 'click') {
    const x = (action.x || 0) / scale;
    const y = (action.y || 0) / scale;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  } else if (action.action === 'type') {
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: action.text });
  } else if (action.action === 'key') {
    const def = KEY_DEFS[action.key];
    if (!def) return;
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: def.keyCode, code: def.code, key: def.key, text: def.text });
    await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: def.keyCode, code: def.code, key: def.key });
  } else if (action.action === 'scroll') {
    const x = (action.x || 0) / scale;
    const y = (action.y || 0) / scale;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: action.deltaY || 0 });
  }
}

async function runTaskLoop(task, tabId) {
  let attached = false;
  const history = [];
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached = true;
    for (let i = 0; i < CLIENT_MAX_ACTIONS; i += 1) {
      const { stopTaskId } = await read('stopTaskId');
      if (stopTaskId === task.id) break;
      if (!(await chrome.tabs.get(tabId).catch(() => null))) break; // the tab got closed
      let shot;
      let metrics;
      try {
        [shot, metrics] = await Promise.all([
          chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'png' }),
          chrome.debugger.sendCommand({ tabId }, 'Page.getLayoutMetrics'),
        ]);
      } catch {
        break; // the user closed the "being debugged" bar, or the tab navigated away mid-capture
      }
      const dims = await imageDims(shot.data);
      const cssWidth = metrics?.cssVisualViewport?.clientWidth || metrics?.visualViewport?.clientWidth || dims?.width || 1;
      const scale = dims ? dims.width / cssWidth : 1;
      let resp;
      try {
        resp = await api('task-step', { taskId: task.id, image: shot.data, width: dims?.width || 0, height: dims?.height || 0, history });
      } catch {
        break; // offline, or the server said no — either way, stop quietly
      }
      if (!resp || resp.error || resp.action === 'stop') break;
      await write({ activeTask: { id: task.id, goal: task.goal, actionCount: i + 1, maxActions: CLIENT_MAX_ACTIONS } });
      // For "type", the exact typed text (not just the model's reason) is kept so
      // the server can quote it later if it has to stop before a message is sent.
      history.push(resp.action === 'type' && resp.text ? `type: "${resp.text}"` : `${resp.action}${resp.reason ? `: ${resp.reason}` : ''}`);
      if (history.length > 6) history.shift();
      if (resp.action === 'done' || resp.action === 'blocked') break;
      await performAction(tabId, resp, scale || 1);
      await new Promise((resolve) => setTimeout(resolve, TASK_STEP_DELAY_MS));
    }
  } finally {
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
    await write({ activeTask: null, stopTaskId: null });
  }
}

async function maybeStartTask(task) {
  if (!task || runningTaskId === task.id) return;
  const { activeTask } = await read('activeTask');
  if (activeTask?.id === task.id) return; // a previous worker instance already claimed it
  runningTaskId = task.id;
  await write({ activeTask: { id: task.id, goal: task.goal, actionCount: 0, maxActions: CLIENT_MAX_ACTIONS }, stopTaskId: null });
  const url = openableUrl(task.startUrl);
  if (!url) {
    await write({ activeTask: null });
    runningTaskId = null;
    return;
  }
  const tab = await chrome.tabs.create({ url, active: true });
  if (tab?.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  await waitForLoad(tab.id);
  runTaskLoop(task, tab.id).finally(() => {
    if (runningTaskId === task.id) runningTaskId = null;
  });
}

async function refreshAgenda() {
  try {
    const data = await api('agenda');
    await keepPrefs(data.prefs);
    await write({ meetings: data.meetings || [], agendaAt: Date.now() });
    await scheduleMeetings();
  } catch (err) {
    if (err.message !== 'not-linked' && err.message !== 'unlinked') await setStatus(err.message);
  }
}

// ---- Meetings ----

async function clearMeetingAlarms() {
  for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith(MEETING_ALARM)) await chrome.alarms.clear(alarm.name);
}

async function scheduleMeetings() {
  const { meetings = [], prefs = {}, opened = {} } = await read(['meetings', 'prefs', 'opened']);
  await clearMeetingAlarms();
  if (prefs.autoMeetings === false) return;
  const lead = (Number.isInteger(prefs.leadMinutes) ? prefs.leadMinutes : 1) * 60000;
  const now = Date.now();
  for (const m of meetings) {
    const start = Date.parse(m.startsAt);
    const end = Date.parse(m.endsAt);
    if (Number.isNaN(start) || opened[meetingKey(m)]) continue;
    if (now > Math.min(Number.isNaN(end) ? Infinity : end, start + LATE_JOIN_MS)) continue;
    const when = start - lead;
    if (when <= now) await openMeeting(m);
    else await chrome.alarms.create(MEETING_ALARM + meetingKey(m), { when });
  }
}

// ---- Alarms ----

async function ensureAlarms() {
  const { token } = await read('token');
  if (!token) {
    await chrome.alarms.clear(POLL_ALARM);
    await chrome.alarms.clear(AGENDA_ALARM);
    await clearMeetingAlarms();
    return false;
  }
  if (!(await chrome.alarms.get(POLL_ALARM))) await chrome.alarms.create(POLL_ALARM, { delayInMinutes: POLL_EVERY_MINUTES, periodInMinutes: POLL_EVERY_MINUTES });
  if (!(await chrome.alarms.get(AGENDA_ALARM))) await chrome.alarms.create(AGENDA_ALARM, { delayInMinutes: AGENDA_EVERY_MINUTES, periodInMinutes: AGENDA_EVERY_MINUTES });
  return true;
}

async function start() {
  if (await ensureAlarms()) {
    await poll();
    await refreshAgenda();
  }
}

chrome.runtime.onInstalled.addListener(() => start());
chrome.runtime.onStartup.addListener(() => start());

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === POLL_ALARM) return poll();
  if (alarm.name === AGENDA_ALARM) return refreshAgenda();
  if (alarm.name.startsWith(MEETING_ALARM)) {
    const key = alarm.name.slice(MEETING_ALARM.length);
    const { meetings = [] } = await read('meetings');
    const meeting = meetings.find((m) => meetingKey(m) === key);
    if (meeting) await openMeeting(meeting);
  }
});

// ---- Linking ----

async function unlink() {
  await chrome.storage.local.remove(['token', 'meetings', 'prefs', 'lastOk', 'lastError']);
  await ensureAlarms();
  await chrome.action.setBadgeText({ text: '' });
}

async function pair({ server, code, name }) {
  const origin = serverOrigin(server);
  if (!origin) return { ok: false, error: 'La dirección de Eddie debe empezar por https://.' };
  if (!(await chrome.permissions.contains({ origins: [`${origin}/*`] }))) return { ok: false, error: 'permission', origin };
  let res;
  try {
    res = await fetch(`${origin}/api/connectors/browser/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: String(code || ''), name: String(name || 'Chrome').slice(0, 60), version: VERSION }),
    });
  } catch {
    return { ok: false, error: 'No pude conectar con Eddie. Revisa la dirección y tu conexión.' };
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: data?.error || `Eddie respondió ${res.status}.` };
  await write({ server: origin, token: data.token, linkName: data.name, prefs: data.prefs, meetings: [], lastError: '' });
  await ensureAlarms();
  await poll();
  await refreshAgenda();
  return { ok: true };
}

async function state() {
  const s = await read(['server', 'token', 'linkName', 'prefs', 'lastOk', 'lastError', 'meetings', 'activeTask']);
  const now = Date.now();
  return {
    ok: true,
    version: VERSION,
    linked: Boolean(s.token),
    server: s.server || DEFAULT_SERVER,
    name: s.linkName || '',
    prefs: s.prefs || null,
    lastOk: s.lastOk || null,
    lastError: s.lastError || '',
    meetings: (s.meetings || []).filter((m) => Date.parse(m.endsAt) > now).slice(0, 3).map((m) => ({ title: m.title, startsAt: m.startsAt, provider: m.provider })),
    activeTask: s.activeTask || null,
  };
}

// ---- Messages: from Eddie's page (instant opening, linking) and from the popup ----

async function handle(message, fromPage) {
  switch (message?.type) {
    case 'ping':
      return { ok: true, version: VERSION, linked: Boolean((await read('token')).token) };
    case 'open':
      return { ok: await openPage(message.url, { id: typeof message.id === 'string' ? message.id : undefined }) };
    case 'pair':
      return pair(message);
    case 'unlink':
      await unlink();
      return { ok: true };
    case 'state':
      return fromPage ? { ok: false } : state();
    case 'poll-now':
      if (fromPage) return { ok: false };
      await poll();
      await refreshAgenda();
      return state();
    case 'stop-task': {
      if (fromPage) return { ok: false };
      const { activeTask } = await read('activeTask');
      if (activeTask) await write({ stopTaskId: activeTask.id });
      return { ok: true };
    }
    default:
      return { ok: false, error: 'unknown' };
  }
}

// Eddie's page: the manifest only lets Eddie's own addresses send these.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  handle(message, true).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// The extension's own popup.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message, false).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});
