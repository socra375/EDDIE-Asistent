// Taking the memory out and bringing it back: a file the user can keep (export / import), and the copy Eddie holds
// for a week after «Borrar toda la memoria», so a mistake can be undone. Pure functions over a `store` with
// getItem / setItem / removeItem (localStorage in the app, a fake in the tests); nothing here reaches the server.
import { countItems, isEmptyMemory, mergeMemory, normalizeMemory } from './memory.js';
import { looksSecret } from './secrets.js';

export const BACKUP_KEY = 'eddie.memory.backup';
export const BACKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// The file that comes in is the user's, but still bounded and checked like anything else.
export const MAX_IMPORT_CHARS = 400_000;
export const EXPORT_APP = 'eddie';
export const EXPORT_TYPE = 'memoria';

// ---- the copy kept after «borrar todo» ----

// Keeps `memory` for a week. False when there is nothing to keep or the store refuses.
export function saveBackup(store, memory, now = Date.now()) {
  if (!memory || isEmptyMemory(memory)) return false;
  try {
    store.setItem(BACKUP_KEY, JSON.stringify({ at: now, memory }));
    return true;
  } catch {
    return false;
  }
}

// { at, memory, count } while the copy is fresh; null (and the copy is dropped) when it expired or is damaged.
export function readBackup(store, now = Date.now()) {
  try {
    const raw = store.getItem(BACKUP_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved.at !== 'number' || now - saved.at > BACKUP_TTL_MS || now < saved.at) {
      store.removeItem(BACKUP_KEY);
      return null;
    }
    const memory = normalizeMemory(saved.memory, now);
    return isEmptyMemory(memory) ? null : { at: saved.at, memory, count: countItems(memory) };
  } catch {
    return null;
  }
}

export function dropBackup(store) {
  try {
    store.removeItem(BACKUP_KEY);
  } catch {
    // nothing to do
  }
}

// ---- the file ----

export function exportMemory(memory, now = Date.now()) {
  return JSON.stringify({ app: EXPORT_APP, type: EXPORT_TYPE, version: 1, exportedAt: new Date(now).toISOString(), memory: normalizeMemory(memory, now) }, null, 2);
}

export const exportFileName = (now = Date.now()) => `eddie-memoria-${new Date(now).toISOString().slice(0, 10)}.json`;

const SECRET_FIELDS = ['text', 'key', 'name', 'status', 'stack', 'repo', 'lastChange', 'nextGoal', 'project'];

// The same filter as every other door: a file cannot carry in what the chat would have refused.
function withoutSecrets(memory) {
  let removed = 0;
  const out = { ...memory };
  for (const key of Object.keys(memory)) {
    if (!Array.isArray(memory[key])) continue;
    out[key] = memory[key].filter((item) => {
      const bad = SECRET_FIELDS.some((f) => looksSecret(item[f])) || (item.history || []).some((h) => looksSecret(h.text));
      if (bad) removed += 1;
      return !bad;
    });
  }
  return { memory: out, removed };
}

// → { memory, count, removed } or { error }. Accepts the file Eddie exports, a bare memory object, and the old flat map.
export function parseMemoryExport(text, now = Date.now()) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { error: 'El archivo está vacío.' };
  if (raw.length > MAX_IMPORT_CHARS) return { error: 'El archivo es demasiado grande para ser una memoria de Eddie.' };
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'No es un archivo de memoria válido (no se puede leer como JSON).' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'No es un archivo de memoria de Eddie.' };
  const body = data.app === EXPORT_APP && data.type === EXPORT_TYPE ? data.memory : data.memory && typeof data.memory === 'object' ? data.memory : data;
  const { memory, removed } = withoutSecrets(normalizeMemory(body, now));
  const count = countItems(memory);
  if (!count) return { error: removed ? 'Todo lo que traía el archivo parecía contraseñas o claves, así que no importé nada.' : 'El archivo no trae ningún recuerdo.' };
  return { memory, count, removed };
}

// What importing does: adds to the memory (never replaces it), keeping the newer copy of a keyed fact.
// → { memory, added }
export function mergeImport(current, imported, now = Date.now()) {
  const memory = mergeMemory(current, imported, now);
  return { memory, added: Math.max(0, countItems(memory) - countItems(normalizeMemory(current, now))) };
}
