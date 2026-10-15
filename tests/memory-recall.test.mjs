// Memory: conversations are found by plain words when the search by meaning cannot run, near-identical notes and
// facts are not stored twice, and the prompt says how much memory did not come along.
import assert from 'node:assert/strict';
import { installNeon } from './helpers/fakeneon.mjs';
process.env.GEMINI_API_KEY = 'fake';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const M = await import(`${root}/src/services/memory.js`);
const W = await import(`${root}/api/_lib/wordsearch.js`);

import { test } from 'node:test';
const t = (name, fn) => test(name, fn);
const NOW = 1_760_000_000_000;

// ---------------- plain words ----------------
await t('wordsearch: significant words, hits, database pattern', () => {
  assert.deepEqual(W.wordsOf('¿Qué decidimos sobre la base de datos del Gestor?'), ['decidimos', 'base', 'datos', 'gestor']);
  assert.equal(W.hitsIn(['base', 'datos', 'gestor'], 'Se eligió Neon como base de datos'), 2);
  assert.equal(W.patternOf(['base', 'datos', 'x']), 'base|datos');
  assert.equal(W.patternOf([]), '');
});

// ---------------- near-duplicate facts ----------------
await t('nearDuplicate: the same fact said another way is one; different or contradictory facts are not', () => {
  assert.ok(M.nearDuplicate('El hosting está en Vercel con el plan gratuito', 'El hosting del proyecto está en Vercel con el plan gratuito'));
  assert.ok(!M.nearDuplicate('Usar Neon para la base de datos del Gestor', 'Usar Supabase para la base de datos del Gestor'), 'a contradiction is not a duplicate');
  assert.ok(!M.nearDuplicate('Examen de cálculo el lunes', 'Examen de cálculo el martes'), 'too short to compare');
  assert.ok(!M.nearDuplicate('', 'algo'));
  // the same words with another number or the opposite meaning are different facts
  assert.ok(!M.nearDuplicate('El hosting del proyecto cuesta 20 dólares al mes en Vercel', 'El hosting del proyecto cuesta 30 dólares al mes en Vercel'));
  assert.ok(M.nearDuplicate('El hosting del proyecto cuesta 20 dólares al mes en Vercel', 'El hosting del proyecto cuesta 20 dólares mensuales en Vercel'));
  assert.ok(!M.nearDuplicate('Usar Neon como base de datos del Gestor Empresarial', 'No usar Neon como base de datos del Gestor Empresarial'));
  assert.ok(!M.nearDuplicate('Vive en Santo Domingo con su familia desde hace años', 'Ya no vive en Santo Domingo con su familia desde hace años'));
  let m = M.addItem(M.emptyMemory(), { category: 'knowledge', text: 'El hosting está en Vercel con el plan gratuito' }, NOW).memory;
  assert.equal(M.addItem(m, { category: 'knowledge', text: 'El hosting del proyecto está en Vercel con el plan gratuito' }, NOW).changed, false);
  assert.equal(M.addItem(m, { category: 'knowledge', text: 'El dominio está en Hostinger con renovación anual' }, NOW).changed, true);
  m = M.addItem(m, { category: 'decisions', text: 'Usar Neon para la base de datos del Gestor' }, NOW).memory;
  assert.equal(M.addItem(m, { category: 'decisions', text: 'Usar Supabase para la base de datos del Gestor' }, NOW).changed, true, 'the contradiction is kept so it can be revoked');
});

// ---------------- "N more" ----------------
const fill = (k) => {
  let m = M.emptyMemory();
  for (let i = 0; i < k; i += 1) m = M.addItem(m, { category: 'knowledge', text: `Dato número ${i} sobre el tema${String.fromCharCode(97 + (i % 26))} de la lista ${i * 7}` }, NOW + i).memory;
  return M.addItem(m, { category: 'profile', key: 'nombre', text: 'Eddie Fan' }, NOW).memory;
};
await t('the prompt says how much memory is left out, only when it is worth saying', () => {
  const big = fill(12);
  const out = M.formatMemoryForPrompt(big, 'hola', { now: NOW + 100 });
  assert.match(out, /nombre: Eddie Fan/);
  const left = Number(out.match(/Tienes (\d+) recuerdos más/)[1]);
  assert.equal(left, 12, out);
  assert.match(out, /herramienta recall/);
  // when part of it is shown, only the rest is counted
  const some = M.formatMemoryForPrompt(big, 'dato número 3 sobre el temad de la lista 21', { now: NOW + 100 });
  assert.ok(Number(some.match(/Tienes (\d+) recuerdos más/)[1]) < 12, some);
  // a small memory says nothing; nothing at all says nothing
  assert.ok(!/recuerdos más/.test(M.formatMemoryForPrompt(fill(2), 'hola', { now: NOW + 100 })));
  assert.equal(M.formatMemoryForPrompt(M.emptyMemory(), 'hola'), '');
  // replaced decisions are history, not "left out"
  let m = fill(1);
  m = M.addItem(m, { category: 'decisions', text: 'Usar Supabase para la base' }, NOW).memory;
  m = M.addItem(m, { category: 'decisions', text: 'Usar Neon para la base', supersedes: [m.decisions[0].id] }, NOW + 1).memory;
  assert.ok(!/recuerdos más/.test(M.formatMemoryForPrompt(m, 'hola', { now: NOW + 100 })));
  // the budget cutting lines also counts as left out
  let long = fill(0);
  const topics = ['jardinería', 'astronomía', 'cocina', 'ciclismo', 'fotografía', 'carpintería', 'natación', 'ajedrez', 'música', 'historia', 'idiomas', 'pintura', 'senderismo', 'robótica', 'cine', 'teatro', 'viajes', 'surf', 'yoga', 'finanzas'];
  for (const [i, topic] of topics.entries()) long = M.addItem(long, { category: 'knowledge', text: `Conocimiento sobre ${topic} guardado con detalle largo número ${i * 17}` }, NOW + i).memory;
  const cut = M.formatMemoryForPrompt(long, 'conocimiento detalle largo guardado', { now: NOW + 100, budget: 400 });
  assert.match(cut, /recuerdos más/);
});

// ---------------- conversations by words ----------------
const eps = [];
let embedMode = 'ok'; // ok | quota
let semantic = []; // what the "vector search" returns
const log = [];
const neonLog = [];
installNeon([
  [/^select count\(\*\)::int as n from episodes where user_id = \$1 and created_at/, () => [{ n: 0 }]],
  [/^select count\(\*\)::int as n from episodes where user_id = \$1/, () => [{ n: eps.length }]],
  [/^select id, summary, source, message_count, created_at, 1 - \(embedding/, () => semantic],
  [/^select id, summary, source, message_count, created_at from episodes where user_id = \$1 and summary ~\*/, ([, pattern]) => { log.push(pattern); const re = new RegExp(pattern, 'i'); return eps.filter((e) => re.test(e.summary)); }],
  [/^insert into episodes/, ([, source, , summary]) => { const r = { id: `e${eps.length + 1}`, summary, source, message_count: 4, created_at: new Date().toISOString() }; eps.push(r); return [r]; }],
  [/^delete from episodes where user_id/, () => []],
], neonLog);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes(':embedContent')) {
    if (embedMode === 'quota') return new Response('{"error":{"message":"quota"}}', { status: 429 });
    return new Response(JSON.stringify({ embedding: { values: Array.from({ length: 768 }, (_, i) => (i === 0 ? 1 : 0)) } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, init);
};
const R = await import(`${root}/api/_lib/episodes/recall.js`);
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
eps.push({ id: 'e1', summary: 'El usuario decidió usar Neon como base de datos del Gestor Empresarial y dejar Supabase.', source: 'web', message_count: 6, created_at: iso(2) });
eps.push({ id: 'e2', summary: 'Hablaron del precio de los logos y de cómo cobrar a los clientes nuevos.', source: 'web', message_count: 5, created_at: iso(1) });
const msgs = (text) => [{ role: 'user', content: text }];

await t('Gemini out of quota: the automatic recall still finds the note by plain words', async () => {
  embedMode = 'quota';
  semantic = [];
  const block = await R.recallBlock({ userId: 'u1', messages: msgs('¿Qué base de datos elegimos para el Gestor Empresarial?'), timezone: 'UTC' });
  assert.match(block, /usar Neon como base de datos del Gestor/);
  assert.ok(!/logos/.test(block), 'only the note that shares words');
});

await t('one shared word is not enough for the automatic recall, but is for an explicit question', async () => {
  embedMode = 'quota';
  assert.equal(await R.recallBlock({ userId: 'u1', messages: msgs('Cuéntame algo sobre los logos por favor, amigo'), timezone: 'UTC' }), '');
  const tool = await R.recallForTool('u1', 'logos');
  assert.equal(tool.length, 1);
  assert.match(tool[0].summary, /logos/);
  assert.deepEqual(await R.recallForTool('u1', 'xyzzy'), []);
});

await t('with the meaning search working, its answer is used and no words search is needed', async () => {
  embedMode = 'ok';
  semantic = [{ id: 'e2', summary: eps[1].summary, source: 'web', message_count: 5, created_at: eps[1].created_at, similarity: '0.8' }];
  log.length = 0;
  const block = await R.recallBlock({ userId: 'u1', messages: msgs('¿Cuánto debería cobrar por un logo nuevo?'), timezone: 'UTC' });
  assert.match(block, /precio de los logos/);
  assert.equal(log.length, 0);
});

await t('nothing by meaning: the words search tries (a question phrased unlike the note)', async () => {
  embedMode = 'ok';
  semantic = [];
  const block = await R.recallBlock({ userId: 'u1', messages: msgs('Recuérdame la base de datos que escogimos en el Gestor Empresarial'), timezone: 'UTC' });
  assert.match(block, /Neon/);
});

await t('a note almost identical to a recent one is not stored twice; an old one is', async () => {
  embedMode = 'ok';
  const analyze = async () => ({ summary: 'El usuario decidió usar Neon como base de datos del Gestor Empresarial y dejar Supabase.', items: [{ kind: 'preferencia', key: 'tono', text: 'Prefiere un tono cercano', confidence: 'inferido' }] });
  const messages = [1, 2, 3, 4].map((i) => ({ role: i % 2 ? 'user' : 'assistant', content: `mensaje ${i} de la conversación` }));
  const before = eps.length;
  semantic = [{ id: 'e1', summary: eps[0].summary, source: 'web', message_count: 6, created_at: eps[0].created_at, similarity: '0.99' }];
  const dup = await R.saveConversation({ userId: 'u1', messages, analyze, keepLearning: false });
  assert.equal(dup.saved, true);
  assert.equal(dup.duplicate, true);
  assert.equal(dup.episode.id, 'e1');
  assert.equal(eps.length, before, 'nothing inserted');
  assert.equal(dup.actions.length, 1, 'what the conversation taught still reaches the memory');
  // less similar: stored
  semantic = [{ id: 'e1', summary: eps[0].summary, source: 'web', message_count: 6, created_at: eps[0].created_at, similarity: '0.9' }];
  assert.equal((await R.saveConversation({ userId: 'u1', messages, analyze, keepLearning: false })).duplicate, undefined);
  assert.equal(eps.length, before + 1);
  // identical but from weeks ago: it is new news again
  semantic = [{ id: 'e1', summary: eps[0].summary, source: 'web', message_count: 6, created_at: iso(20), similarity: '0.99' }];
  assert.equal((await R.saveConversation({ userId: 'u1', messages, analyze, keepLearning: false })).duplicate, undefined);
  assert.equal(eps.length, before + 2);
});

