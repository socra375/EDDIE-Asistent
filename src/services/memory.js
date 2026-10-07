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

export const MEMORY_VERSION = 2;

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
      if (key && text) out.push({ id, key, text, updatedAt: isTime(item.updatedAt) ? item.updatedAt : now });
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
      });
    } else {
      const text = clean(item.text, TEXT_MAX);
      if (!text) continue;
      const entry = { id, text, date: isTime(item.date) ? item.date : now };
      if (category === 'decisions') entry.project = clean(item.project, KEY_MAX);
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

// Adds one fact. Profile and preferences are keyed ("nombre"): saying it again
// replaces the old value. The rest skip an exact repeat. Returns
// { memory, changed, label } — `label` is the one-liner the chat shows.
export function addItem(memory, { category, key, text, project, days }, now = Date.now()) {
  const value = clean(text, TEXT_MAX);
  if (!value) return { memory, changed: false, label: '' };

  if (category === 'profile' || category === 'preferences') {
    const k = clean(key, KEY_MAX);
    if (!k) return { memory, changed: false, label: '' };
    const list = memory[category];
    const existing = list.find((i) => normalizeText(i.key) === normalizeText(k));
    if (existing && existing.text === value) return { memory, changed: false, label: '' };
    const next = existing
      ? list.map((i) => (i.id === existing.id ? { ...i, text: value, updatedAt: now } : i))
      : [...list, { id: memoryId(), key: k, text: value, updatedAt: now }];
    return { memory: withList(memory, category, next), changed: true, label: `${k}: ${value}` };
  }

  if (category === 'decisions' || category === 'knowledge' || category === 'context') {
    const list = memory[category];
    if (list.some((i) => normalizeText(i.text) === normalizeText(value))) return { memory, changed: false, label: '' };
    const entry = { id: memoryId(), text: value, date: now };
    if (category === 'decisions') entry.project = clean(project, KEY_MAX);
    if (category === 'context') {
      const d = Math.min(Math.max(Math.round(Number(days)) || DEFAULT_CONTEXT_DAYS, 1), MAX_CONTEXT_DAYS);
      entry.expiresAt = now + d * DAY_MS;
    }
    return { memory: withList(memory, category, [...list, entry]), changed: true, label: value };
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
  const existing = memory.projects.find((p) => normalizeText(p.name) === normalizeText(name));
  if (existing) {
    const same = Object.entries(patch).every(([k, v]) => existing[k] === v);
    if (same) return { memory, changed: false, label: '' };
    const next = memory.projects.map((p) => (p.id === existing.id ? { ...p, ...patch, updatedAt: now } : p));
    return { memory: withList(memory, 'projects', next), changed: true, label: `Proyecto ${existing.name} actualizado` };
  }
  const project = { id: memoryId(), name, status: '', stack: '', repo: '', lastChange: '', nextGoal: '', ...patch, updatedAt: now };
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
    const seen = new Set();
    const merged = [];
    for (const item of [...left[category], ...right[category]].sort((x, y) => x.date - y.date)) {
      const k = normalizeText(item.text);
      if (seen.has(k)) continue;
      seen.add(k);
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
  for (const action of Array.isArray(actions) ? actions : []) {
    let result = null;
    if (action?.type === 'memory_add') {
      const category = CATEGORY_OF[action.category] || action.category;
      result = addItem(current, { category, key: action.key, text: action.text, project: action.project, days: action.days }, now);
      if (result.changed) applied.push(`Recordé: ${result.label}`);
    } else if (action?.type === 'memory_project') {
      result = upsertProject(current, action.project || {}, now);
      if (result.changed) applied.push(result.label);
    } else if (action?.type === 'memory_forget' && Array.isArray(action.ids)) {
      const out = removeItems(current, action.ids);
      result = { memory: out.memory, changed: out.removed > 0 };
      if (out.removed) applied.push(`Olvidé ${out.removed} ${out.removed === 1 ? 'recuerdo' : 'recuerdos'}`);
    }
    if (result?.changed) current = result.memory;
  }
  return { memory: current, applied };
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

// A flat, size-capped list for the chat request's `context`, so the server's
// memory tools (recall, forget) can search what the user has saved.
const CONTEXT_ITEMS = 80;
export function memoryForContext(memory, now = Date.now()) {
  const live = pruneExpired(memory, now);
  const items = [];
  for (const { id: category } of CATEGORIES) {
    for (const item of live[category]) items.push({ id: item.id, c: category, t: describeItem(category, item).slice(0, 220) });
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
    if (list.length) sections.push({ title, lines: list.slice(-12).map((i) => `${i.key}: ${i.text}`) });
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
  const decisions = relevant(live.decisions, 6, (d) => `${d.text}${d.project ? ` (${d.project})` : ''}${d.date ? ` — ${fmtDate(d.date)}` : ''}`);
  if (decisions.length) sections.push({ title: 'Decisiones relacionadas', lines: decisions });
  const knowledge = relevant(live.knowledge, 6, (k) => k.text);
  if (knowledge.length) sections.push({ title: 'Conocimientos relacionados', lines: knowledge });

  if (live.context.length) {
    sections.push({ title: 'Contexto temporal vigente', lines: live.context.slice(-6).map((c) => `${c.text} (hasta ${fmtDate(c.expiresAt)})`) });
  }

  const out = [];
  let used = 0;
  for (const { title, lines } of sections) {
    const kept = [];
    for (const line of lines) {
      const cost = line.length + 4;
      if (used + cost > budget) break;
      kept.push(`- ${line}`);
      used += cost;
    }
    if (kept.length) out.push(`${title}:\n${kept.join('\n')}`);
  }
  return out.join('\n');
}
