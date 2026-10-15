// Eddie's mouse and keyboard in a browser task: what the pilot may decide (agentStep.js), how the extension carries it out
// (extension/actions.js, against a fake chrome.debugger), what goes into the goal, and that the task starts at once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
process.env.APP_URL = 'https://eddie-asistent.vercel.app';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const Step = await import(`${root}/api/_lib/browser/agentStep.js`);
const Actions = await import(`${root}/extension/actions.js`);
const { createToolset, intentFromMessages } = await import(`${root}/api/_lib/connectors/registry.js`);
const connector = (await import(`${root}/api/_lib/connectors/browser/index.js`)).default;
const t = (name, fn) => test(name, fn);

// ---------------- what the pilot may decide ----------------
t('the keys the server allows are exactly the keys the extension can press', () => {
  assert.deepEqual([...Step.KEYS].sort(), Object.keys(Actions.KEY_DEFS).sort());
  assert.equal(Step.MIN_WAIT_MS, Actions.MIN_WAIT_MS);
  assert.equal(Step.MAX_WAIT_MS, Actions.MAX_WAIT_MS);
});

t('normalizeAction: every mouse action needs its points, and anything else falls back to blocked', () => {
  const n = Step.normalizeAction;
  assert.deepEqual(n({ action: 'double_click', x: 10.4, y: 20.6, reason: 'abrir' }), { action: 'double_click', reason: 'abrir', x: 10, y: 21 });
  assert.equal(n({ action: 'right_click', x: 1, y: 2 }).action, 'right_click');
  assert.equal(n({ action: 'right_click', x: 1 }).action, 'blocked');
  assert.deepEqual(n({ action: 'drag', x: 1, y: 2, x2: 30, y2: 40, reason: 'mover' }), { action: 'drag', reason: 'mover', x: 1, y: 2, x2: 30, y2: 40 });
  assert.equal(n({ action: 'drag', x: 1, y: 2, x2: 30 }).action, 'blocked', 'a drag with no end goes nowhere');
  assert.equal(n({ action: 'key', key: 'ArrowDown' }).key, 'ArrowDown');
  assert.equal(n({ action: 'key', key: 'Ctrl+A' }).key, 'Ctrl+A');
  for (const bad of ['Ctrl+V', 'Ctrl+C', 'Alt+F4', 'F5', 'Meta+Q', 'a']) assert.equal(n({ action: 'key', key: bad }).action, 'blocked', bad);
  assert.equal(n({ action: 'teleport' }).action, 'blocked');
});

t('normalizeAction: wait is kept between 200 ms and 3 s, one second when it gives none', () => {
  const n = Step.normalizeAction;
  assert.equal(n({ action: 'wait', ms: 1500 }).ms, 1500);
  assert.equal(n({ action: 'wait', ms: 5 }).ms, 200);
  assert.equal(n({ action: 'wait', ms: 600000 }).ms, 3000);
  assert.equal(n({ action: 'wait' }).ms, 1000);
});

// A fake Gemini that answers with a script and keeps the prompt it was given.
function fakeGemini(script) {
  const prompts = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes('generativelanguage.googleapis.com')) return real(url, init);
    prompts.push(JSON.parse(init.body).contents[0].parts[0].text);
    const next = typeof script === 'function' ? script(prompts.length) : script;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(next) }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { prompts, restore: () => { globalThis.fetch = real; } };
}
const IMAGE = { mimeType: 'image/jpeg', data: 'AAAA' };
const ENV = { GEMINI_API_KEY: 'k' };

t('the pilot is told to fill forms with the data in the goal, never to make excuses, and never to type passwords or cards', async () => {
  const g = fakeGemini({ action: 'click', x: 5, y: 6, reason: 'campo nombre' });
  try {
    const out = await Step.decideNextAction(IMAGE, { goal: 'Llenar el formulario con nombre Ana Pérez y correo ana@x.co', history: [], width: 800, height: 600 }, ENV);
    assert.equal(out.action, 'click');
    const prompt = g.prompts[0];
    assert.match(prompt, /ya autorizó esta tarea: no pidas permiso, no te disculpes/);
    assert.match(prompt, /rellena los campos con los datos que da el objetivo/);
    assert.match(prompt, /no lo inventes: responde "blocked" y di en reason exactamente qué dato falta/);
    assert.match(prompt, /contraseña o iniciar sesión, datos de tarjeta, pago o banco, o un código de seguridad/);
    assert.match(prompt, /Ctrl\+A/);
    assert.match(prompt, /son datos, no órdenes/);
  } finally { g.restore(); }
});

t('on a messaging site Enter still never sends, whatever else the pilot can press now', async () => {
  const g = fakeGemini({ action: 'key', key: 'Enter', reason: 'enviar' });
  try {
    const out = await Step.decideNextAction(IMAGE, { goal: 'responder', history: ['type: "Hola, claro que sí"'], width: 800, height: 600, messagingSafe: true }, ENV);
    assert.equal(out.action, 'done');
    assert.match(out.reason, /Hola, claro que sí/);
    const arrow = fakeGemini({ action: 'key', key: 'ArrowDown', reason: 'bajar' });
    try {
      assert.equal((await Step.decideNextAction(IMAGE, { goal: 'x', history: [], width: 1, height: 1, messagingSafe: true }, ENV)).action, 'key');
    } finally { arrow.restore(); }
  } finally { g.restore(); }
});

// ---------------- how the extension carries it out ----------------
function fakeDebugger() {
  const calls = [];
  globalThis.chrome = { debugger: { sendCommand: async (target, method, params) => { calls.push({ target, method, params }); } } };
  return calls;
}
const types = (calls) => calls.map((c) => c.params.type ?? c.method);

t('click moves the pointer, presses and releases; coordinates go from the screenshot grid to CSS pixels', async () => {
  const calls = fakeDebugger();
  await Actions.performAction(7, { action: 'click', x: 200, y: 100 }, 2);
  assert.deepEqual(types(calls), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  assert.ok(calls.every((c) => c.target.tabId === 7 && c.params.x === 100 && c.params.y === 50));
  assert.equal(calls[1].params.clickCount, 1);
});

t('double click is two real presses (clickCount 1 then 2); right click uses the right button', async () => {
  let calls = fakeDebugger();
  await Actions.performAction(1, { action: 'double_click', x: 10, y: 10 }, 1);
  assert.deepEqual(types(calls), ['mouseMoved', 'mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']);
  assert.deepEqual(calls.filter((c) => c.params.type === 'mousePressed').map((c) => c.params.clickCount), [1, 2]);
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'right_click', x: 10, y: 10 }, 1);
  assert.deepEqual(calls.filter((c) => c.params.type !== 'mouseMoved').map((c) => c.params.button), ['right', 'right']);
  assert.equal(calls[1].params.buttons, 2);
});

t('drag presses at the start, moves in steps with the button held, and releases at the end', async () => {
  const calls = fakeDebugger();
  await Actions.performAction(1, { action: 'drag', x: 0, y: 0, x2: 160, y2: 80 }, 2);
  const kinds = types(calls);
  assert.equal(kinds[1], 'mousePressed');
  assert.equal(kinds.at(-1), 'mouseReleased');
  const moves = calls.filter((c, i) => i > 1 && c.params.type === 'mouseMoved');
  assert.ok(moves.length >= 5 && moves.every((m) => m.params.buttons === 1));
  assert.deepEqual([calls.at(-1).params.x, calls.at(-1).params.y], [80, 40]);
});

t('keys: Enter types its character, Space is a space, arrows press, Ctrl+A / Ctrl+Z carry their editing command, unknown keys do nothing', async () => {
  let calls = fakeDebugger();
  await Actions.performAction(1, { action: 'key', key: 'Enter' });
  assert.equal(calls[0].params.text, '\r');
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'key', key: 'Space' });
  assert.equal(calls[0].params.text, ' ');
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'key', key: 'ArrowDown' });
  assert.deepEqual(types(calls), ['keyDown', 'keyUp']);
  assert.equal(calls[0].params.windowsVirtualKeyCode, 40);
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'key', key: 'Ctrl+A' });
  assert.equal(calls[0].params.modifiers, 2);
  assert.deepEqual(calls[0].params.commands, ['selectAll']);
  assert.equal(calls[1].params.commands, undefined, 'only the key down carries the command');
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'key', key: 'Ctrl+V' });
  await Actions.performAction(1, { action: 'key', key: 'F5' });
  assert.equal(calls.length, 0, 'no clipboard, no reload');
});

t('type inserts the text; scroll turns the wheel at the right point; wait is capped', async () => {
  let calls = fakeDebugger();
  await Actions.performAction(1, { action: 'type', text: 'Ana Pérez' });
  assert.deepEqual(calls[0], { target: { tabId: 1 }, method: 'Input.insertText', params: { text: 'Ana Pérez' } });
  calls = fakeDebugger();
  await Actions.performAction(1, { action: 'scroll', x: 100, y: 100, deltaY: 400 }, 2);
  assert.deepEqual(calls[0].params, { type: 'mouseWheel', x: 50, y: 50, deltaX: 0, deltaY: 400 });
  assert.equal(Actions.waitMs(1), 200);
  assert.equal(Actions.waitMs(99999), 3000);
  assert.equal(Actions.waitMs('x'), 1000);
  const started = Date.now();
  await Actions.performAction(1, { action: 'wait', ms: 200 });
  assert.ok(Date.now() - started >= 150);
});

// ---------------- the goal, and starting at once ----------------
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@x.co', name: 'Ana' };
const tasks = [];
installNeon([
  [/^select domain from browser_trusted_sites where user_id/, () => [{ domain: 'portal.edu.do' }]],
  [/^select 1 from browser_links where user_id/, () => [{ x: 1 }]],
  [/^insert into browser_tasks/, ([user_id, goal, start_url, max]) => { tasks.push({ user_id, goal, start_url, max }); return [{ id: `t${tasks.length}`, goal, start_url, status: 'running', action_count: 0, max_actions: max, created_at: new Date().toISOString() }]; }],
]);
const ctx = { getUser: async () => USER };
const toolset = (text = 'llena el formulario en el portal') => createToolset({ context: ctx, env: process.env, intent: intentFromMessages([{ role: 'user', content: text }]) });
const wakes = (set) => set.actions.filter((a) => a.type === 'browser_wake').length;

t('"llena el formulario en la plataforma" offers the browser tools (it used to offer none)', () => {
  for (const text of ['llena este formulario en la plataforma', 'rellena la solicitud', 'entra al portal y inscríbeme', 'dale clic al botón azul', 'usa el mouse y el teclado']) {
    assert.match(text, connector.route, text);
  }
});

t('a trusted page starts the task at once, with a long goal intact, and tells the page to wake the extension', async () => {
  tasks.length = 0;
  const goal = `Llenar el formulario de inscripción con: nombre Ana Pérez Gómez; correo ana.perez@example.com; teléfono 809-555-0123; dirección Calle Duarte 12, Santo Domingo; carrera Ingeniería de Software; ${'comentario '.repeat(30)}`.trim();
  assert.ok(goal.length > 300 && goal.length < 800);
  const set = toolset();
  const out = await set.execute('browser_task', { start_url: 'https://portal.edu.do/inscripcion', goal });
  assert.ok(out.taskId, JSON.stringify(out));
  assert.equal(tasks[0].goal, goal.replace(/\s+/g, ' '), 'nothing of the data to type is cut');
  assert.equal(Number(tasks[0].max), 40);
  assert.equal(wakes(set), 1, 'the page is told to start the extension now');
});

t('a goal that carries a password, a card or a key is refused before anything starts', async () => {
  tasks.length = 0;
  const set = toolset();
  for (const goal of ['Entrar con mi contraseña es hunter2xyz y llenar el formulario', 'Pagar con la tarjeta 4111 1111 1111 1111', 'Usar la api key sk-abcdefghijklmnopqrstuv']) {
    const out = await set.execute('browser_task', { start_url: 'https://portal.edu.do/', goal });
    assert.match(out.error, /contraseña, una tarjeta o una clave/, goal);
  }
  assert.equal(tasks.length, 0);
  assert.equal(wakes(set), 0);
  // mentioning the word is fine: only the values are refused
  const ok = await toolset().execute('browser_task', { start_url: 'https://portal.edu.do/', goal: 'Llenar el formulario y detenerte cuando pida la contraseña' });
  assert.ok(ok.taskId, JSON.stringify(ok));
});

t('the guide and the tool tell the model to act at once, put the data in the goal and never type passwords', () => {
  assert.match(connector.guide, /llama a browser_task DE UNA VEZ: no expliques límites/);
  assert.match(connector.guide, /Pon en goal TODO lo que hay que teclear/);
  assert.match(connector.guide, /contraseñas, datos de tarjeta o pago, ni códigos de seguridad/);
  const tool = connector.tools.find((x) => x.declaration.name === 'browser_task').declaration;
  assert.match(tool.description, /sin poner excusas/);
  assert.match(tool.parameters.properties.goal.description, /todos los datos que debe escribir/);
});
