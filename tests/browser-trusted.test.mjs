// Pages the user trusts: Eddie opens them and works inside them without asking each time. Only a card the user
// confirms adds one; the rules that never change (public https, no passwords or payments, messaging only drafts) stay.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
process.env.APP_URL = 'https://eddie-asistent.vercel.app';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const T = await import(`${root}/api/_lib/browser/trusted.js`);
const { createToolset, confirmTool, intentFromMessages } = await import(`${root}/api/_lib/connectors/registry.js`);
const { handleBrowserRoute } = await import(`${root}/api/_lib/browser/handlers.js`);
const connector = (await import(`${root}/api/_lib/connectors/browser/index.js`)).default;
const t = (name, fn) => test(name, fn);

// ---------------- the fake database ----------------
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@x.co', name: 'Ana' };
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'otro@x.co', name: 'Otro' };
const trusted = []; // { user_id, domain }
const tasks = [];
const queue = [];
const links = new Set([USER.id]);
installNeon([
  [/^select domain from browser_trusted_sites where user_id/, ([u]) => trusted.filter((r) => r.user_id === u).map((r) => ({ domain: r.domain }))],
  [/^insert into browser_trusted_sites/, ([user_id, domain]) => { if (!trusted.some((r) => r.user_id === user_id && r.domain === domain)) trusted.push({ user_id, domain }); return []; }],
  [/^delete from browser_trusted_sites where user_id/, ([u, d]) => {
    const i = trusted.findIndex((r) => r.user_id === u && r.domain === d);
    if (i < 0) return [];
    trusted.splice(i, 1);
    return [{ domain: d }];
  }],
  [/^select 1 from browser_links where user_id/, ([u]) => (links.has(u) ? [{ x: 1 }] : [])],
  [/^select user_id, name, version, last_seen_at, auto_meetings, lead_minutes, open_created from browser_links where user_id/, ([u]) =>
    (links.has(u) ? [{ user_id: u, name: 'Chrome', version: '1.2.1', last_seen_at: new Date().toISOString(), auto_meetings: true, lead_minutes: 1, open_created: true }] : [])],
  [/^insert into browser_commands/, ([user_id, url, label]) => { queue.push({ user_id, url, label }); return [{ id: `c${queue.length}` }]; }],
  [/^insert into browser_tasks/, ([user_id, goal, start_url]) => { tasks.push({ user_id, goal, start_url }); return [{ id: `t${tasks.length}`, goal, start_url, status: 'running', action_count: 0, max_actions: 25, created_at: new Date().toISOString() }]; }],
  [/^select id, user_id, name, topic.*sessions|^select u\.id, u\.email.* from sessions s join users u/, () => [{ ...USER, expires_at: new Date(Date.now() + 86400000).toISOString() }]],
]);
const ctxOf = (user = USER) => ({ getUser: async () => user, emit() {} });
const run = (name, args, user) => connector.tools.find((x) => x.declaration.name === name).run(args, ctxOf(user));

// ---------------- the rules for a domain ----------------
t('domainOf: a page in any form becomes its domain; non-public or shared hosts are refused', () => {
  for (const [input, domain] of [['canva.com', 'canva.com'], ['https://www.canva.com/design/abc', 'canva.com'], ['  Notion.SO/', 'notion.so'], ['app.miempresa.com.do', 'app.miempresa.com.do'], ['mi-sitio.vercel.app', 'mi-sitio.vercel.app']]) assert.equal(T.domainOf(input).domain, domain, input);
  for (const bad of ['', '   ', 'localhost', 'http://canva.com', 'https://user:pass@canva.com', '192.168.1.5', 'http://10.0.0.2/admin', 'intranet.empresa.local', 'canva', 'ftp://canva.com']) assert.ok(T.domainOf(bad).error, bad);
  for (const shared of ['vercel.app', 'github.io', 'blogspot.com', 'com.do', 'co.uk', 'gob.mx', 'pages.dev']) assert.match(T.domainOf(shared).error, /sitio compartido/, shared);
});

// ---------------- the list ----------------
t('trusted sites: add, repeat, limit, remove, and each user has their own', async () => {
  trusted.length = 0;
  assert.deepEqual(await T.addTrusted(USER.id, 'canva.com'), { added: true });
  assert.deepEqual(await T.addTrusted(USER.id, 'canva.com'), { added: false, already: true });
  assert.deepEqual(await T.listTrusted(USER.id), ['canva.com']);
  assert.deepEqual(await T.listTrusted(OTHER.id), []);
  for (let i = 0; i < T.MAX_TRUSTED - 1; i += 1) await T.addTrusted(USER.id, `sitio${i}.com`);
  assert.deepEqual(await T.addTrusted(USER.id, 'uno-mas.com'), { added: false, full: true });
  assert.equal(await T.removeTrusted(OTHER.id, 'canva.com'), false, 'nobody removes another user\'s');
  assert.equal(await T.removeTrusted(USER.id, 'canva.com'), true);
  assert.equal(await T.removeTrusted(USER.id, 'canva.com'), false);
});

t('isTrustedForUser: the built-in places, the user\'s own (and their subdomains), nothing else', async () => {
  trusted.length = 0;
  await T.addTrusted(USER.id, 'canva.com');
  const yes = (u) => T.isTrustedForUser(USER.id, u);
  assert.equal(await yes('https://docs.google.com/document/d/1'), true);
  assert.equal(await yes('https://www.canva.com/design'), true);
  assert.equal(await yes('https://app.canva.com/x'), true);
  assert.equal(await yes('https://notcanva.com/'), false, 'a different domain that merely ends the same way');
  assert.equal(await yes('https://canva.com.evil.io/'), false);
  assert.equal(await yes('https://otra-pagina.com/'), false);
  assert.equal(await yes('http://canva.com/'), false, 'http never');
  assert.equal(await yes('https://192.168.1.4/'), false, 'a network address never');
  assert.equal(await T.isTrustedForUser(OTHER.id, 'https://www.canva.com/'), false, 'trust is per user');
});

// ---------------- the tools, through the registry (what the model really goes through) ----------------
const toolset = (user = USER) => createToolset({ context: ctxOf(user), env: process.env, intent: intentFromMessages([{ role: 'user', content: 'abre canva en mi navegador' }]) });

t('a page that is not trusted still asks: open_website and browser_task raise a card', async () => {
  trusted.length = 0; queue.length = 0; tasks.length = 0;
  const set = toolset();
  const opened = await set.execute('open_website', { url: 'https://www.canva.com/' });
  assert.equal(opened.status, 'awaiting_confirmation');
  assert.equal(set.confirmations.at(-1).tool, 'open_website');
  const task = await set.execute('browser_task', { start_url: 'https://www.canva.com/', goal: 'crear un diseño' });
  assert.equal(task.status, 'awaiting_confirmation');
  assert.equal(queue.length, 0);
  assert.equal(tasks.length, 0);
  assert.match((await set.execute('open_in_browser', { url: 'https://www.canva.com/' })).error, /open_website/);
});

t('trust_site always raises a card, and nothing is trusted until the user confirms it', async () => {
  trusted.length = 0;
  const set = toolset();
  const out = await set.execute('trust_site', { site: 'https://www.canva.com/design' });
  assert.equal(out.status, 'awaiting_confirmation');
  const card = set.confirmations.at(-1);
  assert.equal(card.preview.danger, true);
  assert.equal(card.preview.confirmLabel, 'Sí, confiar');
  assert.equal(card.preview.fields[0].value, 'canva.com');
  assert.match(card.preview.fields[1].value, /sin pedirte permiso/);
  assert.deepEqual(await T.listTrusted(USER.id), [], 'the card alone changes nothing');
  const done = await confirmTool({ name: 'trust_site', args: card.args, context: ctxOf() });
  assert.match(done.result.summary, /Listo/);
  assert.deepEqual(await T.listTrusted(USER.id), ['canva.com']);
  // asking again, an unusable site and a shared host are refused before any card
  assert.match((await toolset().execute('trust_site', { site: 'canva.com' })).error, /Ya confías/);
  assert.match((await toolset().execute('trust_site', { site: '192.168.0.10' })).error, /públicas con https/);
  assert.match((await toolset().execute('trust_site', { site: 'vercel.app' })).error, /compartido/);
  // not signed in: no card
  assert.match((await toolset(null).execute('trust_site', { site: 'otro.com' })).error, /inicia sesión/);
});

t('on a trusted page: open_website and browser_task go straight through, with no card', async () => {
  queue.length = 0; tasks.length = 0;
  const set = toolset();
  const opened = await set.execute('open_website', { url: 'https://www.canva.com/' });
  assert.equal(opened.requested, true, JSON.stringify(opened));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].url, 'https://www.canva.com/');
  const task = await set.execute('browser_task', { start_url: 'https://www.canva.com/design', goal: '  crear   un diseño de logo  ' });
  assert.ok(task.taskId, JSON.stringify(task));
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].goal, 'crear un diseño de logo', 'the model\'s words are cleaned before they run');
  assert.equal(set.confirmations.length, 0);
  assert.equal((await set.execute('open_in_browser', { url: 'https://www.canva.com/x' })).requested, true);
  // another user with the same page untrusted still gets the card
  const other = toolset(OTHER);
  assert.equal((await other.execute('open_website', { url: 'https://www.canva.com/' })).status, 'awaiting_confirmation');
});

t('what trust does not change: private addresses, the password link, a lookalike domain and messaging rules', async () => {
  const set = toolset();
  assert.match((await set.execute('browser_task', { start_url: 'http://canva.com/', goal: 'x' })).error, /https/);
  assert.match((await set.execute('browser_task', { start_url: 'https://192.168.1.2/', goal: 'x' })).error, /https/);
  assert.equal((await set.execute('open_website', { url: 'https://canva.com.evil.io/' })).status, 'awaiting_confirmation');
  assert.equal((await set.execute('browser_task', { start_url: 'https://notcanva.com/', goal: 'crear algo' })).status, 'awaiting_confirmation');
  assert.match((await set.execute('browser_task', { start_url: 'https://www.canva.com/', goal: '' })).error, /qué debe hacer/);
  // a trusted messaging site: one drafted reply, never watching a conversation
  await T.addTrusted(USER.id, 'instagram.com');
  assert.match((await set.execute('browser_task', { start_url: 'https://www.instagram.com/direct', goal: 'contesta todos los mensajes automáticamente' })).error, /nunca vigila conversaciones/);
  tasks.length = 0;
  const one = await set.execute('browser_task', { start_url: 'https://www.instagram.com/direct', goal: 'redacta una respuesta a Ana' });
  assert.ok(one.taskId);
  assert.match(one.note, /nunca|sin enviar/i);
});

t('untrust_site and list_trusted_sites', async () => {
  const set = toolset();
  const listed = await set.execute('list_trusted_sites', {});
  assert.deepEqual(listed.sites.sort(), ['canva.com', 'instagram.com']);
  assert.match(listed.summary, /canva\.com/);
  assert.match((await set.execute('untrust_site', { site: 'https://www.canva.com' })).summary, /vuelvo a pedirte confirmación/);
  assert.match((await set.execute('untrust_site', { site: 'canva.com' })).error, /no estaba/);
  assert.equal((await set.execute('open_website', { url: 'https://www.canva.com/' })).status, 'awaiting_confirmation', 'asks again once removed');
});

t('the hub shows the list, and the user can remove a site from there (their own only)', async () => {
  trusted.length = 0;
  await T.addTrusted(USER.id, 'canva.com');
  await T.addTrusted(OTHER.id, 'canva.com');
  const details = await connector.details(USER);
  assert.deepEqual(details.trusted, ['canva.com']);
  assert.equal(details.browser.name, 'Chrome');
  assert.deepEqual((await connector.details(null)).trusted, []);
  const removed = await handleBrowserRoute({ method: 'POST', path: ['browser', 'trusted-remove'], cookies: { eddie_session: 's' }, body: { domain: 'https://www.canva.com' } });
  assert.equal(removed.status, 200, JSON.stringify(removed));
  assert.deepEqual(removed.json.trusted, []);
  assert.deepEqual(await T.listTrusted(OTHER.id), ['canva.com'], 'the other user\'s stays');
  assert.equal((await handleBrowserRoute({ method: 'POST', path: ['browser', 'trusted-remove'], cookies: { eddie_session: 's' }, body: { domain: 'localhost' } })).status, 400);
});
