// Pure helpers for Notas (no browser APIs, so they run in Node tests):
// - applyDictation: puts what the recognizer heard on the sheet, with the
//   punctuation said aloud ("coma", "punto y aparte", "nueva línea"…) turned
//   into signs and the first letter of each sentence capitalized;
// - extractStop: the spoken "fin de la nota" that ends the dictation;
// - parseDuration: "10 minutos", "media hora", "una hora y media"…;
// - formatMinutes / formatClock: how durations and countdowns are shown.

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 180;
export const DEFAULT_MINUTES = 10;
export const DURATION_CHOICES = [5, 10, 15, 30, 60];
export const MAX_NOTE_CHARS = 50_000;

export function cleanMinutes(value, fallback = DEFAULT_MINUTES) {
  const n = Math.round(Number(value));
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, MIN_MINUTES), MAX_MINUTES);
}

export function formatMinutes(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} ${m === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = `${h} ${h === 1 ? 'hora' : 'horas'}`;
  if (!rest) return hours;
  if (rest === 30 && h === 1) return 'hora y media';
  return `${hours} y ${rest} ${rest === 1 ? 'minuto' : 'minutos'}`;
}

// 754 -> "12:34", 3725 -> "1:02:05"
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function countWords(text) {
  return (String(text || '').match(/\S+/g) || []).length;
}

// ---- Spoken punctuation ------------------------------------------------

const P = (words) => new RegExp(`(?<!\\p{L})(?:${words})(?!\\p{L})`, 'giu');

// Longest phrases first, so "punto y coma" is not read as "punto" + "coma".
const SPOKEN = [
  [P('punto\\s+y\\s+aparte'), '.\n'],
  [P('punto\\s+y\\s+seguido'), '.'],
  [P('nuevo\\s+p[aá]rrafo'), '\n\n'],
  [P('(?:nueva\\s+l[ií]nea|salto\\s+de\\s+l[ií]nea|otra\\s+l[ií]nea)'), '\n'],
  [P('punto\\s+y\\s+coma'), ';'],
  [P('dos\\s+puntos'), ':'],
  [P('puntos\\s+suspensivos'), '…'],
  [P('abre\\s+(?:signo\\s+de\\s+)?interrogaci[oó]n|abrir\\s+interrogaci[oó]n'), '¿'],
  [P('cierra\\s+(?:signo\\s+de\\s+)?interrogaci[oó]n|cerrar\\s+interrogaci[oó]n|signo\\s+de\\s+interrogaci[oó]n'), '?'],
  [P('abre\\s+(?:signo\\s+de\\s+)?exclamaci[oó]n|abrir\\s+exclamaci[oó]n'), '¡'],
  [P('cierra\\s+(?:signo\\s+de\\s+)?exclamaci[oó]n|cerrar\\s+exclamaci[oó]n|signo\\s+de\\s+exclamaci[oó]n'), '!'],
  [P('abre\\s+par[eé]ntesis|abrir\\s+par[eé]ntesis'), '('],
  [P('cierra\\s+par[eé]ntesis|cerrar\\s+par[eé]ntesis'), ')'],
  [P('coma'), ','],
  [P('punto'), '.'],
];

const CLOSERS = '.,;:?!…)';
const OPENERS = '¿¡(';

// The text said, with punctuation words replaced and spacing around the signs fixed.
export function speakPunctuation(chunk) {
  let t = String(chunk || '');
  for (const [re, sign] of SPOKEN) t = t.replace(re, ` ${sign} `);
  return t
    .replace(/[ \t]+/g, ' ')
    .replace(new RegExp(`\\s+([${CLOSERS}])`, 'g'), '$1')
    .replace(new RegExp(`([${OPENERS}])\\s+`, 'g'), '$1')
    .replace(/([,;:])(?=[^\s\n])/g, '$1 ')
    .replace(/ *\n */g, '\n');
}

const upperFirst = (s) => s.replace(/^([¿¡(]*)(\p{L})/u, (_, lead, letter) => lead + letter.toUpperCase());

// Capital letters after . ? ! … and after a line break.
function capitalizeSentences(piece) {
  return piece.replace(/([.?!…] |\n)([¿¡(]*)(\p{Ll})/gu, (_, sep, lead, letter) => sep + lead + letter.toUpperCase());
}

// Adds what was heard to the end of `text`; returns the new text.
export function applyDictation(text, chunk, { punctuation = true } = {}) {
  const base = String(text || '');
  let piece = punctuation ? speakPunctuation(chunk) : String(chunk || '').replace(/[ \t]+/g, ' ');
  piece = piece.replace(/^[ \t]+|[ \t]+$/g, '');
  if (!piece) return base;

  // Only line breaks ("nueva línea"): they go straight after the text.
  if (/^\n+$/.test(piece)) return base.replace(/[ \t]+$/, '') + piece;

  const startsSentence = !base.trim() || /[.?!…]\s*$/.test(base) || /\n\s*$/.test(base);
  piece = capitalizeSentences(piece);
  if (startsSentence) piece = upperFirst(piece);

  if (!base) return piece;
  const lastChar = base.at(-1);
  const glued = /^\n/.test(piece) || CLOSERS.includes(piece[0]) || /\s/.test(lastChar) || OPENERS.includes(lastChar);
  return base + (glued ? '' : ' ') + piece;
}

// ---- "Fin de la nota" ---------------------------------------------------

function fold(text) {
  return Array.from(String(text || ''))
    .map((c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())
    .join('');
}

const STOP_RE =
  /(?:^|[^a-z0-9ñ])(?:eddie[ ,]+)?(?:fin de(?:l)? (?:la |el )?(?:nota|dictado|notas)|(?:termina|terminar|finaliza|finalizar|deten|detener|cierra|cerrar|para|parar) (?:la |el |de tomar )?(?:nota|notas|dictado)|deja de tomar notas?|ya no tomes notas?)[ .,!]*$/;

// If the chunk ends with the stop phrase, returns the text before it.
// → { stop: boolean, text: string }
export function extractStop(chunk) {
  const original = String(chunk || '');
  const match = STOP_RE.exec(fold(original));
  if (!match) return { stop: false, text: original };
  // The phrase may be preceded by one separator character; keep the text before it.
  const start = match.index + (/^[^a-z0-9ñ]/.test(match[0]) ? 1 : 0);
  return { stop: true, text: Array.from(original).slice(0, start).join('').replace(/[\s,.;:]+$/, '') };
}

// ---- Durations ----------------------------------------------------------

const UNITS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
  doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29, medio: 0.5, media: 0.5,
};
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

function wordNumber(words) {
  const w = words.trim();
  if (w in UNITS) return UNITS[w];
  if (w in TENS) return TENS[w];
  const m = /^([a-z]+) y ([a-z]+)$/.exec(w);
  if (m && m[1] in TENS && m[2] in UNITS && Number.isInteger(UNITS[m[2]]) && UNITS[m[2]] < 10) return TENS[m[1]] + UNITS[m[2]];
  return null;
}

const SPAN = /(\d{1,3}(?:[.,]\d)?|[a-z]+(?: y [a-z]+)?) ?(horas?|hrs?|h|minutos?|mins?|min)(?![a-z])/g;
const FILLER = /(?<![a-z])(?:y|de|con|durante|por|un|una|el|la|tiempo|espacio|duracion|que|dure|duren|aprox|aproximadamente|unos|unas|como|en)(?![a-z])/g;

// Minutes in a phrase like "10 minutos", "media hora", "una hora y media",
// "hora y quince minutos", "cuarto de hora"; null when there is none (or
// when it holds anything else). Not clamped.
export function parseDuration(text) {
  let t = fold(text).replace(/[^a-z0-9ñ., ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let minutes = 0;
  let found = false;

  const swallow = (re, fn) => {
    t = t.replace(re, (...m) => {
      minutes += fn(m);
      found = true;
      return ' ';
    });
  };
  swallow(/(?<![a-z])tres cuartos de hora(?![a-z])/g, () => 45);
  swallow(/(?<![a-z])(?:un )?cuarto de hora(?![a-z])/g, () => 15);
  swallow(/(?<![a-z])(\d{1,2}|[a-z]+)? ?horas? y media(?![a-z])/g, (m) => (m[1] ? (wordNumber(m[1]) ?? (Number(m[1]) || 1)) : 1) * 60 + 30);
  swallow(/(?<![a-z])media hora(?![a-z])/g, () => 30);

  t = t.replace(SPAN, (all, num, unit) => {
    const value = /^\d/.test(num) ? Number(num.replace(',', '.')) : wordNumber(num);
    if (value === null || Number.isNaN(value)) return all;
    minutes += /^h/.test(unit) ? value * 60 : value;
    found = true;
    return ' ';
  });

  if (!found || t.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()) return null;
  return Math.round(minutes);
}
