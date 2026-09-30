import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Chrome stops long utterances after ~15 s, so answers are read in pieces
// of whole sentences no longer than this.
const MAX_CHUNK = 220;

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

export function splitForSpeech(text) {
  // Only punctuation followed by a space ends a sentence, so "3.5" or
  // "10:30" stay whole.
  const sentences = text.split(/(?<=[.!?;:])\s+|\n+/);
  const chunks = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if ((current + ' ' + s).trim().length <= MAX_CHUNK) {
      current = (current + ' ' + s).trim();
      continue;
    }
    if (current) chunks.push(current);
    if (s.length <= MAX_CHUNK) {
      current = s;
    } else {
      // A single huge sentence: cut on spaces.
      let rest = s;
      while (rest.length > MAX_CHUNK) {
        const cut = rest.lastIndexOf(' ', MAX_CHUNK) > 40 ? rest.lastIndexOf(' ', MAX_CHUNK) : MAX_CHUNK;
        chunks.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Wraps Web Speech API TTS: picks the most natural voice available for the
// language (or the one the user chose in Configuración), strips Markdown and
// reads long answers sentence by sentence so Chrome doesn't cut them off.
export function useSpeechSynthesis() {
  const supported = Boolean(synth);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState(() => (supported ? synth.getVoices() : []));
  const runRef = useRef(0);

  // Voices load asynchronously in Chrome.
  useEffect(() => {
    if (!supported) return undefined;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [supported]);

  const speak = useCallback(
    (text, { lang = 'es-ES', voiceURI, onEnd } = {}) => {
      const clean = speakableText(text);
      if (!supported || !clean) return;
      synth.cancel();
      const run = (runRef.current += 1);
      const voice = pickVoice(synth.getVoices(), lang, voiceURI);
      const chunks = splitForSpeech(clean);
      chunks.forEach((chunk, i) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = voice?.lang || lang;
        if (voice) utterance.voice = voice;
        if (i === 0) utterance.onstart = () => run === runRef.current && setSpeaking(true);
        if (i === chunks.length - 1) {
          utterance.onend = () => {
            if (run !== runRef.current) return;
            setSpeaking(false);
            onEnd?.();
          };
        }
        utterance.onerror = () => run === runRef.current && setSpeaking(false);
        synth.speak(utterance);
      });
    },
    [supported],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    runRef.current += 1;
    synth.cancel();
    setSpeaking(false);
  }, [supported]);

  return useMemo(() => ({ supported, speaking, voices, speak, stop }), [supported, speaking, voices, speak, stop]);
}
