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
  if (!voice.localService) score += 5;
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

// Markdown symbols, code and links read aloud sound like noise.
export function speakableText(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' (código omitido) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~>|#]+/g, '')
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
