// Pure helpers for reading answers aloud (no browser or React imports, so
// they can be tested in Node): picking the most natural browser voice, turning
// Markdown into speakable text and cutting it into pieces.

// Chrome stops long utterances after ~15 s, so answers are read in pieces
// of whole sentences no longer than this.
export const MAX_CHUNK = 220;
// Server voices (ElevenLabs) take longer pieces (fewer requests); the first
// one stays short so Eddie starts talking sooner.
export const CLOUD_FIRST_CHUNK = 90;
export const CLOUD_CHUNK = 450;

// Higher is better. Network/neural voices sound far more natural than the
// local eSpeak-style ones Linux and ChromeOS ship by default.
function voiceScore(voice, lang) {
  let score = 0;
  const [base] = lang.toLowerCase().split('-');
  const vLang = (voice.lang || '').toLowerCase().replace('_', '-');
  if (vLang === lang.toLowerCase()) score += 33;
  else if (vLang.startsWith(`${base}-`) || vLang === base) score += 30;
  else return -1;
  if (/natural|neural|online|premium|enhanced/i.test(voice.name)) score += 25;
  if (/google/i.test(voice.name)) score += 20;
  if (/espeak|robot/i.test(voice.name)) score -= 20;
  if (!voice.localService) score += 10;
  // Latin American Spanish first for es-419/es-US users, Spain's otherwise.
  if (base === 'es' && /es-(us|mx|419)/.test(vLang)) score += 2;
  return score;
}

export function pickVoice(voices, lang, preferredURI) {
  if (preferredURI) {
    const chosen = voices.find((v) => v.voiceURI === preferredURI);
    if (chosen) return chosen;
  }
  let best = null;
  let bestScore = -1;
  for (const v of voices) {
    const s = voiceScore(v, lang);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

// Written symbols a voice would read badly (or not at all); Spanish only,
// since the spoken words are Spanish.
const SPOKEN_SYMBOLS = [
  [/\bE\.\s?D\.\s?D\.\s?I\.\s?E\.?/gi, 'Eddie'],
  [/\s*°\s*C\b/g, ' grados'],
  [/\s*º\s*C\b/g, ' grados'],
  [/\s*°/g, ' grados'],
  [/\s*%/g, ' por ciento'],
  [/\bkm\/h\b/gi, 'kilómetros por hora'],
  [/\bm\/s\b/gi, 'metros por segundo'],
  [/\s*&\s*/g, ' y '],
];

// Signs the voices turn into long silences: "…", "..." and dashes are read as
// a full stop (or longer), ";" as a hard stop. A comma is the pause a person makes.
const PAUSE_SIGNS = [
  [/\s*(?:…|\.{3,})\s*/g, ', '],
  [/\s+[-–—]+\s+|\s*[–—]+\s*/g, ', '],
  [/;\s*/g, ', '],
];

// Markdown symbols, emojis, code and links read aloud sound like noise.
export function speakableText(text, lang = 'es') {
  let out = String(text || '')
    .replace(/```[\s\S]*?```/g, ' (código omitido) ')
    // A line that goes on in lower case (no bullet, no number) is the same sentence wrapped: no pause.
    .replace(/([^.!?;:,\s])[ \t]*\n(?=\p{Ll})/gu, '$1 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]/gu, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    // "1. Lo primero…": the number of a list item isn't read out.
    .replace(/^\s*\d{1,2}[.)]\s+(?=\S)/gm, '');
  if (lang === 'es') for (const [pattern, spoken] of SPOKEN_SYMBOLS) out = out.replace(pattern, spoken);
  for (const [pattern, spoken] of PAUSE_SIGNS) out = out.replace(pattern, spoken);
  return out
    .replace(/[*_~>|#]+/g, '')
    // Any other line break without punctuation is still a pause when read aloud.
    .replace(/([^.!?;:,\s])[ \t]*\n+/g, '$1. ')
    // Commas that the replacements above may have doubled or left hanging.
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/\s+,/g, ',')
    .replace(/([.!?]),/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitForSpeech(text, max = MAX_CHUNK) {
  // Only punctuation followed by a space ends a sentence, so "3.5" or
  // "10:30" stay whole.
  const sentences = text.split(/(?<=[.!?;:])\s+|\n+/);
  const chunks = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((current + ' ' + s).trim().length <= max) {
      current = (current + ' ' + s).trim();
      continue;
    }
    if (current) chunks.push(current);
    if (s.length <= max) {
      current = s;
    } else {
      // A single huge sentence: cut on spaces.
      let rest = s;
      while (rest.length > max) {
        const cut = rest.lastIndexOf(' ', max) > 40 ? rest.lastIndexOf(' ', max) : max;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Server-voice pieces: a short first one, then longer ones.
export function splitForCloud(text) {
  const [first, ...rest] = splitForSpeech(text, CLOUD_FIRST_CHUNK);
  if (!first) return [];
  return [first, ...splitForSpeech(rest.join(' '), CLOUD_CHUNK)];
}

// What the "Habló con…" line in Configuración → Voz says: which engine read
// the last answer and, for the browser voice, why it did.
export function describeEngine(info) {
  if (!info?.engine) return '';
  if (info.engine === 'elevenlabs') return 'ElevenLabs (la voz propia de Eddie).';
  const reasons = {
    chosen: 'elegiste una voz del navegador; para usar ElevenLabs elige «ElevenLabs · …» en Voz de Eddie.',
    unconfigured: 'ElevenLabs no está configurado (falta ELEVENLABS_API_KEY en Vercel y volver a desplegar).',
    error: `ElevenLabs falló${info.detail ? `: ${info.detail}` : '.'}`,
    paused: 'ElevenLabs está en pausa unos minutos después de un error; se vuelve a intentar solo.',
    unsupported: 'este navegador no puede reproducir el audio de ElevenLabs.',
  };
  return `Navegador — ${reasons[info.reason] || reasons.chosen}`;
}

// Local voices (installed on the device) sound the most robotic.
export function onlyLocalVoices(voices, lang, preferredURI) {
  const best = pickVoice(voices, lang, preferredURI);
  return !best || best.localService !== false;
}
