// The notes sheets, kept on this device (localStorage, always inside try/catch:
// it can be blocked or full). Pure list helpers + storage.
import { DEFAULT_MINUTES, MAX_NOTE_CHARS, cleanMinutes } from './dictation.js';

const NOTES_KEY = 'eddie.notes';
const PREFS_KEY = 'eddie.notes.prefs';
export const MAX_NOTES = 200;

let counter = 0;
export function newNote(now = Date.now()) {
  counter += 1;
  return { id: `n${now.toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`, title: '', body: '', createdAt: now, updatedAt: now };
}

// The title shown in the list: the one typed, or the first line of the sheet.
export function noteTitle(note) {
  const own = String(note?.title || '').trim();
  if (own) return own;
  const first = String(note?.body || '').split('\n').find((l) => l.trim());
  return first ? first.trim().slice(0, 60) : 'Hoja en blanco';
}

export function cleanNotes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n) => n && typeof n.id === 'string')
    .slice(0, MAX_NOTES)
    .map((n) => ({
      id: n.id.slice(0, 40),
      title: String(n.title || '').slice(0, 120),
      body: String(n.body || '').slice(0, MAX_NOTE_CHARS),
      createdAt: Number(n.createdAt) || Date.now(),
      updatedAt: Number(n.updatedAt) || Date.now(),
    }));
}

// Newest first; at most MAX_NOTES (the oldest empty sheets go first).
export function trimNotes(notes) {
  if (notes.length <= MAX_NOTES) return notes;
  const kept = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
  const empty = kept.filter((n) => !n.body.trim()).slice(-(notes.length - MAX_NOTES));
  return kept.filter((n) => !empty.includes(n)).slice(0, MAX_NOTES);
}

export function loadNotes() {
  try {
    return cleanNotes(JSON.parse(localStorage.getItem(NOTES_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function saveNotes(notes) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    return true;
  } catch {
    return false;
  }
}

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { minutes: cleanMinutes(raw.minutes, DEFAULT_MINUTES), punctuation: raw.punctuation !== false };
  } catch {
    return { minutes: DEFAULT_MINUTES, punctuation: true };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ minutes: cleanMinutes(prefs.minutes), punctuation: prefs.punctuation !== false }));
  } catch {
    /* blocked storage: the choice just won't be remembered */
  }
}
