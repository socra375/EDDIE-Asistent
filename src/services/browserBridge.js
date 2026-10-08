// The door between Eddie's page and the "Eddie en tu navegador" extension, if
// this browser has it. The extension's manifest lets only Eddie's own
// addresses send it messages, and it has a fixed id (the `key` in its
// manifest), so the page can always find it. Without the extension, or in a
// browser that is not Chrome, nothing here does anything and every caller
// falls back to what it did before.
export const EXTENSION_ID = 'amdcngcajoekfaljieikbgifmhoigdfb';
const TIMEOUT_MS = 1500;

let state = { checked: false, installed: false, linked: false, version: null };
const listeners = new Set();

// → the extension's answer, or null (not installed, not allowed, or no answer in time).
function send(message) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    const done = (value) => {
      clearTimeout(timer);
      resolve(value ?? null);
    };
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        void runtime.lastError; // "Could not establish connection" just means it isn't there
        done(response);
      });
    } catch {
      done(null);
    }
  });
}

function set(next) {
  const changed = ['installed', 'linked', 'version', 'checked'].some((k) => next[k] !== state[k]);
  state = next;
  if (changed) for (const fn of listeners) fn(state);
  return state;
}

export const bridgeState = () => state;

// Calls back whenever what the page knows about the extension changes.
export function onBridgeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Asks the extension whether it is there and linked.
export async function refreshBridge() {
  const reply = await send({ type: 'ping' });
  return set({ checked: true, installed: reply?.ok === true, linked: reply?.linked === true, version: reply?.version || null });
}

let started = false;
// Checks once at startup and again when the user comes back to this tab (they
// may have just installed the extension).
export function initBridge() {
  if (started || typeof window === 'undefined') return;
  started = true;
  refreshBridge();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshBridge();
  });
}

// Opens a page in a new tab through the extension: instant, and no pop-up
// blocker in the way. `id` is the server's id for the same request, so the
// extension doesn't open it a second time when it also finds it queued.
export async function openViaExtension(url, id) {
  const reply = await send({ type: 'open', url, ...(id ? { id } : {}) });
  return reply?.ok === true;
}

// Hands the extension a one-time code to link itself with `server`.
export async function pairExtension({ server, code, name }) {
  const reply = await send({ type: 'pair', server, code, name });
  const result = reply || { ok: false, error: 'La extensión no respondió. Recarga Eddie y vuelve a intentarlo.' };
  if (result.ok) await refreshBridge();
  return result;
}

export async function unlinkExtension() {
  const reply = await send({ type: 'unlink' });
  await refreshBridge();
  return reply?.ok === true;
}
