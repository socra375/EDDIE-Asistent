import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Chrome stops long utterances after ~15 s, so answers are read in pieces
// of whole sentences no longer than this.
const MAX_CHUNK = 220;
// ElevenLabs pieces can be longer (fewer requests); the first one stays
// short so Eddie starts talking sooner.
const CLOUD_FIRST_CHUNK = 160;
const CLOUD_CHUNK = 450;
// Errors that won't fix themselves this session (no key, no credits, a voice
// the plan can't use): stop trying ElevenLabs until the page reloads.
const CLOUD_FATAL_STATUSES = [401, 402, 403, 503];

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

// ElevenLabs pieces: a short first one, then longer ones.
export function splitForCloud(text) {
  const [first, ...rest] = splitForSpeech(text, CLOUD_FIRST_CHUNK);
  if (!first) return [];
  return [first, ...splitForSpeech(rest.join(' '), CLOUD_CHUNK)];
}

async function fetchCloudAudio(text, language, signal) {
  const res = await fetch(`${API_BASE}/api/chat?action=speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = new Error(data?.error || `No se pudo generar la voz (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return URL.createObjectURL(await res.blob());
}

// Text to speech. Two engines behind one `speak`:
// - "elevenlabs": Eddie's own voice, generated on the server (POST
//   /api/chat?action=speak) piece by piece — the next piece is fetched while
//   the current one plays. Any failure falls back to the browser voice for
//   the rest of the answer, and `cloudError` says why.
// - "browser": Web Speech API, with the most natural voice available for the
//   language (or the one chosen in Configuración), read sentence by sentence
//   so Chrome doesn't cut long answers off.
// Both strip Markdown first.
export function useSpeechSynthesis() {
  const browserSupported = Boolean(synth);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState(() => (browserSupported ? synth.getVoices() : []));
  const [cloudError, setCloudError] = useState('');
  const runRef = useRef(0);
  const audioRef = useRef(null);
  const abortRef = useRef(null);
  const cloudOffRef = useRef(false);

  // Voices load asynchronously in Chrome.
  useEffect(() => {
    if (!browserSupported) return undefined;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [browserSupported]);

  const speakBrowser = useCallback(
    (chunks, run, { lang, voiceURI, onEnd }) => {
      if (!browserSupported || !chunks.length) {
        if (run === runRef.current) setSpeaking(false);
        return;
      }
      const voice = pickVoice(synth.getVoices(), lang, voiceURI);
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
    [browserSupported],
  );

  const speakCloud = useCallback(
    async (clean, run, options) => {
      const language = options.lang.slice(0, 2);
      const chunks = splitForCloud(clean);
      const controller = new AbortController();
      abortRef.current = controller;
      const urls = [];
      const load = (i) => {
        if (i < chunks.length && !urls[i]) {
          urls[i] = fetchCloudAudio(chunks[i], language, controller.signal);
          urls[i].catch(() => {}); // handled where it's awaited
        }
        return urls[i];
      };
      const release = () => urls.forEach((p) => p?.then((u) => URL.revokeObjectURL(u)).catch(() => {}));

      for (let i = 0; i < chunks.length; i += 1) {
        let url;
        try {
          url = await load(i);
        } catch (err) {
          if (run !== runRef.current || err.name === 'AbortError') return release();
          if (CLOUD_FATAL_STATUSES.includes(err.status)) cloudOffRef.current = true;
          setCloudError(err.message);
          release();
          // Finish this answer with the browser voice instead of going silent.
          speakBrowser(splitForSpeech(chunks.slice(i).join(' ')), run, options);
          return undefined;
        }
        if (run !== runRef.current) return release();
        load(i + 1);
        const audio = new Audio(url);
        audioRef.current = audio;
        const ended = new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = resolve;
        });
        try {
          await audio.play();
        } catch {
          // Autoplay blocked (no interaction with the page yet): give up quietly.
          if (run === runRef.current) setSpeaking(false);
          return release();
        }
        if (run !== runRef.current) return release();
        setSpeaking(true);
        await ended;
        if (run !== runRef.current) return release();
      }
      release();
      setSpeaking(false);
      options.onEnd?.();
      return undefined;
    },
    [speakBrowser],
  );

  const stopAll = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (browserSupported) synth.cancel();
  }, [browserSupported]);

  const speak = useCallback(
    (text, { lang = 'es-ES', voiceURI, engine = 'browser', onEnd } = {}) => {
      const clean = speakableText(text);
      if (!clean) return;
      stopAll();
      const run = runRef.current;
      const options = { lang, voiceURI, onEnd };
      if (engine === 'elevenlabs' && !cloudOffRef.current) {
        speakCloud(clean, run, options);
      } else {
        speakBrowser(splitForSpeech(clean), run, options);
      }
    },
    [stopAll, speakCloud, speakBrowser],
  );

  const stop = useCallback(() => {
    stopAll();
    setSpeaking(false);
  }, [stopAll]);

  return useMemo(
    () => ({ supported: browserSupported, speaking, voices, cloudError, speak, stop }),
    [browserSupported, speaking, voices, cloudError, speak, stop],
  );
}
