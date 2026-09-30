// The wake word: Eddie starts listening when the user says it ("Eddie",
// "oye Eddie, ¿qué tengo hoy?"). Pure helpers, no browser APIs, so they can
// be tested on their own; the listening loop is in hooks/useWakeWordListener.

export const DEFAULT_WAKE_WORD = 'eddie';
export const MIN_WAKE_LETTERS = 3;
export const MAX_WAKE_LENGTH = 30;

// After Eddie answers, the microphone stays open this many seconds for the
// user to keep talking without repeating the wake word (0 = off).
export const DEFAULT_FOLLOW_UP_SECONDS = 5;
export const MAX_FOLLOW_UP_SECONDS = 30;

export function cleanFollowUpSeconds(value, fallback = DEFAULT_FOLLOW_UP_SECONDS) {
  const n = Math.round(Number(value));
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 0), MAX_FOLLOW_UP_SECONDS);
}

// What a recognizer commonly writes when it hears the default word.
const DEFAULT_ALIASES = ['eddie', 'eddy', 'edie', 'edi', 'edy', 'hedi'];
// Said before the word without changing its meaning ("oye Eddie").
const FILLERS = ['hey', 'oye', 'ey', 'hola', 'ok', 'okay', 'okey'];

// Accents and case ignored, one character at a time so the positions still
// line up with the original text (the rest of the sentence is cut from it).
function fold(text) {
  return Array.from(String(text || ''))
    .map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
    .join('');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The word as the user typed it, made safe: trimmed, single spaces, letters,
// numbers and spaces only. Returns '' when it can't work as a wake word.
export function cleanWakeWord(input) {
  const word = String(input || '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_WAKE_LENGTH);
  return (word.match(/\p{L}/gu) || []).length >= MIN_WAKE_LETTERS ? word : '';
}

export function wakePhrases(word) {
  const folded = fold(cleanWakeWord(word) || DEFAULT_WAKE_WORD).trim();
  return folded === DEFAULT_WAKE_WORD ? DEFAULT_ALIASES : [folded];
}

// Looks for the wake word at the start of what was heard (after at most one
// filler like "oye"), so talking *about* Eddie doesn't wake it. Returns
// { found, rest }: `rest` is what came after the word, from the original text
// ("Eddie, ¿qué hora es?" -> "¿qué hora es?"), empty when only the word was said.
export function findWakeWord(text, word) {
  const original = String(text || '');
  const folded = fold(original);
  const phrases = wakePhrases(word).map((p) => escapeRe(p).replace(/ /g, '\\s+'));
  const re = new RegExp(`^[^a-z0-9ñ]*(?:(?:${FILLERS.join('|')})[^a-z0-9ñ]+)?(?:${phrases.join('|')})(?![a-z0-9ñ])`);
  const match = re.exec(folded);
  if (!match) return { found: false, rest: '' };
  const rest = original.slice(match[0].length).replace(/^[\s,.:;…-]+/, '').trim();
  return { found: true, rest };
}

// "Eddie, suspéndete" / "apágate": the spoken off switch for the microphone
// (the wake word listener). Only a whole message counts — "apágate la luz" or
// a sentence that merely contains the word does nothing — and the wake word
// (or "eddie") may come before it, "por favor" / "ya" after it.
const SLEEP_COMMANDS = new Set([
  'suspendete',
  'suspende',
  'suspension',
  'modo suspension',
  'apagate',
  'desactivate',
  'duermete',
  'a dormir',
  've a dormir',
  'descansa',
  'descansate',
  'ya no me escuches',
  'no me escuches mas',
  'deja de escucharme',
  'deja de escuchar',
]);
const MIC_OFF = /^(apaga|apagar|desactiva|desactivar|silencia|silenciar|cierra|cerrar) (el |tu |mi )?(microfono|mic|escucha)$/;

export function isSleepCommand(text, word = DEFAULT_WAKE_WORD) {
  let t = fold(text)
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  const names = [...new Set([...wakePhrases(word), ...wakePhrases(DEFAULT_WAKE_WORD)])].map((p) => escapeRe(p).replace(/ /g, '\\s+'));
  const name = `(?:${names.join('|')})`;
  t = t
    .replace(new RegExp(`^(?:(?:${FILLERS.join('|')}) )?(?:${name} )?`), '')
    .replace(new RegExp(`(?: ${name})?(?: (?:por favor|ya|ahora|gracias))*$`), '')
    .trim();
  return SLEEP_COMMANDS.has(t) || MIC_OFF.test(t);
}
