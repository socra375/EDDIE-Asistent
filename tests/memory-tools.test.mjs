// Memory: taking it out and bringing it back (a file, and the copy held for a week after «borrar todo»), and the review
// that proposes what to clean without changing anything.
import assert from 'node:assert/strict';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const M = await import(`${root}/src/services/memory.js`);
const B = await import(`${root}/src/services/memoryBackup.js`);
const mem = (await import(`${root}/api/_lib/connectors/memory/index.js`)).default;
const t = (name, fn) => test(name, fn);

const NOW = 1_760_000_000_000;
const DAY = 86400000;
const fakeStore = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; }, data };
};
const sample = () => {
  let m = M.emptyMemory();
  m = M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santo Domingo', source: 'chat', confidence: 'confirmado' }, NOW).memory;
  m = M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santiago', source: 'chat', confidence: 'confirmado' }, NOW + 1).memory;
  m = M.addItem(m, { category: 'decisions', text: 'Usar Neon para la base de datos', project: 'Gestor', confidence: 'confirmado' }, NOW).memory;
  m = M.addItem(m, { category: 'knowledge', text: 'El hosting está en Vercel', confidence: 'inferido', source: 'conversacion' }, NOW).memory;
  return m;
};

// ---------------- the copy after «borrar todo» ----------------
t('backup: kept for a week, read back whole, gone after that', () => {
  const store = fakeStore();
  const m = sample();
  assert.equal(B.saveBackup(store, m, NOW), true);
  const back = B.readBackup(store, NOW + 6 * DAY);
  assert.equal(back.count, M.countItems(m));
  assert.equal(back.at, NOW);
  assert.deepEqual(back.memory.profile[0].history.map((h) => h.text), ['Santo Domingo'], 'history survives');
  assert.equal(B.readBackup(store, NOW + 8 * DAY), null);
  assert.equal(store.getItem(B.BACKUP_KEY), null, 'an expired copy is dropped');
});

t('backup: nothing to keep, a refusing store, damaged data and a clock gone back are all harmless', () => {
  const store = fakeStore();
  assert.equal(B.saveBackup(store, M.emptyMemory(), NOW), false);
  assert.equal(store.getItem(B.BACKUP_KEY), null);
  assert.equal(B.saveBackup({ setItem: () => { throw new Error('full'); } }, sample(), NOW), false);
  assert.equal(B.readBackup(fakeStore({ [B.BACKUP_KEY]: '{no json' }), NOW), null);
  assert.equal(B.readBackup(fakeStore({ [B.BACKUP_KEY]: JSON.stringify({ at: NOW + DAY, memory: sample() }) }), NOW), null);
  assert.equal(B.readBackup(fakeStore({ [B.BACKUP_KEY]: JSON.stringify({ at: NOW, memory: { v: 2 } }) }), NOW), null, 'an empty copy is no copy');
  const s = fakeStore();
  B.saveBackup(s, sample(), NOW);
  B.dropBackup(s);
  assert.equal(B.readBackup(s, NOW), null);
});

// ---------------- the file ----------------
t('export and import: a round trip keeps everything, including the history of a changed fact', () => {
  const m = sample();
  const file = B.exportMemory(m, NOW);
  const parsed = JSON.parse(file);
  assert.equal(parsed.app, 'eddie');
  assert.equal(parsed.type, 'memoria');
  assert.equal(parsed.exportedAt, new Date(NOW).toISOString());
  assert.match(B.exportFileName(NOW), /^eddie-memoria-2025-10-09\.json$/);
  const back = B.parseMemoryExport(file, NOW);
  assert.equal(back.count, M.countItems(m));
  assert.equal(back.removed, 0);
  assert.deepEqual(back.memory.profile[0].history, m.profile[0].history);
  assert.equal(back.memory.knowledge[0].confidence, 'inferido');
});

t('import: accepts a bare memory and the old flat map; refuses what is not a memory', () => {
  assert.equal(B.parseMemoryExport(JSON.stringify(sample()), NOW).count, 3);
  assert.equal(B.parseMemoryExport(JSON.stringify({ nombre: 'Eddie Fan', ciudad: 'Santiago' }), NOW).count, 2);
  for (const bad of ['', '   ', '{no json', '[]', '"texto"', 'null', JSON.stringify({ v: 2, profile: [] }), JSON.stringify({ cualquier: { cosa: 1 } })]) assert.ok(B.parseMemoryExport(bad, NOW).error, bad);
  assert.match(B.parseMemoryExport('x'.repeat(B.MAX_IMPORT_CHARS + 1), NOW).error, /demasiado grande/);
});

t('import: a file cannot carry in what the chat would have refused', () => {
  const file = JSON.stringify({ app: 'eddie', type: 'memoria', memory: { v: 2, profile: [{ id: 'a', key: 'ciudad', text: 'Santiago', updatedAt: NOW }, { id: 'b', key: 'acceso', text: 'mi contraseña es hunter2', updatedAt: NOW }], knowledge: [{ id: 'c', text: 'La key sk-abcdefghijklmnop1234 abre el panel', date: NOW }], decisions: [], preferences: [], projects: [], context: [] } });
  const parsed = B.parseMemoryExport(file, NOW);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.removed, 2);
  assert.deepEqual(parsed.memory.profile.map((i) => i.key), ['ciudad']);
  const onlySecrets = JSON.stringify({ v: 2, profile: [{ id: 'b', key: 'acceso', text: 'mi contraseña es hunter2', updatedAt: NOW }] });
  assert.match(B.parseMemoryExport(onlySecrets, NOW).error, /contraseñas o claves/);
});

t('import adds to the memory, never replaces it', () => {
  const current = M.addItem(M.emptyMemory(), { category: 'profile', key: 'nombre', text: 'Eddie Fan', confidence: 'confirmado' }, NOW).memory;
  const incoming = B.parseMemoryExport(B.exportMemory(sample(), NOW), NOW).memory;
  const { memory, added } = B.mergeImport(current, incoming, NOW + DAY);
  assert.equal(added, 3);
  assert.equal(memory.profile.length, 2, 'what was there stays');
  assert.equal(B.mergeImport(memory, incoming, NOW + DAY).added, 0, 'importing the same file twice adds nothing');
  // the newer copy of a keyed fact wins, wherever it comes from
  const older = M.addItem(M.emptyMemory(), { category: 'profile', key: 'ciudad', text: 'La Vega' }, NOW - 5 * DAY).memory;
  assert.equal(B.mergeImport(older, incoming, NOW).memory.profile[0].text, 'Santiago');
});

// ---------------- the review ----------------
t('review: finds a secret from before the filter, a repeat, an old guess, old history and a full category', () => {
  const m = M.normalizeMemory({
    v: 2,
    profile: [{ id: 'p1', key: 'ciudad', text: 'Santiago', updatedAt: NOW }, { id: 'p2', key: 'wifi', text: 'la contraseña es hunter2', updatedAt: NOW }],
    preferences: [{ id: 'f1', key: 'tono', text: 'formal', updatedAt: NOW - 40 * DAY, confidence: 'inferido' }, { id: 'f2', key: 'formato', text: 'listas', updatedAt: NOW - 2 * DAY, confidence: 'inferido' }],
    decisions: [
      { id: 'd1', text: 'Usar Neon para la base de datos del Gestor', date: NOW - DAY },
      { id: 'd2', text: 'Usar Neon para la base de datos del Gestor Empresarial', date: NOW - DAY },
      { id: 'd3', text: 'Usar Supabase', date: NOW - 200 * DAY, status: 'revocada' },
    ],
    knowledge: Array.from({ length: 74 }, (_, i) => ({ id: `k${i}`, text: `Dato suelto número ${i} sobre el tema ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${i}`, date: NOW })),
    projects: [], context: [],
  }, NOW);
  const found = M.reviewMemory(m, NOW);
  const byKind = Object.fromEntries(found.map((f) => [f.kind, f]));
  assert.deepEqual(byKind.secreto.ids, ['p2']);
  assert.equal(byKind.secreto.category, 'profile');
  assert.deepEqual(byKind.repetido.ids, ['d2']);
  assert.match(byKind.repetido.advice, /Usar Neon/);
  assert.deepEqual(found.filter((f) => f.kind === 'sin_confirmar').map((f) => f.ids[0]), ['f1'], 'only the guess older than a month');
  assert.deepEqual(byKind.historial.ids, ['d3']);
  assert.match(byKind.llena.text, /Conocimientos: 74 de 80/);
  // it only proposes: the memory is untouched
  assert.equal(M.countItems(m), 2 + 2 + 3 + 74);
});

t('review: a tidy memory has nothing to report; revoked decisions are not called repeats', () => {
  assert.deepEqual(M.reviewMemory(sample(), NOW + DAY), []);
  let m = M.addItem(M.emptyMemory(), { category: 'decisions', text: 'Usar Supabase para la base de datos del Gestor' }, NOW).memory;
  m = M.addItem(m, { category: 'decisions', text: 'Usar Neon para la base de datos del Gestor', supersedes: [m.decisions[0].id] }, NOW + 1).memory;
  assert.deepEqual(M.reviewMemory(m, NOW + DAY), []);
});

// ---------------- the tool ----------------
const tool = (name) => mem.tools.find((x) => x.declaration.name === name);

t('review_memory: from the list the chat sends, proposes and never changes anything', () => {
  const emitted = [];
  const ctx = {
    emit: (a) => emitted.push(a),
    memory: [
      { id: 'a', c: 'profile', t: 'ciudad: Santiago' },
      { id: 'b', c: 'profile', t: 'wifi: la contraseña es hunter2' },
      { id: 'c', c: 'knowledge', t: 'El hosting del proyecto está en Vercel con el plan gratuito' },
      { id: 'd', c: 'knowledge', t: 'El hosting está en Vercel con el plan gratuito', f: '(sin confirmar)' },
    ],
  };
  const out = tool('review_memory').run({}, ctx);
  assert.equal(out.found, 2);
  assert.equal(out.findings[0].tipo, 'secreto');
  assert.match(out.findings[0].texto, /hunter2/);
  assert.equal(out.findings[0].donde, 'Perfil');
  assert.equal(out.findings[1].tipo, 'repetido');
  assert.match(out.note, /no cambios/);
  assert.match(out.note, /forget/);
  assert.equal(emitted.length, 0);
  assert.match(tool('review_memory').run({}, { memory: [] }).note, /vacía/);
  assert.equal(tool('review_memory').run({}, { memory: [{ id: 'a', c: 'profile', t: 'ciudad: Santiago' }] }).found, 0);
  assert.equal(tool('review_memory').risk, 'read');
  assert.ok(!tool('review_memory').sensitive);
});

t('memoryFromFlat understands every category of the flat list and ignores junk', () => {
  const m = M.memoryFromFlat([
    { id: 'a', c: 'preferences', t: 'tono: cercano' },
    { id: 'b', c: 'projects', t: 'Gestor · repo: socra375/EDDIE-Asistent · estado: producción' },
    { id: 'c', c: 'decisions', t: 'Usar Neon (Gestor)', f: '[revocada]' },
    { id: 'd', c: 'context', t: 'Viaja el sábado' },
    { c: 'profile', t: 'sin id' },
    { id: 'x', c: 'inventada', t: 'no existe' },
    null,
  ]);
  assert.deepEqual([m.preferences.length, m.projects.length, m.decisions.length, m.context.length, m.profile.length], [1, 1, 1, 1, 0]);
  assert.equal(m.preferences[0].key, 'tono');
  assert.equal(m.preferences[0].text, 'cercano');
  assert.equal(m.projects[0].name, 'Gestor');
  assert.equal(m.decisions[0].status, 'revocada');
  assert.equal(M.memoryFromFlat(undefined).profile.length, 0);
});
