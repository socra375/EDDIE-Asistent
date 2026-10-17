// Pestañas a su hora: abrir, cerrar y editar las que ya están abiertas, ahora, al encender el PC o a una hora exacta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const T = await import(`${root}/api/_lib/routines/tabs.js`);
const A = await import(`${root}/api/_lib/routines/actions.js`);
const P = await import(`${root}/api/_lib/routines/plans.js`);
const { runTabs } = await import(`${root}/api/_lib/routines/tabsRun.js`);
const D = await import(`${root}/api/_lib/connectors/dates.js`);
const X = await import(`${root}/extension/tabs.js`);
const t = (name, fn) => test(name, fn);

// ---------------- sites ----------------
const SITES = ['youtube.com', 'https://www.YouTube.com/watch?v=1', 'www.youtube.com', 'music.youtube.com', 'mail.google.com/mail/u/0', 'HTTP://Canva.com', ' x.co ', 'localhost', '192.168.1.5', 'intranet.local', 'solo', '', null, undefined, 'a b', 'ftp://x.com', 'https://user:pass@evil.com/x', `${'a'.repeat(90)}.com`];

t('a site is a plain public domain; the server and the extension agree on every input', () => {
  assert.equal(T.normalizeSite('https://www.YouTube.com/watch?v=1'), 'youtube.com');
  assert.equal(T.normalizeSite('music.youtube.com'), 'music.youtube.com');
  assert.equal(T.normalizeSite('localhost'), null);
  assert.equal(T.normalizeSite('192.168.1.5'), null);
  assert.equal(T.normalizeSite('intranet.local'), null);
  assert.equal(T.normalizeSite('solo'), null);
  for (const input of SITES) assert.equal(X.normalizeSite(input), T.normalizeSite(input), String(input));
});

t('a site matches itself and its subdomains, never a look-alike', () => {
  assert.equal(X.siteMatches('https://www.youtube.com/watch?v=1', ['youtube.com']), true);
  assert.equal(X.siteMatches('https://music.youtube.com/', ['youtube.com']), true);
  assert.equal(X.siteMatches('https://notyoutube.com/', ['youtube.com']), false);
  assert.equal(X.siteMatches('https://youtube.com.evil.co/', ['youtube.com']), false);
  assert.equal(X.siteMatches('https://youtube.com@evil.co/', ['youtube.com']), false);
  assert.equal(X.siteMatches('not a url', ['youtube.com']), false);
  assert.equal(X.siteMatches('https://mail.google.com/', ['google.com']), true);
  assert.equal(X.siteMatches('https://docs.google.com/', ['mail.google.com']), false);
});

t('which tabs an order reaches: only the sites named, never pinned (to close), never Eddie\'s own tab, at most 30', () => {
  const tab = (id, url, extra = {}) => ({ id, url, pinned: false, ...extra });
  const tabs = [tab(1, 'https://www.youtube.com/a'), tab(2, 'https://music.youtube.com/b'), tab(3, 'https://youtube.com/c', { pinned: true }), tab(4, 'https://eddie-asistent.vercel.app/'), tab(5, 'https://canva.com/'), tab(6, undefined), { url: 'https://youtube.com/x' }];
  assert.deepEqual(X.pickTabs(tabs, ['youtube.com']).map((x) => x.id), [1, 2]);
  assert.deepEqual(X.pickTabs(tabs, ['youtube.com'], { includePinned: true }).map((x) => x.id), [1, 2, 3]);
  assert.deepEqual(X.pickTabs(tabs, ['vercel.app'], { own: 'https://eddie-asistent.vercel.app' }).map((x) => x.id), [], 'Eddie\'s own tab is untouchable');
  assert.deepEqual(X.pickTabs(tabs, [], {}), []);
  assert.deepEqual(X.pickTabs(tabs, ['', 'localhost'], {}), []);
  const many = Array.from({ length: 80 }, (_, i) => tab(100 + i, `https://youtube.com/${i}`));
  assert.equal(X.pickTabs(many, ['youtube.com']).length, X.MAX_TABS_PER_STEP);
});

// ---------------- the actions ----------------
t('close_tabs and edit_tabs are validated like the rest, with answers the model can act on', () => {
  const ok = A.validateActions([{ type: 'close_tabs', sites: ['https://www.YouTube.com/x', 'youtube.com', 'canva.com'] }, { type: 'edit_tabs', op: 'go_to', sites: 'canva.com', url: 'https://www.google.com' }, { type: 'edit_tabs', op: 'mute', sites: ['x.co'] }, { type: 'close_tabs', scope: 'eddie' }]);
  assert.deepEqual(ok.actions, [
    { type: 'close_tabs', sites: ['youtube.com', 'canva.com'] },
    { type: 'edit_tabs', op: 'go_to', sites: ['canva.com'], url: 'https://www.google.com/' },
    { type: 'edit_tabs', op: 'mute', sites: ['x.co'] },
    { type: 'close_tabs', scope: 'eddie' },
  ]);
  assert.match(A.validateActions([{ type: 'close_tabs' }]).error, /necesita sites/);
  assert.match(A.validateActions([{ type: 'close_tabs', sites: ['localhost', '192.168.1.1'] }]).error, /necesita sites/);
  assert.match(A.validateActions([{ type: 'edit_tabs', op: 'explode', sites: ['x.co'] }]).error, /reload, go_to, pin, unpin, mute, unmute/);
  assert.match(A.validateActions([{ type: 'edit_tabs', op: 'mute' }]).error, /necesita sites/);
  assert.match(A.validateActions([{ type: 'edit_tabs', op: 'go_to', sites: ['x.co'] }]).error, /necesita url|hace falta url/);
  assert.match(A.validateActions([{ type: 'edit_tabs', op: 'go_to', sites: ['x.co'], url: 'http://insecure.co' }]).error, /url/);
  assert.match(A.validateActions([{ type: 'edit_tabs', op: 'go_to', sites: ['x.co'], url: 'javascript:alert(1)' }]).error, /url/);
  const many = A.validateActions([{ type: 'close_tabs', sites: Array.from({ length: 30 }, (_, i) => `s${i}.com`) }]);
  assert.equal(many.actions[0].sites.length, T.MAX_SITES, 'a handful of sites at most');
});

t('described in plain words', () => {
  assert.equal(A.describeActions([{ type: 'close_tabs', sites: ['youtube.com'] }]), 'cierra las pestañas de youtube.com');
  assert.equal(A.describeActions([{ type: 'close_tabs', scope: 'eddie' }]), 'cierra las pestañas del grupo «Eddie»');
  assert.equal(A.describeActions([{ type: 'edit_tabs', op: 'go_to', sites: ['x.co'], url: 'https://www.google.com/' }]), 'lleva a otra página las pestañas de x.co (a google.com)');
  assert.equal(A.describeActions([{ type: 'edit_tabs', op: 'reload', sites: ['x.co', 'y.co'] }]), 'recarga las pestañas de x.co, y.co');
  assert.equal(T.describeSteps(T.stepsOf([{ type: 'open_sites', urls: ['https://a.co', 'https://b.co'] }, { type: 'close_tabs', sites: ['youtube.com'] }, { type: 'edit_tabs', op: 'pin', sites: ['x.co'] }])), 'abrir 2 páginas; cerrar youtube.com; fijar x.co');
  assert.equal(T.hasTabActions([{ type: 'notify' }, { type: 'close_tabs' }]), true);
  assert.equal(T.hasTabActions([{ type: 'notify' }]), false);
  assert.equal(T.hasTabActions(undefined), false);
});

// ---------------- exact hours in any time zone ----------------
t('zonedEpoch: the instant when a wall clock reads a time, with and without daylight saving', () => {
  const iso = (d, h, tz) => new Date(D.zonedEpoch(d, h, tz)).toISOString();
  assert.equal(iso('2026-10-16', '15:00', 'America/Santo_Domingo'), '2026-10-16T19:00:00.000Z');
  assert.equal(iso('2026-10-16', '15:00', 'UTC'), '2026-10-16T15:00:00.000Z');
  assert.equal(iso('2026-07-01', '09:00', 'America/New_York'), '2026-07-01T13:00:00.000Z', 'summer time');
  assert.equal(iso('2026-12-01', '09:00', 'America/New_York'), '2026-12-01T14:00:00.000Z', 'winter time');
  assert.equal(iso('2026-10-16', '09:00', 'Europe/Madrid'), '2026-10-16T07:00:00.000Z');
  assert.equal(iso('2026-10-16', '08:00', 'Asia/Kolkata'), '2026-10-16T02:30:00.000Z');
  assert.equal(iso('2026-10-16', '00:30', 'Pacific/Auckland'), '2026-10-15T11:30:00.000Z');
});

// ---------------- the plans the extension keeps ----------------
const TZ = 'America/Santo_Domingo';
const routine = (over = {}) => ({ id: '11111111-1111-4111-8111-111111111111', name: 'Cerrar YouTube', time: '15:00', days: null, actions: [{ type: 'close_tabs', sites: ['youtube.com'] }], state: {}, ...over });
const plans = (routines, now, tz = TZ) => P.upcomingPlans('u1', { timezone: tz, now: new Date(now) }, { scheduleRoutinesOf: async () => routines });

t('a plan is the next time its hour comes, in the user\'s zone, with the key the extension will report', async () => {
  const out = await plans([routine()], '2026-10-16T17:00:00Z'); // 13:00 there
  assert.equal(out[0].key, '11111111-1111-4111-8111-111111111111@2026-10-16');
  assert.equal(out[0].at, Date.parse('2026-10-16T19:00:00Z'));
  assert.deepEqual(out[0].steps, [{ type: 'close', sites: ['youtube.com'] }]);
  assert.equal(out[1].key.endsWith('@2026-10-17'), true, 'and tomorrow\'s too');
  assert.equal(out.length, 2);
});

t('only its days, and a plan done today is not offered again', async () => {
  const weekdays = routine({ days: [1, 2, 3, 4, 5] });
  const friday = await plans([weekdays], '2026-10-16T17:00:00Z'); // friday 13:00
  assert.deepEqual(friday.map((p) => p.key.split('@')[1]), ['2026-10-16'], 'saturday and sunday are skipped');
  const done = await plans([routine({ state: { tabsDoneOn: '2026-10-16' } })], '2026-10-16T17:00:00Z');
  assert.deepEqual(done.map((p) => p.key.split('@')[1]), ['2026-10-17']);
});

t('a plan a few minutes late still runs (the browser was closed); an old one and one far ahead do not', async () => {
  const late = await plans([routine()], '2026-10-16T19:10:00Z');
  assert.ok(late.some((p) => p.key.endsWith('@2026-10-16')), '10 minutes late: still offered');
  const old = await plans([routine()], '2026-10-16T19:20:00Z');
  assert.ok(!old.some((p) => p.key.endsWith('@2026-10-16')), '20 minutes late: let go');
  const far = await plans([routine({ time: '23:30' })], '2026-10-16T09:00:00Z'); // 5:00 there: tomorrow's 23:30 is 42 h away
  assert.deepEqual(far.map((p) => p.key.split('@')[1]), ['2026-10-16']);
});

t('a «once» routine is a single occurrence; routines without tab orders or without an hour are not plans', async () => {
  const once = await plans([routine({ state: { once: true } })], '2026-10-16T17:00:00Z');
  assert.equal(once.length, 1);
  const none = await plans([routine({ actions: [{ type: 'notify', text: 'x' }] }), routine({ time: null }), routine({ time: 'tarde' })], '2026-10-16T17:00:00Z');
  assert.deepEqual(none, []);
  const mixed = await plans([routine({ actions: [{ type: 'notify', text: 'x' }, { type: 'open_sites', urls: ['https://www.youtube.com/'] }, { type: 'summary' }] })], '2026-10-16T17:00:00Z');
  assert.deepEqual(mixed[0].steps, [{ type: 'open', urls: ['https://www.youtube.com/'] }], 'only the browser part');
});

t('plans are sorted, capped, and a bad time zone falls back to UTC', async () => {
  const many = Array.from({ length: 30 }, (_, i) => routine({ id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, time: `${String(8 + (i % 12)).padStart(2, '0')}:00` }));
  const out = await plans(many, '2026-10-16T05:00:00Z');
  assert.ok(out.length <= 20);
  assert.deepEqual(out.map((p) => p.at), [...out.map((p) => p.at)].sort((a, b) => a - b));
  const utc = await plans([routine()], '2026-10-16T10:00:00Z', 'Mars/Olympus');
  assert.equal(utc[0].at, Date.parse('2026-10-16T15:00:00Z'));
});

t('plan done: only a real key of the user\'s routine, a «once» routine ends', async () => {
  const calls = [];
  const deps = (state) => ({ markTabsDone: async (user, id, date) => { calls.push(['done', user, id, date]); return state; }, disableRoutine: async (id) => calls.push(['disable', id]) });
  assert.equal((await P.completePlan('u1', 'cualquier cosa', deps({}))).error, 'Esa clave no es de un plan.');
  assert.equal((await P.completePlan('u1', '../x@2026-10-16', deps({}))).error, 'Esa clave no es de un plan.');
  assert.equal((await P.completePlan('u1', '11111111-1111-4111-8111-111111111111@2026-10-16', deps(null))).error, 'Esa rutina no es tuya o ya no existe.');
  assert.equal((await P.completePlan('u1', '11111111-1111-4111-8111-111111111111@2026-10-16', deps({}))).ok, true);
  assert.ok(!calls.some((c) => c[0] === 'disable'));
  assert.equal((await P.completePlan('u1', '11111111-1111-4111-8111-111111111111@2026-10-16', deps({ once: true }))).ok, true);
  assert.deepEqual(calls.at(-1), ['disable', '11111111-1111-4111-8111-111111111111']);
});

// ---------------- sending the order ----------------
const user = { id: 'u1', name: 'Ana' };
const sendDeps = (over = {}) => {
  const log = { orders: [], jobs: [] };
  return {
    log,
    deps: {
      linkByUser: async () => ({ name: 'Chrome en Windows', lastSeen: new Date(Date.now() - 20_000).toISOString() }),
      enqueue: async (_u, order) => { log.orders.push(order); return 'c1'; },
      devicesByUser: async () => [{ id: 'dev1', tools: [{ name: 'start_browser' }, { name: 'say_text' }] }],
      createJob: async (id, tool, args) => { log.jobs.push({ id, tool, args }); },
      ...over,
    },
  };
};

t('the order waits fifteen minutes for the browser, with its key, and says what it asked', async () => {
  const { log, deps } = sendDeps();
  const steps = T.stepsOf([{ type: 'close_tabs', sites: ['youtube.com'] }]);
  const line = await runTabs(user, steps, 'r1@2026-10-16', { deps });
  assert.match(line, /^🌐 Pedí al navegador: cerrar youtube\.com\.$/);
  assert.deepEqual(log.orders[0], { url: 'eddie:tabs', kind: 'tabs', payload: { steps, key: 'r1@2026-10-16' }, ttl: 900 });
  assert.equal(log.jobs.length, 0, 'the extension was heard from seconds ago: the browser is open');
});

t('a browser that has not been heard from is asked to start (the one with the extension), by the computer\'s agent', async () => {
  const { log, deps } = sendDeps({ linkByUser: async () => ({ name: 'Microsoft Edge en Windows', lastSeen: new Date(Date.now() - 3600_000).toISOString() }) });
  const line = await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { deps });
  assert.match(line, /le pedí a tu PC que lo abra/);
  assert.deepEqual(log.jobs, [{ id: 'dev1', tool: 'start_browser', args: { browser: 'edge' } }]);
  assert.equal('key' in log.orders[0].payload, false);
  const never = sendDeps({ linkByUser: async () => ({ name: 'Chrome', lastSeen: null }) });
  await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { deps: never.deps });
  assert.equal(never.log.jobs.length, 1);
  const forced = sendDeps();
  await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { forceStart: true, deps: forced.deps });
  assert.equal(forced.log.jobs.length, 1, 'at start-up it always asks');
});

t('without an agent that can start a browser the order still waits; without a linked browser it says so', async () => {
  const old = sendDeps({ linkByUser: async () => ({ name: 'Chrome', lastSeen: null }), devicesByUser: async () => [{ id: 'dev1', tools: [{ name: 'say_text' }] }] });
  const line = await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { deps: old.deps });
  assert.doesNotMatch(line, /le pedí a tu PC/);
  assert.equal(old.log.orders.length, 1);
  const none = sendDeps({ linkByUser: async () => null });
  assert.match(await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { deps: none.deps }), /no tienes tu navegador vinculado/);
  assert.equal(none.log.orders.length, 0);
  assert.equal(await runTabs(user, [], null, { deps: none.deps }), '');
  const broken = sendDeps({ enqueue: async () => { throw new Error('base caída'); } });
  assert.match(await runTabs(user, [{ type: 'open', urls: ['https://a.co/'] }], null, { deps: broken.deps }), /No pude pedirle a tu navegador.*base caída/);
});

// ---------------- the routine as the cron runs it ----------------
const log = [];
const orders = [];
const jobs = [];
installNeon([
  [/^select user_id, name, version, last_seen_at.* from browser_links where user_id/, () => [{ user_id: 'u1', name: 'Chrome en Windows', version: '1.6.0', last_seen_at: new Date().toISOString(), auto_meetings: true, lead_minutes: 1, open_created: true }]],
  [/^delete from browser_commands where created_at/, () => []],
  [/^insert into browser_commands/, ([user_id, url, label, closeAt, kind, payload, ttl]) => { orders.push({ url, kind, payload: JSON.parse(payload), ttl }); return [{ id: 'c1' }]; }],
]);

t('the cron sends all the routine\'s tab orders together, once, and what is skipped is not sent', async () => {
  orders.length = 0; log.length = 0;
  const actions = [{ type: 'notify', text: 'Hola' }, { type: 'open_sites', urls: ['https://a.co/'] }, { type: 'close_tabs', sites: ['youtube.com'] }, { type: 'edit_tabs', op: 'reload', sites: ['b.co'] }];
  const text = await A.runRoutineActions(actions, { user, timezone: TZ, tabKey: 'r1@2026-10-16' });
  assert.equal(orders.length, 1, 'one order, not three');
  assert.deepEqual(orders[0].payload, { key: 'r1@2026-10-16', steps: [{ type: 'open', urls: ['https://a.co/'] }, { type: 'close', sites: ['youtube.com'] }, { type: 'edit', op: 'reload', sites: ['b.co'] }] });
  assert.equal(Number(orders[0].ttl), 900);
  assert.match(text, /^Hola\n\n🌐 Pedí al navegador: abrir 1 página; cerrar youtube\.com; recargar b\.co\.$/);
  orders.length = 0;
  const skipped = await A.runRoutineActions(actions, { user, timezone: TZ, skip: ['open_sites', 'close_tabs', 'edit_tabs'] });
  assert.equal(orders.length, 0);
  assert.equal(skipped, 'Hola');
});

// ---------------- the door to the extension ----------------
const H = await import(`${root}/api/_lib/browser/handlers.js`);
const S = await import(`${root}/api/_lib/browser/store.js`);

t('what the extension is handed: the order\'s steps and key, with a longer wait than a page', async () => {
  const taken = [];
  const restore = installNeon([
    [/^update browser_commands set taken_at = now\(\)/, () => taken],
  ]);
  try {
    taken.push(
      { id: 'a', url: 'https://x.co/', label: null, created_at: new Date(Date.now() - 2000).toISOString(), close_at: null, kind: 'open', payload: null },
      { id: 'b', url: 'eddie:tabs', label: null, created_at: new Date().toISOString(), close_at: null, kind: 'tabs', payload: { steps: [{ type: 'close', sites: ['youtube.com'] }], key: 'r1@2026-10-16' } },
    );
    const out = await S.takeCommands('u1');
    assert.deepEqual(out[0], { id: 'a', url: 'https://x.co/', label: '' });
    assert.deepEqual(out[1], { id: 'b', url: 'eddie:tabs', label: '', kind: 'tabs', steps: [{ type: 'close', sites: ['youtube.com'] }], key: 'r1@2026-10-16' });
  } finally {
    restore();
  }
});

t('the wait: a tab order stays valid for its own time, a plain page for two minutes (sql)', async () => {
  let seen = '';
  const restore = installNeon([[/^update browser_commands set taken_at = now\(\)/, (_p, q) => { seen = q; return []; }]]);
  try {
    await S.takeCommands('u1');
    assert.match(seen, /coalesce\(ttl_seconds, \$2\)/);
  } finally {
    restore();
  }
});

t('manage_tabs: a card first, the same cleaning as a routine, nothing for a bad order', async () => {
  const browser = (await import(`${root}/api/_lib/connectors/browser/index.js`)).default;
  const tool = browser.tools.find((x) => x.declaration.name === 'manage_tabs');
  assert.equal(tool.risk, 'write');
  const card = tool.prepare({ op: 'close', sites: 'https://www.youtube.com/watch, canva.com' });
  assert.equal(card.preview.title, 'Cerrar pestañas');
  assert.match(card.preview.fields[0].value, /^Cierra las pestañas de youtube\.com, canva\.com$/);
  assert.match(card.preview.fields[1].value, /sin guardar.*fijadas/);
  assert.deepEqual(card.args, { op: 'close', sites: 'youtube.com, canva.com' });
  assert.equal(tool.prepare({ op: 'go_to', sites: 'x.co', url: 'https://www.google.com' }).preview.title, 'Editar pestañas');
  for (const bad of [{ op: 'explode', sites: 'x.co' }, { op: 'close' }, { op: 'close', sites: 'localhost' }, { op: 'go_to', sites: 'x.co' }, { op: 'go_to', sites: 'x.co', url: 'http://no-https.co' }, {}]) {
    assert.ok(tool.prepare(bad).error, JSON.stringify(bad));
  }
  assert.deepEqual(tool.prepare({ op: 'close_eddie' }).args, { op: 'close_eddie' });
  const orders2 = [];
  const restore = installNeon([
    [/^select user_id, name, version, last_seen_at.* from browser_links where user_id/, () => [{ user_id: 'u1', name: 'Chrome', version: '1.6.0', last_seen_at: new Date().toISOString(), auto_meetings: true, lead_minutes: 1, open_created: true }]],
    [/^delete from browser_commands where created_at/, () => []],
    [/^insert into browser_commands/, ([, url, , , kind, payload]) => { orders2.push({ url, kind, payload: JSON.parse(payload) }); return [{ id: 'c1' }]; }],
  ]);
  try {
    const done = await tool.run(card.args, { getUser: async () => user });
    assert.equal(done.requested, true);
    assert.match(done.summary, /cierra las pestañas de youtube\.com, canva\.com/);
    assert.match(done.note, /no lo afirmes/);
    assert.deepEqual(orders2[0].payload.steps, [{ type: 'close', sites: ['youtube.com', 'canva.com'] }]);
    assert.equal((await tool.run(card.args, { getUser: async () => null })).error.includes('inicia sesión'), true);
  } finally {
    restore();
  }
});

t('the connectors teach the model: routines for an hour, manage_tabs for now, no promises about what is inside a page', async () => {
  const routines = (await import(`${root}/api/_lib/connectors/routines/index.js`)).default;
  assert.match(routines.guide, /PESTAÑAS A SU HORA/);
  assert.match(routines.guide, /once=true/);
  assert.match(routines.guide, /manage_tabs/);
  assert.match(routines.tools[0].declaration.description, /close_tabs/);
  assert.match(routines.tools[0].declaration.description, /edit_tabs/);
  assert.ok(routines.tools[0].declaration.parameters.properties.once);
  assert.ok(routines.route.test('a las 3 cierra YouTube'));
  assert.ok(routines.route.test('mañana a las nueve abre mi correo'));
  assert.ok(!routines.route.test('cuéntame un chiste'));
  const browser = (await import(`${root}/api/_lib/connectors/browser/index.js`)).default;
  assert.ok(browser.route.test('cierra las pestañas de youtube'));
  assert.match(browser.guide, /manage_tabs/);
});

// ---------------- the cron and the extension do not step on each other ----------------
const { runRoutines } = await import(`${root}/api/_lib/routines/run.js`);
const cronRoutine = (over = {}) => ({ id: 'r1', user_id: 'u1', name: 'Cerrar YouTube', time: '15:00', days: null, actions: [{ type: 'notify', text: 'Hola' }, { type: 'close_tabs', sites: ['youtube.com'] }], last_run_on: null, chat_id: 555, timezone: TZ, email: 'a@x.co', user_name: 'Ana', state: {}, ...over });
const cronState = { routines: [], disabled: [], orders: [] };

t('the cron: when the extension already did the tab orders only the rest is done; a «once» routine ends', async () => {
  const sent = [];
  const restore = installNeon([
    [/^select r\.id, r\.user_id, r\.name, r\.time, r\.days, r\.actions, r\.last_run_on, l\.chat_id/, () => cronState.routines],
    [/^select r\.id, r\.user_id, r\.name, r\.days, r\.event_type, r\.device_id/, () => []],
    [/^update routines set last_run_on = \$1 where id = \$2/, ([date, id]) => { const r = cronState.routines.find((x) => x.id === id); if (!r || r.last_run_on === date) return []; r.last_run_on = date; return [{ id }]; }],
    [/^update routines set enabled = false where id/, ([id]) => { cronState.disabled.push(id); return []; }],
    [/^select user_id, name, version, last_seen_at.* from browser_links where user_id/, () => [{ user_id: 'u1', name: 'Chrome', version: '1.6.0', last_seen_at: new Date().toISOString(), auto_meetings: true, lead_minutes: 1, open_created: true }]],
    [/^delete from browser_commands where created_at/, () => []],
    [/^insert into browser_commands/, ([, , , , , payload]) => { cronState.orders.push(JSON.parse(payload)); return [{ id: 'c1' }]; }],
  ]);
  const send = async (_chat, text) => { sent.push(text); return { ok: true }; };
  const push = async () => ({ sent: 0 });
  try {
    const at = new Date('2026-10-16T19:01:00Z'); // 15:01 in Santo Domingo, one minute after the hour
    // 1. the extension did it at 15:00 and said so
    cronState.routines = [cronRoutine({ state: { tabsDoneOn: '2026-10-16' } })];
    await runRoutines({ now: at, send, push });
    assert.equal(cronState.orders.length, 0, 'no second order');
    assert.match(sent[0], /Hola/);
    assert.doesNotMatch(sent[0], /Pedí al navegador/);
    // 2. the extension could not (browser closed): the cron sends the order with the plan\'s key
    sent.length = 0;
    cronState.routines = [cronRoutine()];
    await runRoutines({ now: at, send, push });
    assert.equal(cronState.orders.length, 1);
    assert.equal(cronState.orders[0].key, 'r1@2026-10-16');
    assert.match(sent[0], /Pedí al navegador: cerrar youtube\.com/);
    // 3. too late for a tab order to make sense (an hour after): the order is let go, the rest is done
    sent.length = 0;
    cronState.orders.length = 0;
    cronState.routines = [cronRoutine()];
    await runRoutines({ now: new Date('2026-10-16T20:10:00Z'), send, push });
    assert.equal(cronState.orders.length, 0);
    assert.match(sent[0], /Hola/);
    // 4. a routine that only had tab orders, already done, sends nothing at all; and a once routine ends
    sent.length = 0;
    cronState.routines = [cronRoutine({ actions: [{ type: 'close_tabs', sites: ['youtube.com'] }], state: { tabsDoneOn: '2026-10-16', once: true } })];
    await runRoutines({ now: at, send, push });
    assert.deepEqual(sent, []);
    assert.deepEqual(cronState.disabled, ['r1']);
  } finally {
    restore();
  }
});
