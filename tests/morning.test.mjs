// «Buenos días» al encender el PC: lo que dice (agenda, correos, tareas), las páginas que abre mientras habla y cierra
// al terminar, la rutina que lo dispara y el pase de un solo uso con el que el agente pide las palabras.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const S = await import(`${root}/api/_lib/routines/spoken.js`);
const A = await import(`${root}/api/_lib/routines/actions.js`);
const { handleDeviceBoot } = await import(`${root}/api/_lib/routines/boot.js`);
const { serveBrief } = await import(`${root}/api/_lib/routines/morning.js`);
const connector = (await import(`${root}/api/_lib/connectors/routines/index.js`)).default;
const t = (name, fn) => test(name, fn);

const NOW = new Date('2026-10-14T12:30:00Z'); // miércoles 8:30 en Santo Domingo
const TZ = 'America/Santo_Domingo';
const events = [
  { date: '2026-10-14', title: 'Reunión con Ana', start: '09:30', end: '10:00' },
  { date: '2026-10-14', title: 'Clase de cálculo', start: '14:00', end: '15:30' },
  { date: '2026-10-14', title: 'Feriado local', all_day: true },
  { date: '2026-10-15', title: 'Mañana no cuenta', start: '08:00', end: '09:00' },
];
const mail = { status: 'ok', emails: [{ from: '"Banco Popular" <avisos@bp.com>', subject: 'Tu estado de cuenta ya está disponible https://bp.com/x?t=123' }, { from: 'Profe Luis <luis@u.edu>', subject: '🔥🔥 Entrega del proyecto!!!' }] };

// ---------------- the words ----------------
t('the greeting uses the user\'s own day and hour, not the server\'s', () => {
  const brief = S.spokenBrief({ name: 'Marcos Pérez', timezone: TZ, now: NOW, calendar: { status: 'ok', events }, mail });
  assert.equal(brief.pieces[0], 'Buenos días, Marcos. Hoy es miércoles 14 de octubre.');
  // 01:00 UTC is still the evening before in Santo Domingo
  const night = S.spokenBrief({ name: 'Ana', timezone: TZ, now: new Date('2026-10-15T01:00:00Z') });
  assert.equal(night.pieces[0], 'Buenas noches, Ana. Hoy es miércoles 14 de octubre.');
  const afternoon = S.spokenBrief({ timezone: TZ, now: new Date('2026-10-14T19:00:00Z') });
  assert.match(afternoon.pieces[0], /^Buenas tardes\. Hoy es/);
});

t('the agenda: today\'s events only, all-day first, read like a person would', () => {
  const brief = S.spokenBrief({ name: 'Ana', timezone: TZ, now: NOW, calendar: { status: 'ok', events }, mail });
  const agenda = brief.pieces.find((p) => p.startsWith('Hoy tienes'));
  assert.match(agenda, /^Hoy tienes 3 eventos: Feriado local, todo el día; a las 9 y 30, Reunión con Ana; a las 2 en punto, Clase de cálculo\.$/);
  assert.doesNotMatch(agenda, /Mañana no cuenta/);
  assert.equal(brief.wantsCalendar, true);
  assert.equal(S.spokenBrief({ timezone: TZ, now: NOW, calendar: { status: 'ok', events: [] } }).pieces[1], 'No tienes nada en tu agenda para hoy.');
  assert.equal(S.spokenBrief({ timezone: TZ, now: NOW, calendar: { status: 'ok', events: [] } }).wantsCalendar, false);
});

t('the mail: who and what, without links, emoji or shouting', () => {
  const brief = S.spokenBrief({ name: 'Ana', timezone: TZ, now: NOW, mail });
  const piece = brief.pieces.find((p) => p.startsWith('Tienes 2 correos'));
  assert.ok(piece, brief.pieces.join(' | '));
  assert.match(piece, /de Banco Popular, Tu estado de cuenta ya está disponible/);
  assert.match(piece, /de Profe Luis, Entrega del proyecto!/);
  assert.doesNotMatch(piece, /https?:|bp\.com|🔥/);
  assert.equal(brief.wantsMail, true);
  assert.equal(S.spokenBrief({ timezone: TZ, now: NOW, mail: { status: 'ok', emails: [] } }).wantsMail, false);
});

t('whatever a service says about itself is spoken honestly, and an off service is not mentioned', () => {
  const broken = S.spokenBrief({ timezone: TZ, now: NOW, calendar: { status: 'error', message: 'x' }, mail: { status: 'error', message: 'y' } });
  assert.ok(broken.pieces.includes('No pude leer tu agenda ahora.'));
  assert.ok(broken.pieces.includes('No pude revisar tu correo ahora.'));
  assert.equal(broken.wantsMail || broken.wantsCalendar, false, 'nothing to show if nothing was read');
  const off = S.spokenBrief({ timezone: TZ, now: NOW, calendar: { status: 'off' }, mail: { status: 'needs_connect' } });
  assert.equal(off.pieces.length, 1, 'only the greeting');
});

t('tasks and reminders of the day', () => {
  const tasks = [
    { title: 'Entregar el informe', priority: 'alta', dueDate: '2026-10-13' },
    { title: 'Comprar café', priority: 'baja' },
    { title: 'Ya hecha', done: true },
    { title: 'Llamar al banco', priority: 'media' },
  ];
  const reminders = [{ text: 'Pagar la luz', dueAt: '2026-10-14T18:00:00Z' }, { text: 'Otro día', dueAt: '2026-10-20T18:00:00Z' }];
  const brief = S.spokenBrief({ timezone: TZ, now: NOW, tasks, reminders });
  assert.ok(brief.pieces.includes('Tienes 3 tareas pendientes, 1 vencida. Empieza por: Entregar el informe y Llamar al banco.'), brief.pieces.join(' | '));
  assert.ok(brief.pieces.includes('Tienes 1 recordatorio para hoy: Pagar la luz.'));
});

t('it fits in about a minute: what does not fit is dropped from the end, never cut in the middle of a word', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ date: '2026-10-14', title: `Evento número ${i} con un nombre bastante largo para ocupar espacio`, start: `${String(8 + (i % 10)).padStart(2, '0')}:00`, end: '23:00' }));
  const longMail = { status: 'ok', emails: Array.from({ length: 9 }, (_, i) => ({ from: `Persona ${i} <p${i}@x.co>`, subject: 'Asunto '.repeat(30) })) };
  const tasks = Array.from({ length: 12 }, (_, i) => ({ title: `Tarea ${i}`, priority: 'alta' }));
  const brief = S.spokenBrief({ name: 'Ana', timezone: TZ, now: NOW, calendar: { status: 'ok', events: many }, mail: longMail, tasks });
  assert.ok(brief.text.length <= S.MAX_SPOKEN_CHARS, `${brief.text.length} chars`);
  for (const piece of brief.pieces) assert.ok(piece.length <= S.MAX_PIECE_CHARS, piece.length);
  assert.match(brief.pieces[1], /^Hoy tienes 30 eventos/);
  const shown = brief.pieces[1].split(';').length;
  assert.match(brief.pieces[1], new RegExp(`Y ${30 - shown} más\\.$`), 'what is left out is counted, not lost');
  assert.ok(brief.seconds > 0 && brief.seconds < 120, `${brief.seconds}s`);
});

t('speakable: links, emoji and symbols out; length capped at a word', () => {
  assert.equal(S.speakable('Mira https://x.co/a?b=1 ahora 🚀🚀 mismo'), 'Mira ahora mismo');
  assert.equal(S.speakable('<script>alert(1)</script> Hola'), 'script alert(1) script Hola');
  assert.equal(S.speakable('a'.repeat(10) + ' ' + 'b'.repeat(100), 30), 'aaaaaaaaaa');
  assert.equal(S.speakable(null), '');
  assert.equal(S.estimateSpeechSeconds('uno dos tres cuatro cinco'), 2);
});

// ---------------- the routine ----------------
t('the «morning» action: valid, boot-only, described', () => {
  assert.deepEqual(A.validateActions([{ type: 'morning' }]).actions, [{ type: 'morning', pages: true, checkup: true, tune: 'off' }]);
  assert.deepEqual(A.validateActions([{ type: 'morning', pages: false, checkup: false }]).actions, [{ type: 'morning', pages: false, checkup: false, tune: 'off' }]);
  assert.match(A.describeActions([{ type: 'morning', pages: true, checkup: true }]), /te saluda en voz alta.*abre Gmail y el calendario mientras habla y los cierra.*cómo está el equipo/);
  assert.doesNotMatch(A.describeActions([{ type: 'morning', pages: false, checkup: false }]), /abre|equipo/);
});

t('create_routine refuses «morning» on an hour (only the computer can say it)', async () => {
  const create = connector.tools.find((x) => x.declaration.name === 'create_routine');
  const out = await create.run({ time: '08:00', actions: JSON.stringify([{ type: 'morning' }]) }, { getUser: async () => ({ id: 'u1' }), timezone: TZ });
  assert.match(out.error, /solo se usan en rutinas de event="device_boot"/);
});

// ---------------- a fake database ----------------
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@x.co', name: 'Ana Gómez' };
const routines = [];
const jobs = [];
const pending = [];
const commands = [];
let seq = 0;
let agentVersion = '1.11.0';
const joined = (r) => ({ id: r.id, user_id: r.user_id, name: r.name, days: r.days, actions: r.actions, state: r.state, chat_id: 555, timezone: TZ, email: USER.email, user_name: USER.name });
installNeon([
  [/^select r\.id, r\.user_id, r\.name, r\.days, r\.actions, r\.state, l\.chat_id/, ([deviceId]) => routines.filter((r) => r.enabled && r.event_type === 'device_boot' && r.device_id === deviceId).map(joined)],
  [/^update routines set state = state \|\| (.+)::jsonb where id/, ([json, id]) => { pending.push({ id, state: JSON.parse(json) }); return []; }],
  [/^update routines set state = state \|\| jsonb_build_object\('morningOn'/, ([date, id]) => {
    const r = routines.find((x) => x.id === id);
    if (!r || r.state.morningOn === date) return [];
    r.state.morningOn = date;
    return [{ id }];
  }],
  [/^delete from computer_jobs where created_at/, () => []],
  [/^select id, user_id, name, topic, tools, agent_version, platform, last_seen_at from computer_devices where user_id/, () => [{ id: 'dev1', user_id: USER.id, name: 'PC', topic: 't', tools: [], agent_version: agentVersion, platform: 'windows', last_seen_at: new Date().toISOString() }]],
  [/^insert into routines/, ([user_id, name, trigger_type, time, days, event_type, device_id, actionsJson]) => [{ id: 'new1', name, trigger_type, time, days, event_type, device_id, actions: JSON.parse(actionsJson), enabled: true, state: {} }]],
  [/^insert into computer_jobs/, ([device_id, tool, args]) => { jobs.push({ id: `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, '0')}`, device_id, tool, args: JSON.parse(args), status: 'queued', createdAt: Date.now() }); return [{ id: jobs.at(-1).id }]; }],
  // the pass: only for that computer, a morning_brief job that is running, once, and not too old
  [/^update computer_jobs set args = args \|\| '\{"served": true\}'::jsonb where id = \$1 and device_id = \$2 and tool = 'morning_brief'/, ([id, deviceId, mins]) => {
    const job = jobs.find((j) => j.id === id);
    if (!job || job.device_id !== deviceId || job.tool !== 'morning_brief' || job.status !== 'running') return [];
    if (Date.now() - job.createdAt > Number(mins) * 60_000 || job.args.served === true) return [];
    job.args.served = true;
    return [{ args: job.args }];
  }],
  [/^delete from browser_commands where created_at/, () => []], // (enqueue tidies old pages now and then)
  [/^insert into browser_commands/, ([user_id, url, label, closeAt]) => { commands.push({ id: `c${commands.length + 1}`, user_id, url, label, closeAt, createdAt: new Date() }); return [{ id: commands.at(-1).id }]; }],
  [/^update browser_commands set taken_at = now\(\)/, ([userId]) => commands.filter((c) => c.user_id === userId && !c.taken).map((c) => { c.taken = true; return { id: c.id, url: c.url, label: c.label, created_at: c.createdAt.toISOString(), close_at: c.closeAt }; })],
]);

const device = { id: 'dev1', name: 'PC', tools: [{ name: 'morning_brief' }, { name: 'say_text' }, { name: 'open_urls' }] };
const addRoutine = (actions, extra = {}) => routines.push({ id: `r${routines.length + 1}`, user_id: USER.id, name: 'Buenos días', event_type: 'device_boot', device_id: 'dev1', days: null, actions, enabled: true, state: {}, ...extra });

t('at start-up the agent gets a «morning_brief» job with its routine and options, not the words', async () => {
  routines.length = 0; jobs.length = 0; pending.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: false }]);
  await handleDeviceBoot(device, NOW);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].tool, 'morning_brief');
  assert.deepEqual(jobs[0].args, { routine: 'r1', pages: true, checkup: false });
  assert.equal(pending.length, 0, 'nothing left for the cron: the computer does all of it');
});

t('an older agent (no morning_brief) gets nothing queued and the summary goes out written', async () => {
  routines.length = 0; jobs.length = 0; pending.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true }]);
  await handleDeviceBoot({ ...device, tools: [{ name: 'say_text' }] }, NOW);
  assert.equal(jobs.length, 0);
  assert.deepEqual(pending, [{ id: 'r1', state: { pending: true, written: true } }]);
});

t('a morning routine on its other days stays quiet', async () => {
  routines.length = 0; jobs.length = 0; pending.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true }], { days: '1,2,3,4,5' });
  await handleDeviceBoot(device, new Date('2026-10-17T12:30:00Z')); // saturday
  assert.equal(jobs.length, 0);
});

t('create_routine: a computer whose agent cannot speak yet is told so, but the routine is made', async () => {
  const create = connector.tools.find((x) => x.declaration.name === 'create_routine');
  const ctx = { getUser: async () => USER, timezone: TZ };
  const args = { event: 'device_boot', actions: JSON.stringify([{ type: 'morning' }]) };
  agentVersion = '1.10.0';
  const old = await create.run(args, ctx);
  assert.ok(old.routine, old.error);
  assert.match(old.summary, /te saluda en voz alta/);
  assert.match(old.summary, /versión 1\.10\.0 y todavía no puede hablar.*te llegará escrito/);
  agentVersion = '1.11.0';
  const fresh = await create.run(args, ctx);
  assert.doesNotMatch(fresh.summary, /todavía no puede hablar/);
});

// ---------------- the pass ----------------
const deps = (over = {}) => ({
  loadUserContext: async () => ({ settings: { disabledConnectors: [] }, tasks: [{ title: 'Estudiar', priority: 'alta' }] }),
  collectToday: async () => ({ calendar: { status: 'ok', events }, mail, news: { status: 'off' } }),
  listPendingReminders: async () => [],
  linkByUser: async () => ({ name: 'Chrome en Windows', version: '1.5.0' }),
  ...over,
});
const running = async () => {
  routines.length = 0; jobs.length = 0; commands.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true }]);
  await handleDeviceBoot(device, NOW);
  jobs[0].status = 'running';
  return jobs[0];
};

t('the words come once, with mail and agenda pages queued to close after the last word', async () => {
  const job = await running();
  const out = await serveBrief(device, job.id, NOW, deps());
  assert.equal(out.status, 200);
  assert.match(out.json.pieces[0], /^Buenos días, Ana\./);
  assert.equal(out.json.checkup, true);
  assert.equal(out.json.launch_browser, true);
  assert.deepEqual(out.json.pages, ['Tu correo', 'Tu agenda']);
  assert.equal(commands.length, 2);
  assert.match(commands[0].url, /^https:\/\/mail\.google\.com\//);
  assert.match(commands[1].url, /^https:\/\/calendar\.google\.com\//);
  const closeIn = (new Date(commands[0].closeAt) - Date.now()) / 1000;
  assert.ok(closeIn >= out.json.seconds + 8 && closeIn <= out.json.seconds + 13, `closes ${closeIn}s from now for a ${out.json.seconds}s speech`);
  // the same pass again is refused: nobody can ask for the mail twice with one start-up
  const again = await serveBrief(device, job.id, NOW, deps());
  assert.equal(again.status, 403);
  assert.equal(commands.length, 2, 'and nothing more was queued');
});

t('the pass is only good for that computer, for a running morning job', async () => {
  const job = await running();
  assert.equal((await serveBrief({ ...device, id: 'other' }, job.id, NOW, deps())).status, 403, 'another computer');
  assert.equal((await serveBrief(device, 'not-a-job', NOW, deps())).status, 403, 'a made-up id');
  assert.equal((await serveBrief(device, undefined, NOW, deps())).status, 403, 'no id');
  const queued = jobs[0];
  queued.status = 'queued';
  assert.equal((await serveBrief(device, queued.id, NOW, deps())).status, 403, 'not taken by the agent yet');
  queued.status = 'running';
  queued.createdAt = Date.now() - 20 * 60_000;
  assert.equal((await serveBrief(device, queued.id, NOW, deps())).status, 403, 'a pass from twenty minutes ago');
  assert.equal(commands.length, 0, 'none of it read anything');
});

t('without the browser extension nothing is opened (he never opens what he cannot put away) and he says why', async () => {
  const job = await running();
  const out = await serveBrief(device, job.id, NOW, deps({ linkByUser: async () => null }));
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.pages, []);
  assert.equal(out.json.launch_browser, false);
  assert.match(out.json.note, /sin la extensión/);
  assert.equal(commands.length, 0);
});

t('pages: false, or nothing worth showing, opens nothing; only what has news is shown', async () => {
  let job = await running();
  assert.deepEqual((await serveBrief(device, job.id, NOW, deps())).json.pages, ['Tu correo', 'Tu agenda']);
  routines.length = 0; jobs.length = 0; commands.length = 0;
  addRoutine([{ type: 'morning', pages: false, checkup: true }]);
  await handleDeviceBoot(device, NOW);
  jobs[0].status = 'running';
  const noPages = await serveBrief(device, jobs[0].id, NOW, deps());
  assert.deepEqual(noPages.json.pages, []);
  assert.equal(commands.length, 0);
  job = await running();
  const mailOnly = await serveBrief(device, job.id, NOW, deps({ collectToday: async () => ({ calendar: { status: 'ok', events: [] }, mail, news: { status: 'off' } }) }));
  assert.deepEqual(mailOnly.json.pages, ['Tu correo']);
  job = await running();
  const quiet = await serveBrief(device, job.id, NOW, deps({ collectToday: async () => ({ calendar: { status: 'off' }, mail: { status: 'off' }, news: { status: 'off' } }) }));
  assert.deepEqual(quiet.json.pages, []);
  assert.equal(quiet.json.launch_browser, false, 'no pages → the browser is not started for nothing');
});

t('a routine deleted meanwhile, or a switched-off Gmail, are handled', async () => {
  const job = await running();
  routines.length = 0;
  assert.equal((await serveBrief(device, job.id, NOW, deps())).status, 404);
  const job2 = await running();
  let asked;
  await serveBrief(device, job2.id, NOW, deps({ loadUserContext: async () => ({ settings: { disabledConnectors: ['gmail'] }, tasks: [] }), collectToday: async (o) => { asked = o.disabled; return { calendar: { status: 'off' }, mail: { status: 'off' } }; } }));
  assert.deepEqual(asked, ['gmail'], 'a connector the user switched off is not asked');
});

// ---------------- once a day ----------------
t('the greeting is for the FIRST start-up of the day: the second time the PC is switched on, nothing is said', async () => {
  routines.length = 0; jobs.length = 0; pending.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true, tune: 'off' }]);
  await handleDeviceBoot(device, new Date('2026-10-14T12:30:00Z')); // 8:30 in Santo Domingo
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1, 'the first start-up greets');
  await handleDeviceBoot(device, new Date('2026-10-14T15:00:00Z')); // 11:00, same day
  await handleDeviceBoot(device, new Date('2026-10-14T23:00:00Z')); // 19:00, still the same day there
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1, 'later start-ups the same day stay quiet');
  await handleDeviceBoot(device, new Date('2026-10-15T12:30:00Z')); // the next morning
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 2, 'the next day it greets again');
});

t('the day is the user\'s day: 9 pm at night and 9 am next morning are different days there, though not in UTC', async () => {
  routines.length = 0; jobs.length = 0;
  addRoutine([{ type: 'morning', pages: false, checkup: false, tune: 'off' }]);
  await handleDeviceBoot(device, new Date('2026-10-14T23:30:00Z')); // 19:30 on the 14th in Santo Domingo
  await handleDeviceBoot(device, new Date('2026-10-15T01:30:00Z')); // 21:30 on the 14th (already the 15th in UTC)
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1, 'same local day');
});

t('two routines with the good-morning (the user asked twice) still greet once, and each counts the day as done', async () => {
  routines.length = 0; jobs.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true, tune: 'off' }, { type: 'play_music', query: 'Creep' }]);
  addRoutine([{ type: 'morning', pages: true, checkup: true, tune: 'off' }]);
  await handleDeviceBoot(device, new Date('2026-10-14T12:30:00Z'));
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1, 'one greeting, not two');
  await handleDeviceBoot(device, new Date('2026-10-14T16:00:00Z'));
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1, 'and none on the second start-up, from either routine');
});

t('the other actions of the routine are not limited to once a day', async () => {
  routines.length = 0; jobs.length = 0;
  addRoutine([{ type: 'morning', pages: false, checkup: false, tune: 'off' }, { type: 'open_sites', urls: ['https://www.youtube.com/'] }]);
  await handleDeviceBoot(device, new Date('2026-10-14T12:30:00Z'));
  await handleDeviceBoot(device, new Date('2026-10-14T16:00:00Z'));
  assert.equal(jobs.filter((j) => j.tool === 'open_urls').length, 2);
  assert.equal(jobs.filter((j) => j.tool === 'morning_brief').length, 1);
});

t('an older agent: the written summary is also only for the first start-up of the day', async () => {
  routines.length = 0; jobs.length = 0; pending.length = 0;
  addRoutine([{ type: 'morning', pages: true, checkup: true, tune: 'off' }]);
  const old = { ...device, tools: [{ name: 'say_text' }] };
  await handleDeviceBoot(old, new Date('2026-10-14T12:30:00Z'));
  await handleDeviceBoot(old, new Date('2026-10-14T16:00:00Z'));
  assert.equal(pending.length, 1);
});

// ---------------- the browser that has the extension ----------------
const M = await import(`${root}/api/_lib/routines/morning.js`);

t('browserKind: the agent starts the browser the extension linked from, not the system default', () => {
  assert.equal(M.browserKind('Chrome en Windows'), 'chrome');
  assert.equal(M.browserKind('Microsoft Edge en Windows'), 'edge');
  assert.equal(M.browserKind('Brave'), 'brave');
  assert.equal(M.browserKind(''), 'chrome');
  assert.equal(M.browserKind(undefined), 'chrome');
});

t('the pass names that browser, and an old extension is told (it opens the pages but cannot close them)', async () => {
  let job = await running();
  const fresh = await serveBrief(device, job.id, NOW, deps());
  assert.equal(fresh.json.browser, 'chrome');
  assert.equal(fresh.json.note, undefined);
  job = await running();
  const old = await serveBrief(device, job.id, NOW, deps({ linkByUser: async () => ({ name: 'Chrome en Windows', version: '1.2.1' }) }));
  assert.match(old.json.note, /extensión .* vieja .* no cerrará las páginas/);
  assert.deepEqual(old.json.pages, ['Tu correo', 'Tu agenda'], 'the pages are still queued');
  job = await running();
  const edge = await serveBrief(device, job.id, NOW, deps({ linkByUser: async () => ({ name: 'Edge en Windows', version: '1.5.0' }) }));
  assert.equal(edge.json.browser, 'edge');
  job = await running();
  const none = await serveBrief(device, job.id, NOW, deps({ linkByUser: async () => null }));
  assert.equal(none.json.browser, undefined);
  assert.match(none.json.note, /sin la extensión/, 'now it is said aloud too, not dropped');
});

// ---------------- no Spanish voice: in writing ----------------
t('no Spanish voice on the computer: the greeting arrives written, once, with how to install a voice', async () => {
  const sent = [];
  const routine = { id: 'r1', userId: USER.id, chatId: 555, actions: [{ type: 'morning' }] };
  let claims = 0;
  const depsV = {
    claimVoiceReport: async () => ((claims += 1) === 1 ? { routine: 'r1', served: true } : null),
    bootRoutines: async () => [routine],
    deliver: async (r, text, notification) => { sent.push({ text, notification }); return true; },
    send: async () => ({ ok: true }),
    push: async () => ({ sent: 1 }),
  };
  const body = { job: 'j', problem: 'no_spanish_voice', pieces: ['Buenos días, Ana. Hoy es miércoles 14 de octubre.', 'Hoy tienes 1 evento: a las 9, clase.', ...Array(20).fill('x'.repeat(500))] };
  const out = await M.reportVoice(device, body, depsV);
  assert.equal(out.status, 200);
  assert.match(sent[0].text, /no tiene una voz en español/);
  assert.match(sent[0].text, /Buenos días, Ana\. Hoy es miércoles 14 de octubre\./);
  assert.match(sent[0].text, /Hora e idioma → Voz/);
  assert.ok(sent[0].text.length < 3500, 'the pieces are limited');
  assert.equal(sent[0].notification.title, 'Tu saludo del día');
  assert.equal((await M.reportVoice(device, body, depsV)).status, 403, 'a second report with the same pass is refused');
  assert.equal(sent.length, 1);
});

// ---------------- the page queue: closing time ----------------
const B = await import(`${root}/api/_lib/browser/store.js`);

t('a page queued to close tells the extension how many seconds it has, never less than it takes to see it', async () => {
  commands.length = 0;
  await B.enqueue(USER.id, { url: 'https://mail.google.com/', label: 'Tu correo', closeAfter: 60 });
  await B.enqueue(USER.id, { url: 'https://calendar.google.com/', label: 'Tu agenda', closeAfter: 1 });
  await B.enqueue(USER.id, { url: 'https://docs.google.com/document/d/1', label: 'Un documento' });
  const taken = await B.takeCommands(USER.id);
  assert.equal(taken.length, 3);
  assert.ok(taken[0].closeIn >= 58 && taken[0].closeIn <= 60, String(taken[0].closeIn));
  assert.equal(taken[1].closeIn, B.MIN_CLOSE_IN);
  assert.equal('closeIn' in taken[2], false, 'a page that stays has no closing time');
});

// ---------------- the agent, in Python ----------------
import { spawnSync } from 'node:child_process';
const python = spawnSync('python3', ['--version']);
t('EDDIE Prime: checkup, protected processes, speech and the whole good-morning (python)', { skip: python.status !== 0 && 'python3 no está instalado' }, () => {
  const run = spawnSync('python3', ['-I', `${root}/tests/agent/test_morning.py`], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
