// Agente en segundo plano: el pedido largo lo hace otro agente mientras Eddie sigue hablando, y la autonomía decide
// qué se hace solo y qué espera la tarjeta.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNeon } from './helpers/fakeneon.mjs';

process.env.DATABASE_URL = 'postgres://u:p@ep-fake.neon.tech/db';
process.env.CONNECTOR_SECRET = 'a'.repeat(40);
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const S = await import(`${root}/api/_lib/agentjobs/store.js`);
const { runJob } = await import(`${root}/api/_lib/agentjobs/run.js`);
const agent = (await import(`${root}/api/_lib/connectors/agent/index.js`)).default;
const R = await import(`${root}/api/_lib/connectors/registry.js`);
const AU = await import(`${root}/src/services/autonomy.js`);
const AJ = await import(`${root}/src/services/agentJobsCore.js`);
const t = (name, fn) => test(name, fn);

// A tiny in-memory agent_jobs table behind the fake Neon.
function fakeJobs() {
  const rows = [];
  const handlers = [
    [/update agent_jobs set status = 'error', error = 'Se interrumpió/, () => []],
    [/select count\(\*\) filter/, () => [{ active: rows.filter((r) => ['queued', 'running'].includes(r.status)).length, recent: rows.length }]],
    [/insert into agent_jobs/, (p) => {
      const row = { id: `00000000-0000-4000-8000-${String(rows.length + 1).padStart(12, '0')}`, user_id: p[0], label: p[1], task: p[2], timezone: p[3], status: 'queued', steps: [], confirmations: [], actions: [], result: null, error: null, created_at: new Date().toISOString() };
      rows.push(row);
      return [row];
    }],
    [/update agent_jobs set status = 'running'/, (p) => {
      const row = rows.find((r) => r.id === p[0] && r.user_id === p[1] && r.status === 'queued');
      if (!row) return [];
      row.status = 'running';
      return [row];
    }],
    [/update agent_jobs set status = 'done'/, (p) => {
      const row = rows.find((r) => r.id === p[4]);
      Object.assign(row, { status: 'done', result: p[0], steps: JSON.parse(p[1]), confirmations: JSON.parse(p[2]), actions: JSON.parse(p[3]) });
      return [];
    }],
    [/update agent_jobs set status = 'error', error = \$1/, (p) => {
      const row = rows.find((r) => r.id === p[1]);
      Object.assign(row, { status: 'error', error: p[0] });
      return [];
    }],
  ];
  return { rows, handlers };
}

const user = { id: '11111111-1111-4111-8111-111111111111' };

t('background_task creates a job, announces it to the app and tells Eddie to keep talking', async () => {
  const db = fakeJobs();
  const restore = installNeon(db.handlers);
  try {
    const tool = agent.tools.find((x) => x.declaration.name === 'background_task');
    const emitted = [];
    const out = await tool.run({ task: 'Revisa mis correos de hoy y prepara un resumen en Notion', label: 'Resumen de correos' }, { getUser: async () => user, emit: (a) => emitted.push(a), timezone: 'America/Santo_Domingo' });
    assert.equal(out.ok, true);
    assert.match(out.note, /sigue conversando/);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].type, 'agent_job');
    assert.equal(emitted[0].label, 'Resumen de correos');
    assert.equal(db.rows[0].timezone, 'America/Santo_Domingo');
  } finally {
    restore();
  }
});

t('a background job cannot start another one, and needs a signed-in user and a task', async () => {
  const tool = agent.tools.find((x) => x.declaration.name === 'background_task');
  assert.match((await tool.run({ task: 'x' }, { channel: 'job', getUser: async () => user })).error, /segundo plano/);
  assert.match((await tool.run({ task: 'x' }, { getUser: async () => null })).error, /iniciar sesión/);
  assert.match((await tool.run({ task: '   ' }, { getUser: async () => user })).error, /qué debe hacer/);
});

t('no more than three jobs at once', async () => {
  const db = fakeJobs();
  const restore = installNeon(db.handlers);
  try {
    for (let i = 0; i < S.MAX_ACTIVE; i += 1) assert.ok((await S.createJob(user.id, { label: `t${i}`, task: 'x' })).job);
    assert.match((await S.createJob(user.id, { label: 'otra', task: 'x' })).error, /Ya hay 3/);
  } finally {
    restore();
  }
});

t('a job runs once: result, cards and page actions are kept; tasks and memory were already applied', async () => {
  const db = fakeJobs();
  const restore = installNeon(db.handlers);
  try {
    const { job } = await S.createJob(user.id, { label: 'Informe', task: 'Haz el informe', timezone: 'UTC' });
    const seen = [];
    const ask = async (args) => {
      seen.push(args);
      return {
        reply: 'Revisé tus correos y dejé el resumen.',
        changes: ['Tarea creada: Llamar a Ana'],
        steps: [{ id: 's1', tool: 'x', status: 'done' }],
        confirmations: [{ id: 'c1', tool: 'send_email', args: {} }],
        actions: [{ type: 'create_task', task: { title: 'Llamar a Ana' } }, { type: 'memory_add' }, { type: 'browser_open', url: 'https://www.notion.so/x' }],
      };
    };
    assert.deepEqual(await runJob(user, job.id, { ask }), { ok: true });
    assert.equal(seen[0].channel, 'job');
    assert.ok(seen[0].disable.includes('routines'));
    assert.match(seen[0].note, /SEGUNDO PLANO/);
    const row = db.rows[0];
    assert.equal(row.status, 'done');
    assert.match(row.result, /dejé el resumen/);
    assert.match(row.result, /✓ Tarea creada/);
    assert.deepEqual(row.actions.map((a) => a.type), ['browser_open']);
    assert.equal(row.confirmations.length, 1);
    // the second runner gets nothing
    assert.match((await runJob(user, job.id, { ask })).error, /ya está en marcha/);
  } finally {
    restore();
  }
});

t('a job that fails ends as an error the user can read', async () => {
  const db = fakeJobs();
  const restore = installNeon(db.handlers);
  try {
    const { job } = await S.createJob(user.id, { label: 'Informe', task: 'Haz el informe' });
    const out = await runJob(user, job.id, { ask: async () => { throw new Error('El proveedor de IA tardó demasiado'); } });
    assert.match(out.error, /tardó demasiado/);
    assert.equal(db.rows[0].status, 'error');
    assert.match(db.rows[0].error, /tardó demasiado/);
  } finally {
    restore();
  }
});

// ---------------- autonomy ----------------
t('autonomy: act by default, ask only when chosen, and the prompt says which', () => {
  assert.equal(AU.autonomyOf({}), 'act');
  assert.equal(AU.autonomyOf({ autonomy: 'ask' }), 'ask');
  assert.equal(AU.autonomyOf({ autonomy: 'loquesea' }), 'act');
  assert.match(AU.autonomyNote('act'), /Ya lo hice/);
  assert.match(AU.autonomyNote('act'), /background_task/);
  assert.match(AU.autonomyNote('ask'), /¿lo hago\?/);
});

t('with autonomy act, a reversible sensitive tool runs and is reported; with ask (or nothing) it waits for the card', async () => {
  const env = { ...process.env, NOTION_TOKEN: 't', EDDIE_OWNER_EMAIL: 'a@b.c' };
  const tool = R.CONNECTORS.flatMap((c) => c.tools).find((x) => x.declaration.name === 'notion_create_page');
  assert.equal(tool.autonomy, 'act');
  const original = { prepare: tool.prepare, run: tool.run };
  const ran = [];
  tool.prepare = async (args) => ({ args: { ...args, parent: 'p1' }, preview: { title: 'x', fields: [] } });
  tool.run = async (args) => {
    ran.push(args);
    return { summary: 'Página creada' };
  };
  try {
    for (const [autonomy, runs] of [['act', 1], ['ask', 0], [undefined, 0]]) {
      ran.length = 0;
      const toolset = R.createToolset({ env, context: { autonomy }, intent: 'notion' });
      const out = await toolset.execute('notion_create_page', { title: 'Plan' });
      assert.equal(ran.length, runs, String(autonomy));
      if (runs) {
        assert.equal(out.autoApproved, true);
        assert.equal(ran[0].parent, 'p1');
        assert.equal(toolset.confirmations.length, 0);
      } else {
        assert.equal(out.status, 'awaiting_confirmation');
        assert.equal(toolset.confirmations.length, 1);
      }
    }
  } finally {
    Object.assign(tool, original);
  }
});

t('what cannot be undone never skips the card, whatever the autonomy', () => {
  const never = ['send_email', 'delete_task', 'delete_event', 'forget', 'reception_book', 'computer_action', 'ledger_delete', 'github_comment'];
  const tools = R.CONNECTORS.flatMap((c) => c.tools);
  for (const name of never) {
    const tool = tools.find((x) => x.declaration.name === name);
    assert.ok(tool, name);
    assert.equal(tool.sensitive, true, name);
    assert.notEqual(tool.autonomy, 'act', name);
  }
});

t('the app words a finished job and reports each one once', () => {
  const done = { id: 'a', label: 'Informe', status: 'done', result: 'Revisé todo.', confirmations: [{ id: 'c' }], seen: false };
  assert.match(AJ.jobReport(done), /^Terminé «Informe»\. Revisé todo\./);
  assert.match(AJ.jobReport(done), /una acción que necesita tu OK/);
  assert.match(AJ.jobReport({ ...done, status: 'error', error: 'sin red' }), /No pude terminar «Informe»: sin red/);
  const jobs = [done, { id: 'b', status: 'running' }, { id: 'c', status: 'done', seen: true }, { id: 'd', status: 'error', error: 'x' }];
  assert.deepEqual(AJ.toReport(jobs, new Set()).map((j) => j.id), ['a', 'd']);
  assert.deepEqual(AJ.toReport(jobs, new Set(['a'])).map((j) => j.id), ['d']);
});
