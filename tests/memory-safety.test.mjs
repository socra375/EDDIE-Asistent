// Memory: secrets never get in (every door), changes keep their history and don't hide, guesses don't overwrite
// what the user confirmed, and each memory says where it came from and how sure it is.
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const M = await import(`${root}/src/services/memory.js`);
const S = await import(`${root}/src/services/secrets.js`);
const K = await import(`${root}/src/services/brainKinds.js`);
const A = await import(`${root}/api/_lib/brain/analyze.js`);
const mem = (await import(`${root}/api/_lib/connectors/memory/index.js`)).default;
const tool = (name) => mem.tools.find((x) => x.declaration.name === name);

import { test } from 'node:test';
const t = (name, fn) => test(name, fn);
const NOW = 1_760_000_000_000;
const DAY = 86400000;

// ---------------- the filter ----------------
await t('secrets: what must be caught is caught, ordinary facts pass', () => {
  for (const bad of ['mi contraseña es hunter2', 'la API key es sk-abcdefghijklmnop1234', 'mi tarjeta 4111 1111 1111 1111', 'token ghp_abcdefghijklmnopqrstuvwx1234', 'AIzaSyA1234567890abcdefghijklmnopqrstu', 'nak_live_2929abcdef123456', 'Bearer abcdefghijklmnopqrstuvwxyz0123', 'x9A8b7C6d5E4f3G2h1I0j9K8l7M6n5O4p3', '-----BEGIN PRIVATE KEY-----']) assert.ok(S.looksSecret(bad), bad);
  for (const ok of ['Vivo en Santo Domingo', 'Prefiere respuestas cortas y con humor', 'Proyecto Gestor Empresarial · stack: React y Neon', 'Mi teléfono es 809 555 0101', 'mi-proyecto-de-gestion-empresarial-v2-final', 'Estudia ingeniería en sistemas, tercer año']) assert.ok(!S.looksSecret(ok), ok);
});

await t('redactSecrets cuts the value and keeps the meaning', () => {
  assert.equal(S.redactSecrets('Su contraseña es hunter2 y la key sk-abcdefghijklmnop1234. Preguntó cómo cambiar su contraseña.'), `Su contraseña es ${S.REDACTED} y la key ${S.REDACTED}. Preguntó cómo cambiar su contraseña.`);
  assert.equal(S.redactSecrets('la clave es importante para el negocio'), 'la clave es importante para el negocio');
  assert.equal(S.redactSecrets('clave de acceso: p4ss!word'), `clave de acceso: ${S.REDACTED}`);
  assert.equal(S.redactSecrets(null), '');
});

await t('addItem and upsertProject refuse secrets, from any door (manual, document, conversation, tool)', () => {
  const m0 = M.emptyMemory();
  for (const item of [{ category: 'profile', key: 'clave', text: 'mi contraseña es hunter2' }, { category: 'knowledge', text: 'la key sk-abcdefghijklmnop1234' }, { category: 'decisions', text: 'usar la tarjeta 4111 1111 1111 1111' }, { category: 'preferences', key: 'token', text: 'ok' }]) {
    const r = M.addItem(m0, item, NOW);
    assert.equal(r.changed, false);
    assert.equal(r.blocked, true, JSON.stringify(item));
    assert.equal(r.memory, m0);
  }
  assert.equal(M.upsertProject(m0, { name: 'Gestor', status: 'password: abc12345' }, NOW).blocked, true);
  const out = M.applyActions(m0, [{ type: 'memory_add', category: 'profile', key: 'x', text: 'mi contraseña es hunter2', source: 'conversacion' }, { type: 'memory_add', category: 'profile', key: 'ciudad', text: 'Santo Domingo' }], NOW);
  assert.equal(out.skipped, 1);
  assert.equal(out.memory.profile.length, 1);
});

// ---------------- changes keep their history ----------------
await t('a changed fact keeps the old value, says so, and a repeat changes nothing', () => {
  let m = M.emptyMemory();
  m = M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santiago', source: 'chat', confidence: 'confirmado' }, NOW).memory;
  assert.equal(M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santiago' }, NOW).changed, false);
  const r = M.addItem(m, { category: 'profile', key: 'Ciudad', text: 'Santo Domingo', source: 'chat', confidence: 'confirmado' }, NOW + DAY);
  assert.equal(r.changed, true);
  assert.equal(r.label, 'ciudad: Santo Domingo (antes: Santiago)');
  assert.deepEqual(r.replaced, { key: 'ciudad', previous: 'Santiago' });
  const item = r.memory.profile[0];
  assert.equal(item.text, 'Santo Domingo');
  assert.deepEqual(item.history, [{ text: 'Santiago', at: NOW }]);
  assert.equal(item.confidence, 'confirmado');
  // three more changes: only the last three previous values are kept, newest first
  let cur = r.memory;
  for (const [i, v] of ['Puerto Plata', 'La Vega', 'Higüey'].entries()) cur = M.addItem(cur, { category: 'profile', key: 'ciudad', text: v, confidence: 'confirmado' }, NOW + (i + 2) * DAY).memory;
  assert.deepEqual(cur.profile[0].history.map((h) => h.text), ['La Vega', 'Puerto Plata', 'Santo Domingo']);
  // it survives a round trip through normalizeMemory (storage, sync)
  assert.deepEqual(M.normalizeMemory(JSON.parse(JSON.stringify(cur)), NOW + 9 * DAY).profile[0].history, cur.profile[0].history);
});

await t('a guess never overwrites what the user confirmed; it is reported; guesses among themselves do overwrite', () => {
  let m = M.addItem(M.emptyMemory(), { category: 'profile', key: 'ciudad', text: 'Santo Domingo', confidence: 'confirmado', source: 'chat' }, NOW).memory;
  const r = M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santiago', confidence: 'inferido', source: 'conversacion' }, NOW + DAY);
  assert.equal(r.changed, false);
  assert.deepEqual(r.conflict, { key: 'ciudad', kept: 'Santo Domingo', proposed: 'Santiago' });
  const out = M.applyActions(m, [{ type: 'memory_add', category: 'profile', key: 'ciudad', text: 'Santiago', confidence: 'inferido', source: 'conversacion' }], NOW + DAY);
  assert.equal(out.memory.profile[0].text, 'Santo Domingo');
  assert.match(out.applied[0], /Sin cambiar «ciudad»: sigue «Santo Domingo» \(en la conversación parecía «Santiago»/);
  assert.equal(out.conflicts.length, 1);
  // a legacy item (no confidence) counts as confirmed, so it is protected too
  const legacy = M.normalizeMemory({ v: 2, profile: [{ id: 'a', key: 'ciudad', text: 'La Vega', updatedAt: NOW }] }, NOW);
  assert.ok(M.addItem(legacy, { category: 'profile', key: 'ciudad', text: 'Otra', confidence: 'inferido' }, NOW).conflict);
  // guess vs guess: the newer guess wins; a confirmation of the same text removes the doubt
  const g1 = M.addItem(M.emptyMemory(), { category: 'preferences', key: 'tono', text: 'formal', confidence: 'inferido' }, NOW).memory;
  const g2 = M.addItem(g1, { category: 'preferences', key: 'tono', text: 'cercano', confidence: 'inferido' }, NOW + 1);
  assert.equal(g2.changed, true);
  const g3 = M.addItem(g2.memory, { category: 'preferences', key: 'tono', text: 'cercano', confidence: 'confirmado', source: 'chat' }, NOW + 2);
  assert.equal(g3.changed, true);
  assert.equal(g3.memory.preferences[0].confidence, 'confirmado');
  assert.match(g3.label, /confirmado/);
  // and the user's own words do overwrite a confirmed fact
  assert.equal(M.addItem(m, { category: 'profile', key: 'ciudad', text: 'Santiago', confidence: 'confirmado' }, NOW + DAY).changed, true);
});

// ---------------- decisions ----------------
await t('a decision that replaces another keeps it as history, revoked; revoked ones do not reach the prompt', () => {
  let m = M.addItem(M.emptyMemory(), { category: 'decisions', text: 'Usar Supabase para la base de datos', project: 'Gestor', confidence: 'confirmado' }, NOW).memory;
  const old = m.decisions[0];
  assert.equal(old.status, 'vigente');
  const r = M.addItem(m, { category: 'decisions', text: 'Usar Neon para la base de datos', project: 'Gestor', confidence: 'confirmado', supersedes: [old.id] }, NOW + DAY);
  assert.match(r.label, /reemplaza una decisión anterior/);
  assert.equal(r.memory.decisions.find((d) => d.id === old.id).status, 'revocada');
  assert.equal(r.memory.decisions.at(-1).status, 'vigente');
  const prompt = M.formatMemoryForPrompt(r.memory, 'qué base de datos usa el Gestor', { now: NOW + 2 * DAY });
  assert.match(prompt, /Neon/);
  assert.ok(!/Supabase/.test(prompt), prompt);
  // the model's flat view still lists it, flagged
  const flat = M.memoryForContext(r.memory, NOW + 2 * DAY);
  assert.equal(flat.find((x) => /Supabase/.test(x.t)).f, '[revocada]');
  // two devices: one saw the revocation, the other did not → revoked stays revoked
  const stale = { ...r.memory, decisions: r.memory.decisions.map((d) => ({ ...d, status: 'vigente' })) };
  const merged = M.mergeMemory(stale, r.memory, NOW + 3 * DAY);
  assert.equal(merged.decisions.find((d) => /Supabase/.test(d.text)).status, 'revocada');
  // old data without status loads as «vigente»
  assert.equal(M.normalizeMemory({ v: 2, decisions: [{ id: 'd', text: 'x', date: NOW }] }, NOW).decisions[0].status, 'vigente');
});

await t('what is only a guess is marked for the model; provenance labels for the panel', () => {
  let m = M.addItem(M.emptyMemory(), { category: 'profile', key: 'trabajo', text: 'Diseñador', confidence: 'inferido', source: 'conversacion' }, NOW).memory;
  m = M.addItem(m, { category: 'knowledge', text: 'El hosting está en Vercel', confidence: 'inferido', source: 'conversacion' }, NOW).memory;
  const prompt = M.formatMemoryForPrompt(m, 'hosting en Vercel', { now: NOW });
  assert.match(prompt, /trabajo: Diseñador \(sin confirmar\)/);
  assert.match(prompt, /El hosting está en Vercel \(sin confirmar\)/);
  assert.equal(M.provenanceLabel(m.profile[0]), 'de una conversación · sin confirmar');
  assert.equal(M.provenanceLabel({ source: 'chat', confidence: 'confirmado' }), 'dicho a Eddie');
  assert.equal(M.provenanceLabel({ history: [{ text: 'Santiago', at: 1 }], source: 'manual' }), 'escrito por ti · antes: Santiago');
  assert.equal(M.provenanceLabel({}), '');
});

// ---------------- the automatic paths ----------------
await t('cleanItems drops anything that talks about or holds a secret; confidence defaults by origin', () => {
  const raw = [
    { kind: 'dato', key: 'ciudad', text: 'Vive en Santo Domingo', confidence: 'confirmado' },
    { kind: 'dato', key: 'clave', text: 'Su contraseña de Gmail es hunter2' },
    { kind: 'conocimiento', text: 'La API key de Gemini es AIzaSyA1234567890abcdefghijklmnopqrstu' },
    { kind: 'proyecto', name: 'Gestor', status: 'token: abc123xyz' },
    { kind: 'preferencia', key: 'tono', text: 'Prefiere un tono cercano' },
    { kind: 'preferencia', key: 'formato', text: 'Prefiere listas cortas', confidence: 'raro' },
  ];
  const conv = K.cleanItems(raw);
  assert.deepEqual(conv.map((i) => i.text || i.name), ['Vive en Santo Domingo', 'Prefiere un tono cercano', 'Prefiere listas cortas']);
  assert.deepEqual(conv.map((i) => i.confidence), ['confirmado', 'inferido', 'inferido']);
  assert.deepEqual(K.cleanItems(raw, { defaultConfidence: 'confirmado' }).map((i) => i.confidence), ['confirmado', 'confirmado', 'confirmado']);
  const { actions } = K.itemsToActions(conv, { source: 'conversacion' });
  assert.deepEqual(actions[1], { type: 'memory_add', category: 'preferences', key: 'tono', text: 'Prefiere un tono cercano', source: 'conversacion', confidence: 'inferido' });
});

await t('conversation analysis: the AI never sees the secret, and nothing sensitive comes back out', async () => {
  const seen = [];
  const complete = async ({ prompt }) => {
    seen.push(prompt);
    // a badly behaved AI that tries to keep it anyway
    return JSON.stringify({ summary: 'El usuario pidió ayuda con su cuenta; su contraseña es hunter2 y la key sk-abcdefghijklmnop1234.', items: [
      { kind: 'dato', key: 'ciudad', text: 'Vive en Santo Domingo' },
      { kind: 'dato', key: 'acceso', text: 'Contraseña: hunter2' },
      { kind: 'preferencia', key: 'tono', text: 'Tono cercano', confidence: 'confirmado' },
    ] });
  };
  const out = await A.analyzeConversation([
    { role: 'user', content: 'Vivo en Santo Domingo y mi contraseña es hunter2, la API key es sk-abcdefghijklmnop1234' },
    { role: 'assistant', content: 'Anotado, pero no guardo contraseñas.' },
  ], { complete });
  assert.ok(!/hunter2|sk-abcdefgh/.test(seen[0]), seen[0]);
  assert.match(seen[0], /\[dato sensible omitido\]/);
  assert.ok(!/hunter2|sk-abcdefgh/.test(out.summary), out.summary);
  assert.deepEqual(out.items.map((i) => i.key), ['ciudad', 'tono']);
  assert.deepEqual(out.items.map((i) => i.confidence), ['inferido', 'confirmado']);
});

await t('document analysis: secrets are cut before the AI reads it; items default to confirmed', async () => {
  const seen = [];
  const complete = async ({ prompt }) => {
    seen.push(prompt);
    return JSON.stringify({ title: 'Notas del negocio', kind: 'tema', category: 'empresarial', summary: 'Notas del negocio. La contraseña del panel es hunter2 y nada más.', notes: [{ text: 'El panel de administración vive en una dirección interna y cambia cada mes.' }, { text: 'Token de acceso: ghp_abcdefghijklmnopqrstuvwx1234 para el servidor.' }], items: [{ kind: 'dato', key: 'negocio', text: 'Tiene una panadería en Santiago' }, { kind: 'dato', key: 'estimado', text: 'Parece vender pan', confidence: 'inferido' }] });
  };
  const doc = `# Notas del negocio\n\nTengo una panadería en Santiago.\nLa contraseña del panel es hunter2 y el token ghp_abcdefghijklmnopqrstuvwx1234 está en el servidor.\n`;
  const out = await A.analyzeDocument({ name: 'notas.md', text: doc }, { complete });
  assert.ok(!/hunter2|ghp_abcdef/.test(seen.join('\n')), seen.join('\n'));
  assert.ok(!/hunter2|ghp_abcdef/.test(out.summary + out.notes.join('|')), JSON.stringify(out));
  assert.deepEqual(out.items.map((i) => i.confidence), ['confirmado', 'inferido']);
});

// ---------------- the tools ----------------
const ctxWith = (memory) => ({ memory, emit: (a) => (ctxWith.actions ||= []).push(a) });
await t('remember: refuses secrets; saved facts are confirmed and from the chat; a change tells Eddie what it said before', () => {
  ctxWith.actions = [];
  const ctx = ctxWith([{ id: 'p1', c: 'profile', t: 'ciudad: Santiago' }, { id: 'd1', c: 'decisions', t: 'Usar Supabase (Gestor)' }, { id: 'd2', c: 'decisions', t: 'Hacer el login con Google' }]);
  for (const text of ['mi contraseña es hunter2', 'la tarjeta 4111 1111 1111 1111', 'sk-abcdefghijklmnop1234 es mi key']) assert.match(tool('remember').run({ category: 'conocimiento', text }, ctx).error, /No guardo/);
  assert.match(tool('remember').run({ category: 'perfil', key: 'contraseña', text: 'ok' }, ctx).error, /No guardo/);
  assert.equal(ctxWith.actions.length, 0);
  const r = tool('remember').run({ category: 'perfil', key: 'ciudad', text: 'Santo Domingo' }, ctx);
  assert.equal(r.previous, 'Santiago');
  assert.match(r.summary, /antes: Santiago/);
  assert.match(r.note, /dile al usuario .* qué decía antes/);
  assert.deepEqual(ctxWith.actions[0], { type: 'memory_add', category: 'perfil', key: 'ciudad', text: 'Santo Domingo', project: undefined, days: undefined, source: 'chat', confidence: 'confirmado' });
  // the same value again is not a change
  assert.equal(tool('remember').run({ category: 'perfil', key: 'ciudad', text: 'santiago' }, ctx).previous, undefined);
  // a decision that replaces another
  const d = tool('remember').run({ category: 'decision', text: 'Usar Neon', project: 'Gestor', replaces: 'Supabase' }, ctx);
  assert.equal(d.replaced_decisions, 1);
  assert.deepEqual(ctxWith.actions.at(-1).supersedes, ['d1']);
  // not for the other kinds
  assert.equal(tool('remember').run({ category: 'conocimiento', text: 'Algo estable', replaces: 'Supabase' }, ctx).replaced_decisions, undefined);
});

await t('update_project: refuses secrets, saves as confirmed from the chat', () => {
  ctxWith.actions = [];
  const ctx = ctxWith([]);
  assert.match(tool('update_project').run({ name: 'Gestor', status: 'la contraseña es abc123' }, ctx).error, /No guardo/);
  assert.equal(tool('update_project').run({ name: 'Gestor', status: 'desarrollo' }, ctx).saved, true);
  assert.equal(ctxWith.actions[0].source, 'chat');
  assert.equal(ctxWith.actions[0].confidence, 'confirmado');
});

await t('end to end: tool action → applyActions → memory with history, decision revoked, project provenance; recall flags guesses', () => {
  ctxWith.actions = [];
  let m = M.emptyMemory();
  const say = (name, args) => { tool(name).run(args, ctxWith(M.memoryForContext(m, NOW))); const out = M.applyActions(m, ctxWith.actions, NOW); ctxWith.actions = []; m = out.memory; return out; };
  say('remember', { category: 'perfil', key: 'ciudad', text: 'Santiago' });
  say('remember', { category: 'decision', text: 'Usar Supabase', project: 'Gestor' });
  const moved = say('remember', { category: 'perfil', key: 'ciudad', text: 'Santo Domingo' });
  assert.equal(moved.applied[0], 'Recordé: ciudad: Santo Domingo (antes: Santiago)');
  const swapped = say('remember', { category: 'decision', text: 'Usar Neon', project: 'Gestor', replaces: 'Supabase' });
  assert.match(swapped.applied[0], /reemplaza una decisión anterior/);
  say('update_project', { name: 'Gestor', status: 'desarrollo' });
  assert.equal(m.projects[0].source, 'chat');
  assert.deepEqual(m.decisions.map((d) => d.status), ['revocada', 'vigente']);
  // a guess found later in a conversation sits flagged in the recall tool
  m = M.applyActions(m, [{ type: 'memory_add', category: 'knowledge', text: 'El Gestor usa Tailwind', source: 'conversacion', confidence: 'inferido' }], NOW).memory;
  const found = tool('recall').run({ query: 'Tailwind' }, ctxWith(M.memoryForContext(m, NOW)));
  assert.equal(found.items[0].aviso, '(sin confirmar)');
  assert.ok(!('aviso' in tool('recall').run({ query: 'Santo Domingo' }, ctxWith(M.memoryForContext(m, NOW))).items[0]));
});

await t('old memories without any of the new fields load and behave as before', () => {
  const old = { v: 2, profile: [{ id: 'a', key: 'nombre', text: 'Eddie Fan', updatedAt: NOW }], projects: [{ id: 'p', name: 'Gestor', status: 'listo', updatedAt: NOW }], decisions: [{ id: 'd', text: 'Usar React', project: 'Gestor', date: NOW }], knowledge: [{ id: 'k', text: 'Vercel tiene límite de funciones', date: NOW }] };
  const m = M.normalizeMemory(old, NOW);
  assert.equal(m.profile[0].history, undefined);
  assert.equal(m.profile[0].confidence, undefined);
  assert.match(M.formatMemoryForPrompt(m, 'react gestor', { now: NOW }), /nombre: Eddie Fan\n/);
  assert.equal(M.addItem(m, { category: 'profile', key: 'nombre', text: 'Otro' }, NOW + 1).changed, true);
});

