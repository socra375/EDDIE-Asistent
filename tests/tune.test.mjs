// Optimizar el PC con entrenamiento: empieza en ensayo, «activo» solo tras ensayar y por petición del usuario, el informe
// se cuenta y se manda, y el agente (Python) nunca cierra nada. Las pruebas del agente están en tests/agent/test_tune.py.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const T = await import(`${root}/api/_lib/routines/tuning.js`);
const A = await import(`${root}/api/_lib/routines/actions.js`);
const { serveBrief } = await import(`${root}/api/_lib/routines/morning.js`);
const connector = (await import(`${root}/api/_lib/connectors/routines/index.js`)).default;
const tool = (name) => connector.tools.find((x) => x.declaration.name === name);
const t = (name, fn, opts) => test(name, opts || {}, fn);

const USER = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana' };
const ctx = { getUser: async () => USER, timezone: 'America/Santo_Domingo' };
const routines = [];
let agentVersion = '1.12.0';
const shape = (r) => ({ id: r.id, name: r.name, trigger_type: 'event', time: null, days: null, event_type: 'device_boot', device_id: 'dev1', actions: r.actions, enabled: true, state: r.state });
installNeon([
  [/^select id, name, trigger_type, time, days, event_type, device_id, actions, enabled, state from routines where user_id = \$1 and trigger_type = 'event'/, () => routines.map(shape)],
  [/^select id, name, trigger_type, time, days, event_type, device_id, actions, enabled, state from routines where user_id = \$1 order by created_at desc/, () => routines.map(shape)],
  [/^update routines set actions = \$1 where id = \$2 and user_id = \$3/, ([json, id]) => { const r = routines.find((x) => x.id === id); if (!r) return []; r.actions = JSON.parse(json); return [{ id }]; }],
  [/^select id, user_id, name, topic, tools, agent_version, platform, last_seen_at from computer_devices where user_id/, () => [{ id: 'dev1', user_id: USER.id, name: 'PC', topic: 't', tools: [], agent_version: agentVersion, platform: 'windows', last_seen_at: new Date().toISOString() }]],
  [/^insert into routines/, ([user_id, name, trigger_type, time, days, event_type, device_id, actionsJson]) => {
    const r = { id: `r${routines.length + 1}`, name, actions: JSON.parse(actionsJson), state: {} };
    routines.push(r);
    return [shape(r)];
  }],
]);
const reset = (actions, state = {}) => { routines.length = 0; routines.push({ id: 'r1', name: 'Buenos días', actions, state }); };
const morning = (extra = {}) => ({ type: 'morning', pages: true, checkup: true, tune: 'off', ...extra });

// ---------------- the action ----------------
t('the morning action carries a tuning mode: off unless stated, and only the three known ones', () => {
  assert.equal(A.validateActions([{ type: 'morning' }]).actions[0].tune, 'off');
  for (const ok of ['ensayo', 'activo', 'off']) assert.equal(A.validateActions([{ type: 'morning', tune: ok }]).actions[0].tune, ok);
  for (const bad of ['ACTIVO', 'yes', 1, null, 'kill', '']) assert.equal(A.validateActions([{ type: 'morning', tune: bad }]).actions[0].tune, 'off', String(bad));
  assert.match(A.describeActions([morning({ tune: 'ensayo' })]), /ensaya optimizar el equipo \(dice qué haría, no toca nada\)/);
  assert.match(A.describeActions([morning({ tune: 'activo' })]), /nunca cierra apps/);
});

t('create_routine never starts the optimization active: it starts in rehearsal', async () => {
  routines.length = 0;
  const out = await tool('create_routine').run({ event: 'device_boot', actions: JSON.stringify([{ type: 'morning', tune: 'activo' }]) }, ctx);
  assert.ok(out.routine, out.error);
  assert.equal(routines[0].actions[0].tune, 'ensayo');
  assert.match(out.summary, /empieza en ensayo \(3 encendidos/);
});

// ---------------- the gate ----------------
t('set_pc_tuning: rehearsal and off are free; active needs the rehearsals', async () => {
  reset([morning()]);
  assert.match((await T.setTuningMode(USER.id, 'activo')).error, /ensayar 3 veces y lleva 0/);
  assert.equal(routines[0].actions[0].tune, 'off', 'nothing changed');
  const rehearsal = await T.setTuningMode(USER.id, 'ensayo');
  assert.equal(rehearsal.ok, true);
  assert.equal(routines[0].actions[0].tune, 'ensayo');
  routines[0].state.rehearsals = 2;
  assert.match((await T.setTuningMode(USER.id, 'activo')).error, /lleva 2/);
  routines[0].state.rehearsals = 3;
  const active = await T.setTuningMode(USER.id, 'activo');
  assert.equal(active.ok, true);
  assert.match(active.summary, /Nunca cierro apps ni borro archivos/);
  assert.equal(routines[0].actions[0].tune, 'activo');
  assert.equal((await T.setTuningMode(USER.id, 'off')).ok, true);
  assert.equal(routines[0].actions[0].tune, 'off');
});

t('set_pc_tuning: bad mode, no good-morning routine, other actions kept', async () => {
  reset([morning()]);
  for (const bad of ['', 'ACTIVAR', 'on', 'kill']) assert.match((await T.setTuningMode(USER.id, bad)).error, /off .*ensayo .*activo/);
  routines.length = 0;
  assert.match((await T.setTuningMode(USER.id, 'ensayo')).error, /Créala primero/);
  reset([{ type: 'open_sites', urls: ['https://www.youtube.com'] }, morning(), { type: 'notify', text: 'hola' }]);
  await T.setTuningMode(USER.id, 'ensayo');
  assert.deepEqual(routines[0].actions.map((a) => a.type), ['open_sites', 'morning', 'notify']);
  assert.equal(routines[0].actions[0].urls[0], 'https://www.youtube.com');
});

t('set_pc_tuning is a confirmed (write) tool and the model is told never to promise closing programs', () => {
  const def = tool('set_pc_tuning');
  assert.equal(def.risk, 'write');
  assert.match(def.declaration.description, /nunca cierra apps ni borra archivos/);
  assert.match(connector.guide, /tune="ensayo"/);
  assert.match(connector.guide, /No prometas cerrar programas/);
  assert.match(connector.guide, /pc_tune_plan/);
});

t('list_routines shows the optimization state', async () => {
  reset([morning({ tune: 'ensayo' })], { rehearsals: 2 });
  const out = await tool('list_routines').run({}, ctx);
  assert.equal(out.routines[0].optimizacion, 'ensayo, 2 ensayos hechos');
  reset([morning()]);
  assert.equal('optimizacion' in (await tool('list_routines').run({}, ctx)).routines[0], false);
});

// ---------------- the pass hands the mode to the agent ----------------
t('the agent is told the routine\'s mode and never anything else', async () => {
  for (const [stored, told] of [['off', 'off'], ['ensayo', 'ensayo'], ['activo', 'activo'], [undefined, 'off'], ['rm -rf', 'off']]) {
    const routine = { id: 'r1', userId: USER.id, timezone: 'America/Santo_Domingo', user: { name: 'Ana' }, actions: [{ type: 'morning', tune: stored }] };
    const out = await serveBrief({ id: 'dev1' }, 'job', new Date('2026-10-14T12:30:00Z'), {
      claimBriefJob: async () => ({ routine: 'r1', pages: false, checkup: true }),
      bootRoutines: async () => [routine],
      loadUserContext: async () => ({ settings: { disabledConnectors: [] }, tasks: [] }),
      collectToday: async () => ({ calendar: { status: 'off' }, mail: { status: 'off' } }),
      listPendingReminders: async () => [],
    });
    assert.equal(out.json.tune, told, String(stored));
  }
});

// ---------------- the report ----------------
const sent = [];
const fakeDeps = (over = {}) => {
  const routine = { id: 'r1', userId: USER.id, chatId: 555, actions: [morning({ tune: 'ensayo' })], state: {}, ...over.routine };
  let count = Number(routine.state.rehearsals || 0);
  return {
    claimTuneReport: over.claim || (async () => ({ routine: 'r1', served: true })),
    bootRoutines: async () => [routine],
    bumpRehearsals: async () => { count += 1; routine.state.rehearsals = count; return count; },
    deliver: async (r, text, notification) => { sent.push({ r, text, notification }); return true; },
    send: async () => ({ ok: true }),
    push: async () => ({ sent: 1 }),
  };
};
const plan = [{ kind: 'lower_priority', name: 'Updater', detail: 'usa el 60 por ciento del procesador sin que la estés usando' }, { kind: 'trim_memory', name: 'Photoshop', detail: 'tiene 900 megas de memoria y está parada' }];

t('rehearsal report: counted, written, and says it touched nothing', async () => {
  sent.length = 0;
  const out = await T.reportTuning({ id: 'dev1' }, { job: 'j', mode: 'ensayo', plan, applied: [], skipped: 0 }, fakeDeps());
  assert.equal(out.status, 200);
  assert.deepEqual([out.json.mode, out.json.rehearsals, out.json.delivered], ['ensayo', 1, true]);
  assert.match(sent[0].text, /^🛠 Ensayo de optimización 1 de 3/);
  assert.match(sent[0].text, /Habría hecho:\n• Bajar la prioridad de Updater \(usa el 60 por ciento/);
  assert.match(sent[0].text, /• Soltar la memoria de Photoshop/);
  assert.match(sent[0].text, /No toqué nada\. Faltan 2 ensayos/);
  assert.equal(sent[0].notification.title, 'Optimización del equipo');
});

t('the third rehearsal tells the user it can now be turned on', async () => {
  sent.length = 0;
  await T.reportTuning({ id: 'dev1' }, { plan: [], applied: [] }, fakeDeps({ routine: { state: { rehearsals: 2 } } }));
  assert.match(sent[0].text, /Ensayo de optimización 3 de 3/);
  assert.match(sent[0].text, /No encontré nada que valiera la pena ajustar/);
  assert.match(sent[0].text, /dime «activa la optimización»/);
});

t('a rehearsal never lists anything as done, even if the agent claims it did something', async () => {
  sent.length = 0;
  await T.reportTuning({ id: 'dev1' }, { mode: 'activo', plan, applied: plan, skipped: 0 }, fakeDeps());
  assert.doesNotMatch(sent[0].text, /Bajé la prioridad|Optimicé/);
  assert.match(sent[0].text, /Habría hecho/);
});

t('active report: what was done, that nothing was closed, how to undo', async () => {
  sent.length = 0;
  const out = await T.reportTuning({ id: 'dev1' }, { plan, applied: [plan[0]], skipped: 1 }, fakeDeps({ routine: { actions: [morning({ tune: 'activo' })], state: { rehearsals: 3 } } }));
  assert.equal(out.json.rehearsals, 3, 'an active run is not a rehearsal');
  assert.match(sent[0].text, /^🛠 Optimicé el equipo en segundo plano\n• Bajé la prioridad de Updater/);
  assert.doesNotMatch(sent[0].text, /Photoshop/, 'only what was really done');
  assert.match(sent[0].text, /No cerré ninguna app ni borré nada\. Dejé 1 sin tocar/);
  assert.match(sent[0].text, /deshaz la optimización/);
});

t('mode off, or the pass already used, or another computer: nothing is written or counted', async () => {
  sent.length = 0;
  const off = await T.reportTuning({ id: 'dev1' }, { plan }, fakeDeps({ routine: { actions: [morning({ tune: 'off' })] } }));
  assert.equal(off.json.ignored, true);
  const refused = await T.reportTuning({ id: 'dev1' }, { job: 'j', plan }, fakeDeps({ claim: async () => null }));
  assert.equal(refused.status, 403);
  assert.equal(sent.length, 0);
});

t('what the agent reports is cleaned: unknown kinds out, text clipped, a handful at most', async () => {
  sent.length = 0;
  const dirty = [{ kind: 'kill_process', name: 'svchost', detail: 'x' }, { kind: 'lower_priority', name: `Mala\n\n${'a'.repeat(200)}`, detail: 'b'.repeat(500) }, null, 'x', { kind: 'trim_memory', name: '', detail: 'sin nombre' }, ...Array.from({ length: 30 }, (_, i) => ({ kind: 'trim_memory', name: `App${i}`, detail: 'd' }))];
  await T.reportTuning({ id: 'dev1' }, { plan: dirty }, fakeDeps());
  const lines = sent[0].text.split('\n').filter((l) => l.startsWith('•'));
  assert.ok(lines.length <= 8, `${lines.length}`);
  assert.doesNotMatch(sent[0].text, /svchost|kill_process/);
  assert.ok(lines.every((l) => l.length < 260));
  assert.doesNotMatch(sent[0].text, /\n\n\n/);
});

t('the pass for the report: only after the greeting was served, once, for that computer (sql)', async () => {
  const jobs = [{ id: 'J1', device_id: 'dev1', tool: 'morning_brief', status: 'done', args: { routine: 'r1', served: true }, createdAt: Date.now() }];
  const restore = installNeon([
    [/^update computer_jobs set args = args \|\| '\{"reported": true\}'::jsonb where id = \$1 and device_id = \$2 and tool = 'morning_brief'/, ([id, deviceId]) => {
      const j = jobs.find((x) => x.id === id);
      if (!j || j.device_id !== deviceId || !['running', 'done'].includes(j.status) || j.args.served !== true || j.args.reported === true) return [];
      j.args.reported = true;
      return [{ args: j.args }];
    }],
  ]);
  try {
    const { claimTuneReport } = await import(`${root}/api/_lib/computer/store.js`);
    assert.equal(await claimTuneReport('other', 'J1'), null);
    assert.equal(await claimTuneReport('dev1', 'nope'), null);
    assert.ok(await claimTuneReport('dev1', 'J1'));
    assert.equal(await claimTuneReport('dev1', 'J1'), null, 'once');
    jobs.push({ id: 'J2', device_id: 'dev1', tool: 'morning_brief', status: 'done', args: { routine: 'r1' }, createdAt: Date.now() });
    assert.equal(await claimTuneReport('dev1', 'J2'), null, 'never served');
  } finally {
    restore();
  }
});

// ---------------- the agent, in Python ----------------
const python = spawnSync('python3', ['--version']);
t('EDDIE Prime: the tuning never touches what it must not, never closes anything (python)', { skip: python.status !== 0 && 'python3 no está instalado' }, () => {
  const run = spawnSync('python3', ['-I', `${root}/tests/agent/test_tune.py`], { encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
