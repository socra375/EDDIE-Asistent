// Searching a memory by plain words, for when the search by meaning cannot run (Gemini out of quota, slow or down).
// Shared by the notes of past conversations and by the second brain. One word in common is too weak (it drags in
// noise), so the automatic recall asks for WORDS_MIN_HITS distinct ones; an explicit question may settle for one.
export const WORDS_MIN_HITS = 2;

const WORD = /[\p{L}\p{N}]{4,}/gu;
const STOP = new Set(['sobre', 'acerca', 'aprendiste', 'aprendido', 'aprender', 'investigaste', 'sabes', 'cuales', 'cuáles', 'tiene', 'tienes', 'dime', 'dame', 'esto', 'esta', 'este', 'como', 'cómo', 'para', 'qué', 'que', 'con', 'una', 'los', 'las', 'del', 'por', 'hablamos', 'dijimos', 'dijiste', 'recuerdas', 'acuerdas']);

export const wordsOf = (text) => [...new Set((String(text).toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w)))];

// How many of the words appear in the text.
export const hitsIn = (words, text) => {
  const t = String(text).toLowerCase();
  return words.filter((w) => t.includes(w)).length;
};

// One case-insensitive regex for the database (a single plain-text parameter), or '' when nothing is searchable.
export const patternOf = (words) =>
  words
    .slice(0, 6)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 3)
    .join('|');
