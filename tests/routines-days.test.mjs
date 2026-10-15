// Routines on specific days: «de lunes a viernes», «los fines de semana», «lunes y jueves». The days are judged on the
// calendar date where the user is, for the routines that run at an hour and for the ones that run when the PC starts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const W = await import(`${root}/src/services/weekdays.js`);
const { runRoutines } = await import(`${root}/api/_lib/routines/run.js`);
const { handleDeviceBoot } = await import(`${root}/api/_lib/routines/boot.js`);
const connector = (await import(`${root}/api/_lib/connectors/routines/index.js`)).default;
const tool = (name) => connector.tools.find((x) => x.declaration.name === name);
const t = (name, fn) => test(name, fn);

// ---------------- pure ----------------
t('weekdays: encode, decode, describe and runsOn', () => {
  assert.equal(W.encodeDays([5, 1, 3, 2, 4]), '1,2,3,4,5');
  assert.equal(W.encodeDays([0, 1, 2, 3, 4, 5, 6]), null, 'every day is stored as nothing');
  assert.equal(W.encodeDays([]), null);
  assert.equal(W.encodeDays([6, 0]), '6,0');
  assert.deepEqual(W.decodeDays('1,2,3,4,5'), [1, 2, 3, 4, 5]);
  for (const bad of [null, undefined, '', 'x', '0,1,2,3,4,5,6']) assert.equal(W.decodeDays(bad), null, String(bad));
  const said = { 'de lunes a viernes': [1, 2, 3, 4, 5], 'los fines de semana': [6, 0], 'los lunes, miércoles y viernes': [1, 3, 5], 'los lunes': [1], 'los martes y jueves': [2, 4], 'de lunes a miércoles': [1, 2, 3], 'de viernes a domingo': [5, 6, 0], 'los sábados': [6], 'los lunes y domingos': [0, 1], 'todos los días': null };
  for (const [text, days] of Object.entries(said)) assert.equal(W.describeDays(days), text);
  // 2026-10-14 is a Wednesday, the 17th a Saturday
  assert.equal(W.weekdayOf('2026-10-14'), 3);
  assert.equal(W.weekdayOf('2026-10-17'), 6);
  assert.equal(W.runsOn('1,2,3,4,5', '2026-10-14'), true);
  assert.equal(W.runsOn('1,2,3,4,5', '2026-10-17'), false);
  assert.equal(W.runsOn([6, 0], '2026-10-17'), true);
  assert.equal(W.runsOn(null, '2026-10-17'), true);
  assert.equal(W.runsOn('', '2026-10-18'), true);
});

// ---------------- a fake routines table ----------------
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'ana@x.co', name: 'Ana' };
const routines = [];
const jobs = [];
const links = new Map([[USER.id, { chat_id: 555, timezone: 'America/Santo_Domingo' }]]);
let seq = 0;
const row = (r) => ({ id: r.id, name: r.name, trigger_type: r.trigger_type, time: r.time, days: r.days, event_type: r.event_type, device_id: r.device_id, actions: r.actions, enabled: r.enabled, state: r.state });
const joined = (r) => ({ ...row(r), user_id: r.user_id, last_run_on: r.last_run_on, chat_id: links.get(r.user_id)?.chat_id ?? null, timezone: links.get(r.user_id)?.timezone || 'UTC', email: USER.email, user_name: USER.name });
installNeon([
  [/^insert into routines/, ([user_id, name, trigger_type, time, days, event_type, device_id, actionsJson]) => {
    const r = { id: `r${(seq += 1)}`, user_id, name, trigger_type, time, days, event_type, device_id, actions: JSON.parse(actionsJson), enabled: true, state: {}, last_run_on: null };
    routines.push(r);
    return [row(r)];
  }],
  [/^select id, name, trigger_type, time, days, event_type, device_id, actions, enabled, state\s+from routines where user_id/, ([u]) => routines.filter((r) => r.user_id === u).map(row)],
  [/^select r\.id, r\.user_id, r\.name, r\.time, r\.days, r\.actions, r\.last_run_on, l\.chat_id/, () => routines.filter((r) => r.enabled && r.trigger_type === 'schedule').map(joined)],
  [/^select r\.id, r\.user_id, r\.name, r\.days, r\.event_type, r\.device_id/, () => []],
  [/^select r\.id, r\.user_id, r\.name, r\.days, r\.actions, r\.state, l\.chat_id/, ([deviceId]) => routines.filter((r) => r.enabled && r.event_type === 'device_boot' && r.device_id === deviceId).map(joined)],
  [/^update routines set last_run_on = \$1 where id = \$2/, ([date, id]) => {
    const r = routines.find((x) => x.id === id);
    if (!r || r.last_run_on === date) return [];
    r.last_run_on = date;
    return [{ id }];
  }],
  [/^update routines set last_run_on = null/, ([id, date]) => { const r = routines.find((x) => x.id === id); if (r?.last_run_on === date) r.last_run_on = null; return []; }],
  [/^update routines set state = state \|\| /, () => []],
  [/^delete from computer_jobs where created_at/, () => []], // (createJob tidies old jobs now and then)
  [/^insert into computer_jobs/, ([device_id, toolName, args]) => { jobs.push({ device_id, tool: toolName, args: JSON.parse(args) }); return [{ id: `j${jobs.length}` }]; }],
  [/^select id, user_id, name, topic, tools, agent_version, platform, last_seen_at from computer_devices where user_id/, () => []],
]);
const ctx = { getUser: async () => USER, timezone: 'America/Santo_Domingo' };
const notify = [{ type: 'notify', text: 'Buenos días' }];

// ---------------- the connector ----------------
t('create_routine: days in the user\'s words, stored in order, described back', async () => {
  const weekdays = await tool('create_routine').run({ name: 'Entre semana', time: '08:00', days: 'lunes a viernes', actions: JSON.stringify(notify) }, ctx);
  assert.equal(weekdays.routine.days.join(','), '1,2,3,4,5');
  assert.match(weekdays.summary, /de lunes a viernes a las 08:00/);
  const rawDays = routines.at(-1).days;
  assert.equal(rawDays, '1,2,3,4,5');
  assert.equal((await tool('create_routine').run({ time: '09:00', days: 'fines de semana', actions: JSON.stringify(notify) }, ctx)).routine.days.join(','), '6,0');
  assert.equal((await tool('create_routine').run({ time: '09:00', days: 'cada lunes', actions: JSON.stringify(notify) }, ctx)).routine.days.join(','), '1');
  assert.equal((await tool('create_routine').run({ time: '09:00', days: 'solo los martes y jueves', actions: JSON.stringify(notify) }, ctx)).routine.days.join(','), '2,4');
  assert.equal((await tool('create_routine').run({ time: '09:00', days: 'entre semana', actions: JSON.stringify(notify) }, ctx)).routine.days.join(','), '1,2,3,4,5');
  // every day, or nothing said: as before
  const all = await tool('create_routine').run({ time: '07:00', days: 'todos los días', actions: JSON.stringify(notify) }, ctx);
  assert.equal(all.routine.days, null);
  assert.equal(routines.at(-1).days, null);
  assert.match(all.summary, /todos los días a las 07:00/);
  const none = await tool('create_routine').run({ time: '06:00', actions: JSON.stringify(notify) }, ctx);
  assert.equal(none.routine.days, null);
});

t('create_routine: days it does not understand are refused with an example', async () => {
  const before = routines.length;
  const bad = await tool('create_routine').run({ time: '08:00', days: 'cuando haya luna', actions: JSON.stringify(notify) }, ctx);
  assert.match(bad.error, /No entendí los días «cuando haya luna»/);
  assert.match(bad.error, /lunes a viernes/);
  assert.equal(routines.length, before);
});

t('list_routines says when each one runs', async () => {
  const out = await tool('list_routines').run({}, ctx);
  const byName = Object.fromEntries(out.routines.map((r) => [r.name, r.cuando]));
  assert.equal(byName['Entre semana'], 'de lunes a viernes a las 08:00');
  assert.equal(byName['Rutina de las 07:00'], 'todos los días a las 07:00');
  assert.match(out.summary, /Entre semana/);
});

// ---------------- the cron: an hour, on its days ----------------
const sent = [];
const send = async (chat, text) => { sent.push({ chat, text }); return { ok: true }; };
const push = async () => ({ sent: 0 });
const only = (name) => { for (const r of routines) r.enabled = r.name === name; };

t('runs on its days and only then; a day it skips is not marked as done', async () => {
  only('Entre semana');
  const r = routines.find((x) => x.name === 'Entre semana');
  // Saturday 12:30Z = 08:30 in Santo Domingo, inside the routine's hour but not its days
  sent.length = 0;
  const sat = await runRoutines({ now: new Date('2026-10-17T12:30:00Z'), send, push });
  assert.equal(sat.scheduled, 0);
  assert.equal(sent.length, 0);
  assert.equal(r.last_run_on, null, 'a skipped day leaves no mark');
  // Sunday, same
  assert.equal((await runRoutines({ now: new Date('2026-10-18T12:30:00Z'), send, push })).scheduled, 0);
  // Monday: it runs, once
  const mon = await runRoutines({ now: new Date('2026-10-19T12:30:00Z'), send, push });
  assert.equal(mon.scheduled, 1);
  assert.match(sent[0].text, /Entre semana/);
  assert.equal(r.last_run_on, '2026-10-19');
  assert.equal((await runRoutines({ now: new Date('2026-10-19T12:45:00Z'), send, push })).scheduled, 0, 'once a day still holds');
  // and the following Saturday it waits again
  assert.equal((await runRoutines({ now: new Date('2026-10-24T12:30:00Z'), send, push })).scheduled, 0);
});

t('the day is the user\'s day, not the server\'s', async () => {
  // Friday 21:30 in Santo Domingo is already Saturday 01:30 in UTC: for «de lunes a viernes» it is still Friday.
  routines.length = 0;
  await tool('create_routine').run({ name: 'Cierre', time: '21:00', days: 'lunes a viernes', actions: JSON.stringify(notify) }, ctx);
  sent.length = 0;
  const fri = await runRoutines({ now: new Date('2026-10-17T01:30:00Z'), send, push });
  assert.equal(fri.scheduled, 1);
  // Saturday 21:30 in Santo Domingo (Sunday 01:30Z) is a weekend night
  const sat = await runRoutines({ now: new Date('2026-10-18T01:30:00Z'), send, push });
  assert.equal(sat.scheduled, 0);
});

t('a routine with no days runs every day, as the old ones did', async () => {
  routines.length = 0;
  await tool('create_routine').run({ name: 'Diaria', time: '08:00', actions: JSON.stringify(notify) }, ctx);
  routines[0].days = undefined; // a row from before the column existed
  for (const day of ['2026-10-17', '2026-10-18', '2026-10-19']) {
    routines[0].last_run_on = null;
    assert.equal((await runRoutines({ now: new Date(`${day}T12:30:00Z`), send, push })).scheduled, 1, day);
  }
});

t('weekend-only routine runs on Saturday and not on Monday', async () => {
  routines.length = 0;
  await tool('create_routine').run({ name: 'Finde', time: '09:00', days: 'fines de semana', actions: JSON.stringify(notify) }, ctx);
  assert.equal((await runRoutines({ now: new Date('2026-10-19T13:30:00Z'), send, push })).scheduled, 0);
  assert.equal((await runRoutines({ now: new Date('2026-10-17T13:30:00Z'), send, push })).scheduled, 1);
});

// ---------------- when the PC starts ----------------
t('«cuando encienda el PC» respects the days: on an excluded day the PC starts and nothing happens', async () => {
  routines.length = 0;
  jobs.length = 0;
  const device = { id: 'dev1', userId: USER.id, name: 'PC', tools: [{ name: 'open_urls', risk: 'write' }, { name: 'say_text', risk: 'write' }] };
  routines.push({ id: 'b1', user_id: USER.id, name: 'Al encender (entre semana)', trigger_type: 'event', time: null, days: '1,2,3,4,5', event_type: 'device_boot', device_id: 'dev1', actions: [{ type: 'open_sites', urls: ['https://www.youtube.com'] }, { type: 'say', text: 'Buenos días' }], enabled: true, state: {}, last_run_on: null });
  routines.push({ id: 'b2', user_id: USER.id, name: 'Siempre', trigger_type: 'event', time: null, days: null, event_type: 'device_boot', device_id: 'dev1', actions: [{ type: 'say', text: 'Hola' }], enabled: true, state: {}, last_run_on: null });
  // Saturday morning in Santo Domingo: only «Siempre» speaks
  await handleDeviceBoot(device, new Date('2026-10-17T12:00:00Z'));
  assert.deepEqual(jobs.map((j) => j.tool), ['say_text']);
  assert.equal(jobs[0].args.text, 'Hola');
  // Monday: both
  jobs.length = 0;
  await handleDeviceBoot(device, new Date('2026-10-19T12:00:00Z'));
  assert.deepEqual(jobs.map((j) => j.tool).sort(), ['open_urls', 'say_text', 'say_text']);
});
