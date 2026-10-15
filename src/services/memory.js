// Eddie's structured memory. Pure functions over a plain object (no storage,
// no React), so they're easy to test and reusable on any surface.
//
//   { v: 2,
//     profile:     [{ id, key, text, updatedAt }]   who the user is
//     preferences: [{ id, key, text, updatedAt }]   how they like things done
//     projects:    [{ id, name, status, stack, repo, lastChange, nextGoal, updatedAt }]
//     decisions:   [{ id, text, project, date }]    what was decided, and why
//     knowledge:   [{ id, text, date }]             stable facts worth keeping
//     context:     [{ id, text, expiresAt, date }]  temporary ("viaja el sábado")
//   }
//
// Tasks live in their own module (Tareas) and conversations in the history;
// this is what Eddie should *know*, not what it was asked to do.

import { looksSecret } from './secrets.js';

export const MEMORY_VERSION = 2;

// Where a memory came from and how sure it is: told to Eddie in the chat, found by him in a conversation, read from
// a document or written by hand. «inferido» is a deduction, not something the user said: it is shown to the model as
// unconfirmed and never overwrites what the user did confirm.
export const SOURCES = ['chat', 'conversacion', 'documento', 'manual'];
export const CONFIDENCES = ['confirmado', 'inferido'];
const HISTORY_MAX = 3;

export const CATEGORIES = [
  { id: 'profile', label: 'Perfil', hint: 'Quién eres: nombre, trabajo, estudios, ciudad.' },
  { id: 'preferences', label: 'Preferencias', hint: 'Cómo te gusta que te hable y trabaje.' },
  { id: 'projects', label: 'Proyectos', hint: 'En qué trabajas: estado, stack, último cambio, próximo objetivo.' },
  { id: 'decisions', label: 'Decisiones', hint: 'Lo que decidiste y por qué.' },
  { id: 'knowledge', label: 'Conocimientos', hint: 'Datos estables que conviene recordar.' },
  { id: 'context', label: 'Contexto temporal', hint: 'Lo que vale por unos días (un viaje, un examen).' },
];

const LIMITS = { profile: 30, preferences: 30, projects: 20, decisions: 50, knowledge: 80, context: 20 };
const TEXT_MAX = 300;
const KEY_MAX = 60;
const FIELD_MAX = 160;
const DEFAULT_CONTEXT_DAYS = 7;
const MAX_CONTEXT_DAYS = 60;
const DAY_MS = 86400000;

export function emptyMemory() {
  return { v: MEMORY_VERSION, profile: [], preferences: [], projects: [], decisions: [], knowledge: [], context: [] };
}

let idCounter = 0;
export function memoryId() {
  idCounter += 1;
  return `m${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const clean = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isTime = (n) => typeof n === 'number' && Number.isFinite(n);

// {source?, confidence?} of an item or of an incoming fact, only what is valid.
function provenance(x) {
  const out = {};
  if (SOURCES.includes(x?.source)) out.source = x.source;
  if (CONFIDENCES.includes(x?.confidence)) out.confidence = x.confidence;
  return out;
}

// What the item keeps when a new fact meets it: «confirmado» always wins, and a deduction never takes the place of
// where a confirmed fact came from.
function mergedProvenance(existing, incoming) {
  const have = provenance(existing);
  const next = provenance(incoming);
  if (next.confidence === 'confirmado' || !have.confidence) return { ...have, ...next };
  return have;
}

// The values a keyed item had before (newest first), for «antes decía…».
function cleanHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h) => h && typeof h === 'object' && clean(h.text, TEXT_MAX))
    .slice(0, HISTORY_MAX)
    .map((h) => ({ text: clean(h.text, TEXT_MAX), at: isTime(h.at) ? h.at : 0 }));
}

function keepNewest(list, limit) {
  return list.length > limit ? list.slice(list.length - limit) : list;
}

// Sanitizes one category of a stored object: drops junk, caps lengths.
function cleanList(category, raw, now) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' && item.id ? item.id.slice(0, 40) : memoryId();
    if (category === 'profile' || category === 'preferences') {
      const key = clean(item.key, KEY_MAX);
      const text = clean(item.text, TEXT_MAX);
      if (!key || !text) continue;
      const entry = { id, key, text, updatedAt: isTime(item.updatedAt) ? item.updatedAt : now, ...provenance(item) };
      const history = cleanHistory(item.history);
      if (history.length) entry.history = history;
      out.push(entry);
    } else if (category === 'projects') {
      const name = clean(item.name, KEY_MAX);
      if (!name) continue;
      out.push({
        id,
        name,
        status: clean(item.status, FIELD_MAX),
        stack: clean(item.stack, FIELD_MAX),
        repo: clean(item.repo, 100),
        lastChange: clean(item.lastChange, FIELD_MAX),
        nextGoal: clean(item.nextGoal, FIELD_MAX),
        updatedAt: isTime(item.updatedAt) ? item.updatedAt : now,
        ...provenance(item),
      });
    } else {
      const text = clean(item.text, TEXT_MAX);
      if (!text) continue;
      const entry = { id, text, date: isTime(item.date) ? item.date : now, ...provenance(item) };
      if (category === 'decisions') {
        entry.project = clean(item.project, KEY_MAX);
        entry.status = item.status === 'revocada' ? 'revocada' : 'vigente';
      }
      if (category === 'context') {
        entry.expiresAt = isTime(item.expiresAt) ? item.expiresAt : now + DEFAULT_CONTEXT_DAYS * DAY_MS;
        if (entry.expiresAt <= now) continue; // already expired
      }
      out.push(entry);
    }
  }
  return keepNewest(out, LIMITS[category]);
}

// Reads anything that may be stored — nothing, the old flat { key: value }
// map, or a v2 object — and returns a clean v2 memory. The old facts keep
// their place: the study level is part of the profile, the last topic was
// only ever a passing thing, so it becomes temporary context.
export function normalizeMemory(raw, now = Date.now()) {
  const memory = emptyMemory();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return memory;
  if (raw.v === MEMORY_VERSION) {
    for (const { id } of CATEGORIES) memory[id] = cleanList(id, raw[id], now);
    return memory;
  }
  for (const [key, value] of Object.entries(raw)) {
    const text = clean(value, TEXT_MAX);
    if (!text || typeof value === 'object') continue;
    if (key === 'ultimo_tema_estudiado') {
      memory.context.push({ id: memoryId(), text: `Estudió: ${text}`, expiresAt: now + 14 * DAY_MS, date: now });
    } else {
      const label = key === 'nivel_academico' ? 'nivel académico' : key.replace(/_/g, ' ');
      memory.profile.push({ id: memoryId(), key: clean(label, KEY_MAX), text, updatedAt: now });
    }
  }
  return memory;
}

export function countItems(memory) {
  return CATEGORIES.reduce((n, { id }) => n + (memory?.[id]?.length || 0), 0);
}

export function isEmptyMemory(memory) {
  return countItems(memory) === 0;
}

// Drops temporary context that has expired.
export function pruneExpired(memory, now = Date.now()) {
  if (!memory.context.some((c) => c.expiresAt <= now)) return memory;
  return { ...memory, context: memory.context.filter((c) => c.expiresAt > now) };
}

function withList(memory, category, list) {
  return { ...memory, [category]: keepNewest(list, LIMITS[category]) };
}

// The same fact said another way ("El hosting está en Vercel" / "El hosting del proyecto está en Vercel"): at least
// four meaningful words each and 80 % of them in common. A shorter or looser overlap is a different fact (or a
// contradiction: "Usar Neon para la base de datos" is not "Usar Supabase para la base de datos").
const NEAR_DUPLICATE = 0.8;
const NEAR_MIN_WORDS = 4;
const NEGATION = /(?:^| )(?:no|nunca|ni|sin|jamas|tampoco)(?: |$)/;
// Numbers and negations are what turn "the same words" into a different fact ("20 dólares" / "30 dólares",
// "usar Neon" / "no usar Neon"), so they must agree before two facts can count as one.
const numbersOf = (text) => normalizeText(text).split(' ').filter((w) => /\d/.test(w)).sort().join(',');
export function nearDuplicate(a, b) {
  if (numbersOf(a) !== numbersOf(b) || NEGATION.test(normalizeText(a)) !== NEGATION.test(normalizeText(b))) return false;
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (x.size < NEAR_MIN_WORDS || y.size < NEAR_MIN_WORDS) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared) >= NEAR_DUPLICATE;
}

// Adds one fact. Profile and preferences are keyed ("nombre"): saying it again
// replaces the old value, and the old one is kept in `history` so the change is never silent. The rest skip an
// exact repeat. Returns { memory, changed, label } — `label` is the one-liner the chat shows — and, when something
// was not kept, why: `blocked` (it looked like a secret) or `conflict` (a deduction against a confirmed fact).
// `source` / `confidence` say where it came from and how sure it is; `supersedes` (decisions) lists the ids of the
// decisions this one replaces, which stay as history marked «revocada».
export function addItem(memory, { category, key, text, project, days, source, confidence, supersedes }, now = Date.now()) {
  const value = clean(text, TEXT_MAX);
  if (!value) return { memory, changed: false, label: '' };
  const incoming = provenance({ source, confidence });
  // Secrets never get in, whichever door they come through (a chat, a document, a hand-written note).
  if (looksSecret(value) || looksSecret(key) || looksSecret(project)) return { memory, changed: false, label: '', blocked: true };

  if (category === 'profile' || category === 'preferences') {
    const k = clean(key, KEY_MAX);
    if (!k) return { memory, changed: false, label: '' };
    const list = memory[category];
    const existing = list.find((i) => normalizeText(i.key) === normalizeText(k));
    if (existing && existing.text === value) {
      // The same thing, now confirmed: it stops being a guess.
      if (incoming.confidence === 'confirmado' && existing.confidence === 'inferido') {
        const next = list.map((i) => (i.id === existing.id ? { ...i, ...mergedProvenance(i, incoming), updatedAt: now } : i));
        return { memory: withList(memory, category, next), changed: true, label: `${k}: ${value} (confirmado)` };
      }
      return { memory, changed: false, label: '' };
    }
    // A guess does not overwrite what the user said: it is left as it was and the doubt is reported.
    if (existing && incoming.confidence === 'inferido' && existing.confidence !== 'inferido') {
      return { memory, changed: false, label: '', conflict: { key: existing.key, kept: existing.text, proposed: value } };
    }
    const next = existing
      ? list.map((i) =>
          i.id === existing.id
            ? { ...i, text: value, updatedAt: now, history: [{ text: existing.text, at: existing.updatedAt }, ...(existing.history || [])].slice(0, HISTORY_MAX), ...provenance(existing), ...incoming }
            : i,
        )
      : [...list, { id: memoryId(), key: k, text: value, updatedAt: now, ...incoming }];
    return { memory: withList(memory, category, next), changed: true, label: existing ? `${existing.key}: ${value} (antes: ${existing.text})` : `${k}: ${value}`, ...(existing ? { replaced: { key: existing.key, previous: existing.text } } : {}) };
  }

  if (category === 'decisions' || category === 'knowledge' || category === 'context') {
    const list = memory[category];
    if (list.some((i) => normalizeText(i.text) === normalizeText(value) || nearDuplicate(i.text, value))) return { memory, changed: false, label: '' };
    const entry = { id: memoryId(), text: value, date: now, ...incoming };
    let base = list;
    let revoked = 0;
    if (category === 'decisions') {
      entry.project = clean(project, KEY_MAX);
      entry.status = 'vigente';
      const old = new Set(Array.isArray(supersedes) ? supersedes : []);
      base = list.map((d) => {
        if (!old.has(d.id) || d.status === 'revocada') return d;
        revoked += 1;
        return { ...d, status: 'revocada' };
      });
    }
    if (category === 'context') {
      const d = Math.min(Math.max(Math.round(Number(days)) || DEFAULT_CONTEXT_DAYS, 1), MAX_CONTEXT_DAYS);
      entry.expiresAt = now + d * DAY_MS;
    }
    const label = revoked ? `${value} (reemplaza ${revoked === 1 ? 'una decisión anterior' : `${revoked} decisiones anteriores`})` : value;
    return { memory: withList(memory, category, [...base, entry]), changed: true, label };
  }

  return { memory, changed: false, label: '' };
}

// Creates or updates a project by name (case and accents ignored). Only the
// fields given change, so "ya está en producción" updates just the status.
export function upsertProject(memory, fields, now = Date.now()) {
  const name = clean(fields.name, KEY_MAX);
  if (!name) return { memory, changed: false, label: '' };
  const patch = {};
  if (fields.status != null) patch.status = clean(fields.status, FIELD_MAX);
  if (fields.stack != null) patch.stack = clean(fields.stack, FIELD_MAX);
  if (fields.repo != null) patch.repo = clean(fields.repo, 100);
  if (fields.lastChange != null) patch.lastChange = clean(fields.lastChange, FIELD_MAX);
  if (fields.nextGoal != null) patch.nextGoal = clean(fields.nextGoal, FIELD_MAX);
  if (looksSecret(name) || Object.values(patch).some(looksSecret)) return { memory, changed: false, label: '', blocked: true };
  const incoming = provenance(fields);
  const existing = memory.projects.find((p) => normalizeText(p.name) === normalizeText(name));
  if (existing) {
    const same = Object.entries(patch).every(([k, v]) => existing[k] === v);
    if (same) return { memory, changed: false, label: '' };
    const next = memory.projects.map((p) => (p.id === existing.id ? { ...p, ...patch, updatedAt: now, ...mergedProvenance(p, incoming) } : p));
    return { memory: withList(memory, 'projects', next), changed: true, label: `Proyecto ${existing.name} actualizado` };
  }
  const project = { id: memoryId(), name, status: '', stack: '', repo: '', lastChange: '', nextGoal: '', ...patch, updatedAt: now, ...incoming };
  return { memory: withList(memory, 'projects', [...memory.projects, project]), changed: true, label: `Proyecto ${name} guardado` };
}

export function removeItems(memory, ids) {
  const gone = new Set(ids);
  let removed = 0;
  const next = { ...memory };
  for (const { id } of CATEGORIES) {
    const list = memory[id].filter((i) => !gone.has(i.id));
    removed += memory[id].length - list.length;
    next[id] = list;
  }
  return { memory: removed ? next : memory, removed };
}

// Union of two memories (the one from this device and the one from the
// account), so signing in never throws away what either side knows. Keyed
// items and projects take the newer copy; the rest merge without repeats.
export function mergeMemory(a, b, now = Date.now()) {
  const left = normalizeMemory(a, now);
  const right = normalizeMemory(b, now);
  const out = emptyMemory();
  for (const category of ['profile', 'preferences']) {
    const map = new Map();
    for (const item of [...left[category], ...right[category]]) {
      const k = normalizeText(item.key);
      if (!map.has(k) || map.get(k).updatedAt <= item.updatedAt) map.set(k, item);
    }
    out[category] = keepNewest([...map.values()], LIMITS[category]);
  }
  const projects = new Map();
  for (const p of [...left.projects, ...right.projects]) {
    const k = normalizeText(p.name);
    if (!projects.has(k) || projects.get(k).updatedAt <= p.updatedAt) projects.set(k, p);
  }
  out.projects = keepNewest([...projects.values()], LIMITS.projects);
  for (const category of ['decisions', 'knowledge', 'context']) {
    const seen = new Map();
    const merged = [];
    for (const item of [...left[category], ...right[category]].sort((x, y) => x.date - y.date)) {
      const k = normalizeText(item.text);
      if (seen.has(k)) {
        // A decision revoked on one side stays revoked: it was replaced, whichever copy is read first.
        if (category === 'decisions' && item.status === 'revocada') merged[seen.get(k)] = { ...merged[seen.get(k)], status: 'revocada' };
        continue;
      }
      seen.set(k, merged.length);
      merged.push(item);
    }
    out[category] = keepNewest(merged, LIMITS[category]);
  }
  return out;
}

// ---- Applying what Eddie's memory tools asked for ----

const CATEGORY_OF = { perfil: 'profile', preferencia: 'preferences', decision: 'decisions', conocimiento: 'knowledge', contexto: 'context' };

// Applies the `memory_add` / `memory_project` / `memory_forget` actions the
// connector's tools emit to a memory object and returns { memory, applied },
// where `applied` are the one-line labels for the chat ("Recordé: …"). Pure,
// so the app (localStorage) and the Telegram bot (database) share it.
export function applyActions(memory, actions, now = Date.now()) {
  let current = memory;
  const applied = [];
  let skipped = 0;
  const conflicts = [];
  for (const action of Array.isArray(actions) ? actions : []) {
    let result = null;
    if (action?.type === 'memory_add') {
      const category = CATEGORY_OF[action.category] || action.category;
      result = addItem(current, { category, key: action.key, text: action.text, project: action.project, days: action.days, source: action.source, confidence: action.confidence, supersedes: action.supersedes }, now);
      if (result.changed) applied.push(`Recordé: ${result.label}`);
      if (result.blocked) skipped += 1;
      if (result.conflict) {
        conflicts.push(result.conflict);
        applied.push(`Sin cambiar «${result.conflict.key}»: sigue «${result.conflict.kept}» (en la conversación parecía «${result.conflict.proposed}»; dime si cambió)`);
      }
    } else if (action?.type === 'memory_project') {
      result = upsertProject(current, { ...(action.project || {}), source: action.source ?? action.project?.source, confidence: action.confidence ?? action.project?.confidence }, now);
      if (result.changed) applied.push(result.label);
      if (result.blocked) skipped += 1;
    } else if (action?.type === 'memory_forget' && Array.isArray(action.ids)) {
      const out = removeItems(current, action.ids);
      result = { memory: out.memory, changed: out.removed > 0 };
      if (out.removed) applied.push(`Olvidé ${out.removed} ${out.removed === 1 ? 'recuerdo' : 'recuerdos'}`);
    }
    if (result?.changed) current = result.memory;
  }
  return { memory: current, applied, skipped, conflicts };
}

// ---- Readable forms ----

export function describeProject(p) {
  const parts = [p.name];
  // Right after the name so the 220-character cut in memoryForContext never drops it.
  if (p.repo) parts.push(`repo: ${p.repo}`);
  if (p.status) parts.push(`estado: ${p.status}`);
  if (p.stack) parts.push(`stack: ${p.stack}`);
  if (p.lastChange) parts.push(`último cambio: ${p.lastChange}`);
  if (p.nextGoal) parts.push(`próximo objetivo: ${p.nextGoal}`);
  return parts.join(' · ');
}

export function describeItem(category, item) {
  if (category === 'projects') return describeProject(item);
  if (category === 'profile' || category === 'preferences') return `${item.key}: ${item.text}`;
  if (category === 'decisions' && item.project) return `${item.text} (${item.project})`;
  return item.text;
}

const SOURCE_LABEL = { chat: 'dicho a Eddie', conversacion: 'de una conversación', documento: 'de un documento', manual: 'escrito por ti' };

// «de una conversación · sin confirmar · antes: Santiago»: where an item came from, how sure it is and what it
// said before, for the Memoria panel. Empty for the items saved before this was tracked.
export function provenanceLabel(item) {
  const parts = [];
  if (SOURCE_LABEL[item?.source]) parts.push(SOURCE_LABEL[item.source]);
  if (item?.confidence === 'inferido') parts.push('sin confirmar');
  if (item?.status === 'revocada') parts.push('revocada');
  if (item?.history?.length) parts.push(`antes: ${item.history[0].text}`);
  return parts.join(' · ');
}

// Marks that change how much to trust a memory, for the model: a guess, or a decision since replaced.
const flagsOf = (item) => `${item.confidence === 'inferido' ? ' (sin confirmar)' : ''}${item.status === 'revocada' ? ' [revocada]' : ''}`;

// A flat, size-capped list for the chat request's `context`, so the server's
// memory tools (recall, forget) can search what the user has saved.
const CONTEXT_ITEMS = 80;
export function memoryForContext(memory, now = Date.now()) {
  const live = pruneExpired(memory, now);
  const items = [];
  for (const { id: category } of CATEGORIES) {
    for (const item of live[category]) items.push({ id: item.id, c: category, t: describeItem(category, item).slice(0, 220), ...(flagsOf(item) ? { f: flagsOf(item).trim() } : {}) });
  }
  return items.slice(0, CONTEXT_ITEMS);
}

// ---- The part of memory that goes into the system prompt ----

// Words that say nothing about the topic (they would "match" half of the memory).
const STOP = new Set([
  'para', 'como', 'cual', 'cuales', 'cuanto', 'cuanta', 'cuantos', 'cuantas', 'donde', 'cuando', 'quien', 'tiene', 'tienen', 'tengo', 'sobre', 'entre', 'desde', 'hasta',
  'esta', 'este', 'esto', 'estos', 'estas', 'esos', 'esas', 'ese', 'esa', 'pero', 'porque', 'puedo', 'puede', 'puedes', 'dime', 'dame', 'hazme', 'quiero', 'quieres', 'algo',
  'todo', 'toda', 'todos', 'todas', 'mucho', 'muchos', 'poco', 'tambien', 'ademas', 'ahora', 'hace', 'hacer', 'haces', 'sabes', 'saber', 'hola', 'gracias', 'favor', 'cosa', 'cosas',
]);

// Comparing by a short stem makes "invito" / "invitar" / "invitación" and
// "cafetera" / "cafeteras" meet; plain whole-word matching missed them.
const stem = (w) => (w.length >= 6 ? w.slice(0, 5) : w.replace(/s$/, ''));
const words = (text) => normalizeText(text).split(' ').filter((w) => w.length > 3 && !STOP.has(w)).map(stem);

function overlap(queryWords, text) {
  if (!queryWords.size) return 0;
  const seen = new Set();
  for (const w of words(text)) if (queryWords.has(w)) seen.add(w);
  return seen.size;
}

const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

// Only what helps with *this* message, within a character budget: profile and
// preferences always (they're short and shape every answer), projects when
// mentioned (or the most recent ones), decisions and knowledge when they
// share words with the message, and temporary context while it's still valid.
// Lines are added in that priority order until the budget runs out.
export function formatMemoryForPrompt(memory, query = '', { budget = 1600, now = Date.now() } = {}) {
  const live = pruneExpired(normalizeMemory(memory, now), now);
  if (isEmptyMemory(live)) return '';
  const q = new Set(words(query));
  const sections = [];

  const keyed = (title, list) => {
    if (list.length) sections.push({ title, lines: list.slice(-12).map((i) => `${i.key}: ${i.text}${flagsOf(i)}`) });
  };
  keyed('Perfil', live.profile);
  keyed('Preferencias', live.preferences);

  if (live.projects.length) {
    const mentioned = live.projects.filter((p) => overlap(q, `${p.name} ${p.stack}`) > 0);
    const recent = [...live.projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    const chosen = mentioned.length ? mentioned : recent;
    sections.push({ title: 'Proyectos', lines: chosen.map(describeProject) });
  }

  // The same fact kept twice (a document dropped two times) takes room once.
  const gist = (item) => normalizeText(item.text).slice(0, 48);
  const relevant = (list, limit, fmt) => {
    const seenGist = new Set();
    return list
      .map((item) => ({ item, score: overlap(q, `${item.text} ${item.project || ''}`) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.item.date - a.item.date)
      .filter(({ item }) => !seenGist.has(gist(item)) && seenGist.add(gist(item)))
      .slice(0, limit)
      .map((s) => fmt(s.item));
  };
  // Decisions carry their date, so Eddie can say "me dijiste el 12 de sep que…" when they weigh on a request.
  // (A decision since replaced is history, not guidance: it does not go to the model.)
  const decisions = relevant(live.decisions.filter((d) => d.status !== 'revocada'), 6, (d) => `${d.text}${d.project ? ` (${d.project})` : ''}${d.date ? ` — ${fmtDate(d.date)}` : ''}${flagsOf(d)}`);
  if (decisions.length) sections.push({ title: 'Decisiones relacionadas', lines: decisions });
  const knowledge = relevant(live.knowledge, 6, (k) => `${k.text}${flagsOf(k)}`);
  if (knowledge.length) sections.push({ title: 'Conocimientos relacionados', lines: knowledge });

  if (live.context.length) {
    sections.push({ title: 'Contexto temporal vigente', lines: live.context.slice(-6).map((c) => `${c.text} (hasta ${fmtDate(c.expiresAt)})`) });
  }

  const out = [];
  let used = 0;
  let shown = 0;
  for (const { title, lines } of sections) {
    const kept = [];
    for (const line of lines) {
      const cost = line.length + 4;
      if (used + cost > budget) break;
      kept.push(`- ${line}`);
      used += cost;
    }
    shown += kept.length;
    if (kept.length) out.push(`${title}:\n${kept.join('\n')}`);
  }
  // What did not come along is said, so Eddie knows there is more and can ask for it (the `recall` tool) instead of
  // answering as if this were all he knew. Decisions since replaced are history, not memories left out.
  const stored = countItems(live) - live.decisions.filter((d) => d.status === 'revocada').length;
  const left = stored - shown;
  if (shown && left >= MORE_MIN) out.push(`(Tienes ${left} recuerdos más guardados que no vienen al caso en este mensaje; si preguntan por algo que no ves aquí, búscalo con la herramienta recall antes de decir que no lo sabes.)`);
  return out.join('\n');
}

// Fewer than this left out is not worth a line.
const MORE_MIN = 3;
