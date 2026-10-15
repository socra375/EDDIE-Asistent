// The mouse and the keyboard of a browser task: one decided action → the Chrome DevTools input events that carry it out
// in ONE tab (chrome.debugger; no content script, nothing read from the page). The server decides what to do
// (api/_lib/browser/agentStep.js); this only does it. The list of keys must equal the server's — a test keeps them equal.
export const KEY_DEFS = {
  Enter: { keyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
  Tab: { keyCode: 9, code: 'Tab', key: 'Tab' },
  Escape: { keyCode: 27, code: 'Escape', key: 'Escape' },
  Backspace: { keyCode: 8, code: 'Backspace', key: 'Backspace' },
  Delete: { keyCode: 46, code: 'Delete', key: 'Delete' },
  Space: { keyCode: 32, code: 'Space', key: ' ', text: ' ' },
  ArrowUp: { keyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
  ArrowDown: { keyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
  ArrowLeft: { keyCode: 37, code: 'ArrowLeft', key: 'ArrowLeft' },
  ArrowRight: { keyCode: 39, code: 'ArrowRight', key: 'ArrowRight' },
  Home: { keyCode: 36, code: 'Home', key: 'Home' },
  End: { keyCode: 35, code: 'End', key: 'End' },
  PageUp: { keyCode: 33, code: 'PageUp', key: 'PageUp' },
  PageDown: { keyCode: 34, code: 'PageDown', key: 'PageDown' },
  // The only combinations: select everything in a field (to replace what is there) and undo. Nothing that reads or writes the clipboard.
  'Ctrl+A': { keyCode: 65, code: 'KeyA', key: 'a', modifiers: 2, commands: ['selectAll'] },
  'Ctrl+Z': { keyCode: 90, code: 'KeyZ', key: 'z', modifiers: 2, commands: ['undo'] },
};

export const MIN_WAIT_MS = 200;
export const MAX_WAIT_MS = 3000;
const DRAG_STEPS = 8;

export const waitMs = (value) => {
  const n = Number(value);
  return Math.max(MIN_WAIT_MS, Math.min(MAX_WAIT_MS, Number.isFinite(n) ? Math.round(n) : 1000));
};

const send = (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params);
const mouse = (tabId, params) => send(tabId, 'Input.dispatchMouseEvent', params);

// Moves the pointer there first (pages that open menus on hover, or ignore a click that was never "over" anything), then presses and releases.
async function click(tabId, x, y, { button = 'left', count = 1 } = {}) {
  const buttons = button === 'right' ? 2 : 1;
  await mouse(tabId, { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
  for (let n = 1; n <= count; n += 1) {
    await mouse(tabId, { type: 'mousePressed', x, y, button, buttons, clickCount: n });
    await mouse(tabId, { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: n });
  }
}

async function drag(tabId, from, to) {
  await mouse(tabId, { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 });
  await mouse(tabId, { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= DRAG_STEPS; i += 1) {
    const f = i / DRAG_STEPS;
    await mouse(tabId, { type: 'mouseMoved', x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, button: 'left', buttons: 1 });
  }
  await mouse(tabId, { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
}

async function press(tabId, def) {
  const base = { windowsVirtualKeyCode: def.keyCode, code: def.code, key: def.key, ...(def.modifiers ? { modifiers: def.modifiers } : {}) };
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(def.text ? { text: def.text } : {}), ...(def.commands ? { commands: def.commands } : {}) });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// chrome.debugger's Input.* coordinates are CSS pixels; the model answers in the screenshot's own pixel grid. `scale` converts one to the other.
export async function performAction(tabId, action, scale = 1) {
  const s = scale || 1;
  const at = (x, y) => ({ x: (x || 0) / s, y: (y || 0) / s });
  switch (action.action) {
    case 'click': {
      const p = at(action.x, action.y);
      return click(tabId, p.x, p.y);
    }
    case 'double_click': {
      const p = at(action.x, action.y);
      return click(tabId, p.x, p.y, { count: 2 });
    }
    case 'right_click': {
      const p = at(action.x, action.y);
      return click(tabId, p.x, p.y, { button: 'right' });
    }
    case 'drag':
      return drag(tabId, at(action.x, action.y), at(action.x2, action.y2));
    case 'type':
      return send(tabId, 'Input.insertText', { text: String(action.text ?? '') });
    case 'key': {
      const def = KEY_DEFS[action.key];
      return def ? press(tabId, def) : undefined;
    }
    case 'scroll': {
      const p = at(action.x, action.y);
      return mouse(tabId, { type: 'mouseWheel', x: p.x, y: p.y, deltaX: 0, deltaY: action.deltaY || 0 });
    }
    case 'wait':
      return new Promise((resolve) => setTimeout(resolve, waitMs(action.ms)));
    default:
      return undefined;
  }
}
