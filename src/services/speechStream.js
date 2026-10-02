// Reads an answer aloud while it is still being written. The answer arrives
// as ever-longer text ("Hola", "Hola, ¿qué tal?", …); this hands back the
// finished sentences as soon as they exist, in pieces ready to be spoken, so
// Eddie starts talking after the first sentence instead of after the last.
//
//   const streamer = createSentenceStreamer({ ... });
//   streamer.push(textSoFar)  → pieces newly ready (may be [])
//   streamer.end(finalText?)  → whatever is left, once the answer is complete
//
// A sentence counts as finished only when the punctuation is followed by a
// space or a new line, so "3." waiting for "5" is never cut, and nothing
// inside an unclosed ``` block, `code` or [link]( is spoken half-way.
import { speakableText, splitForSpeech } from './speechText.js';

const BOUNDARY = /[.!?;:](?=\s)|\n/g;

// How much of `raw` is safe to read: everything before the first construct
// that has not been closed yet.
export function safeLength(raw) {
  let limit = raw.length;
  const fences = [...raw.matchAll(/```/g)];
  if (fences.length % 2 === 1) limit = fences.at(-1).index;
  const text = raw.slice(0, limit);
  const noFences = text.replace(/```[\s\S]*?```/g, (m) => ' '.repeat(m.length));
  const ticks = [...noFences.matchAll(/`/g)];
  if (ticks.length % 2 === 1) limit = Math.min(limit, ticks.at(-1).index);
  const tail = noFences.slice(0, limit);
  // A [link](url) still being written: hold it back from its "[".
  const open = tail.lastIndexOf('[');
  if (open >= 0) {
    const after = tail.slice(open);
    if (!/^\[[^\]\n]*\]/.test(after) || /^\[[^\]\n]*\]\([^)\n]*$/.test(after)) limit = Math.min(limit, open);
  }
  return Math.max(0, limit);
}

// Index just after the last finished sentence in `text`, or 0.
function lastBoundary(text) {
  let cut = 0;
  for (const m of text.matchAll(BOUNDARY)) cut = m.index + m[0].length;
  return cut;
}

// A comma followed by a space after at least `at` characters, in the part that is safe to read.
function softEnd(raw, at) {
  const part = raw.slice(0, safeLength(raw));
  let cut = 0;
  for (const m of part.matchAll(/,(?=\s)/g)) {
    if (m.index + 1 >= at && cut === 0) cut = m.index + 1;
  }
  return cut;
}

// How much of `raw` is ready to read: up to the last finished sentence that
// does not end inside a block, `code` or link still being written (a line
// break inside a code block is not the end of a sentence).
function readyEnd(raw) {
  let part = raw.slice(0, safeLength(raw));
  for (;;) {
    const cut = lastBoundary(part);
    if (cut <= 0) return 0;
    const head = part.slice(0, cut);
    const safe = safeLength(head);
    if (safe === head.length) return cut;
    part = head.slice(0, safe);
  }
}

// firstMin/firstMax: the first piece goes out as soon as it has `firstMin`
// characters and is at most `firstMax` long. Later pieces wait until they
// have `min` characters (fewer, longer requests) and are cut at `max`.
// `ramp` are the minimums of the 2nd, 3rd… pieces: the first sound is short,
// so the next piece must be ready soon after it or there is a silence; each
// one can be a little longer than the last until `min` is reached.
// `softAt`: the first piece does not wait for the end of a long sentence: at a
// comma after this many characters it goes out.
export function createSentenceStreamer({ firstMin = 20, firstMax = 90, min = 80, max = 260, ramp = [], softAt = 0, lang = 'es' } = {}) {
  let consumed = 0; // characters of the raw text already taken
  let pending = ''; // speakable text waiting to be handed out
  let sent = 0; // pieces handed out so far
  let lastText = '';

  function pieces(text) {
    if (!text) return [];
    if (sent > 0) return splitForSpeech(text, max);
    const [first, ...rest] = splitForSpeech(text, firstMax);
    return first ? [first, ...splitForSpeech(rest.join(' '), max)] : [];
  }

  function release(out) {
    sent += out.length;
    pending = '';
    return out;
  }

  return {
    push(text) {
      lastText = typeof text === 'string' ? text : lastText;
      const raw = lastText.slice(consumed);
      let cut = readyEnd(raw);
      if (cut <= 0 && softAt > 0 && sent === 0 && !pending) cut = softEnd(raw, softAt);
      if (cut <= 0) return [];
      consumed += cut;
      const spoken = speakableText(raw.slice(0, cut), lang);
      if (spoken) pending = pending ? `${pending} ${spoken}` : spoken;
      const need = sent === 0 ? firstMin : (ramp[sent - 1] ?? min);
      return pending.length >= need ? release(pieces(pending)) : [];
    },
    end(finalText) {
      if (typeof finalText === 'string') lastText = finalText;
      const spoken = speakableText(lastText.slice(consumed), lang);
      consumed = lastText.length;
      const rest = [pending, spoken].filter(Boolean).join(' ');
      return release(pieces(rest));
    },
  };
}
