// How Eddie sorts what he reads (a document dropped on a brain, a finished
// conversation): every piece of information gets ONE kind, and the kind decides
// where it lives. Pure functions, shared by the server (api/_lib/brain/) and the app.
//
//   dato          personal, stable fact about the user        → Memoria · Perfil
//   preferencia   how they like things done                    → Memoria · Preferencias
//   proyecto      something they work on                       → Memoria · Proyectos
//   decision      something decided, and why                   → Memoria · Decisiones
//   conocimiento  stable fact about a topic (not the user)     → Memoria · Conocimientos
//   contexto      temporary ("viaja el sábado")                → Memoria · Contexto temporal
//   habilidad     something to know how to do (a skill)        → Segundo cerebro (tema de tipo «habilidad»)
import { cleanCategory } from './knowledgeCategories.js';
import { looksSecret } from './secrets.js';

export const ITEM_KINDS = [
  { id: 'dato', label: 'Dato personal', plural: 'datos personales' },
  { id: 'preferencia', label: 'Preferencia', plural: 'preferencias' },
  { id: 'habilidad', label: 'Habilidad', plural: 'habilidades' },
  { id: 'proyecto', label: 'Proyecto', plural: 'proyectos' },
  { id: 'decision', label: 'Decisión', plural: 'decisiones' },
  { id: 'conocimiento', label: 'Conocimiento', plural: 'conocimientos' },
  { id: 'contexto', label: 'Contexto temporal', plural: 'datos temporales' },
];

const KIND_IDS = new Set(ITEM_KINDS.map((k) => k.id));
const TEXT_MAX = 300;
const KEY_MAX = 60;
const TITLE_MAX = 80;
const FIELD_MAX = 160;

const tidy = (value, max) =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const clipAt = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

// What may be kept from the model's list: known kinds, capped lengths, the
// fields each kind needs, no repeats. Anything else is dropped.
// `defaultConfidence`: what an item counts as when the AI does not say — «inferido» for a conversation (a deduction
// until the user confirms it), «confirmado» for a document the user handed over. Anything that talks about a secret
// or holds one is dropped here, whatever the AI was told.
export function cleanItems(raw, { max = 30, defaultConfidence = 'inferido' } = {}) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object' || !KIND_IDS.has(item.kind)) continue;
    const text = tidy(item.text, TEXT_MAX);
    const clean = { kind: item.kind, confidence: item.confidence === 'confirmado' || item.confidence === 'inferido' ? item.confidence : defaultConfidence };
    if (item.kind === 'proyecto') {
      clean.name = tidy(item.name || item.title, KEY_MAX);
      if (!clean.name) continue;
      for (const f of ['status', 'stack', 'nextGoal', 'lastChange']) if (item[f]) clean[f] = tidy(item[f], FIELD_MAX);
      if (text) clean.text = text;
    } else {
      if (text.length < 4) continue;
      clean.text = text;
      if (item.kind === 'dato' || item.kind === 'preferencia') clean.key = tidy(item.key, KEY_MAX) || clipAt(text, 40);
      if (item.kind === 'habilidad') {
        clean.title = tidy(item.title || item.key, TITLE_MAX) || clipAt(text, 60);
        clean.category = cleanCategory(item.category);
      }
      if (item.kind === 'decision' && item.project) clean.project = tidy(item.project, KEY_MAX);
      if (item.kind === 'contexto') clean.days = Math.min(Math.max(Math.round(Number(item.days)) || 7, 1), 60);
    }
    if (looksSecret([clean.text, clean.key, clean.name, clean.title, clean.project, clean.status, clean.stack, clean.nextGoal, clean.lastChange].filter(Boolean).join(' '))) continue;
    const fingerprint = `${item.kind}|${(clean.name || clean.key || clean.title || '').toLowerCase()}|${(clean.text || '').slice(0, 50).toLowerCase()}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(clean);
    if (out.length >= max) break;
  }
  return out;
}

// → { actions, skills, counts }: the memory actions (the very ones Eddie's
// memory tools emit, so every surface applies them the same way), the skills
// for the second brain and how many of each kind there were. With
// `skillsToMemory` (a document dropped on Memoria) the skills are also kept as
// memory knowledge, since nothing is sent to the second brain.
// `source` says where the items came from ('conversacion' | 'documento') and travels with each action, with the
// item's `confidence`, so the memory can show it.
export function itemsToActions(items, { skillsToMemory = false, source } = {}) {
  const actions = [];
  const skills = [];
  const counts = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    const from = { ...(source ? { source } : {}), ...(item.confidence ? { confidence: item.confidence } : {}) };
    if (item.kind === 'dato') actions.push({ type: 'memory_add', category: 'profile', key: item.key, text: item.text, ...from });
    else if (item.kind === 'preferencia') actions.push({ type: 'memory_add', category: 'preferences', key: item.key, text: item.text, ...from });
    else if (item.kind === 'proyecto') {
      const { name, status, stack, nextGoal, lastChange } = item;
      actions.push({ type: 'memory_project', project: { name, ...(status ? { status } : {}), ...(stack ? { stack } : {}), ...(nextGoal ? { nextGoal } : {}), ...(lastChange ? { lastChange } : {}) }, ...from });
    } else if (item.kind === 'decision') actions.push({ type: 'memory_add', category: 'decisions', text: item.text, ...(item.project ? { project: item.project } : {}), ...from });
    else if (item.kind === 'conocimiento') actions.push({ type: 'memory_add', category: 'knowledge', text: item.text, ...from });
    else if (item.kind === 'contexto') actions.push({ type: 'memory_add', category: 'context', text: item.text, days: item.days, ...from });
    else if (item.kind === 'habilidad') {
      skills.push({ title: item.title, text: item.text, category: item.category });
      if (skillsToMemory) actions.push({ type: 'memory_add', category: 'knowledge', text: clipAt(`Habilidad · ${item.title}: ${item.text}`, TEXT_MAX), ...from });
    }
  }
  return { actions, skills, counts };
}

// "3 datos personales, 1 proyecto y 2 habilidades"
export function countsLabel(counts) {
  const parts = ITEM_KINDS.filter((k) => counts?.[k.id]).map((k) => `${counts[k.id]} ${counts[k.id] === 1 ? k.label.toLowerCase() : k.plural}`);
  if (parts.length <= 1) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
}
