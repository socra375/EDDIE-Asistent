import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markVoice } from '../services/voiceTiming';
import { CLOUD_FIRST_CHUNK, MAX_CHUNK, pickVoice, speakableText, splitForCloud, splitForSpeech } from '../services/speechText';
import { createSentenceStreamer } from '../services/speechStream';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Errors that won't fix themselves this session (no key, no credits, a voice
// the plan can't use): stop trying ElevenLabs until the page reloads.
const CLOUD_FATAL_STATUSES = [401, 402, 403, 503];
// A server voice that doesn't answer in this long counts as failed, so Eddie
// doesn't stay "about to speak" forever.
const CLOUD_FETCH_TIMEOUT_MS = 20000;

async function fetchCloudAudio(text, language, signal, voiceId) {
  // The caller's `signal` stops everything; ours adds the time limit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API_BASE}/api/chat?action=speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, ...(voiceId ? { voiceId } : {}) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error(data?.error || `No se pudo generar la voz (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return URL.createObjectURL(await res.blob());
  } catch (err) {
    if (err.name === 'AbortError' && !signal.aborted) throw new Error('La voz de Eddie tardó demasiado en responder.');
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

// A growing list of pieces to read: the player waits for the next one while
// the answer is still being written, and `finish()` says no more will come.
function createChunkQueue() {
  const items = [];
  let finished = false;
  let wake = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  return {
    push(chunk) {
      items.push(chunk);
      notify();
    },
    finish() {
      finished = true;
      notify();
    },
    get finished() {
      return finished;
    },
    has: (i) => i < items.length,
    at: (i) => items[i],
    rest: (i) => items.slice(i).join(' '),
    // The piece number i, waiting for it if needed; null once it is known there won't be one.
    async get(i) {
      while (i >= items.length) {
        if (finished) return null;
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
      return items[i];
    },
  };
}

// While an answer streams in, pieces are sized for the engine in use.
const STREAM_CLOUD = { firstMin: 20, firstMax: CLOUD_FIRST_CHUNK, min: 80, max: 260 };
const STREAM_BROWSER = { firstMin: 12, firstMax: 120, min: 30, max: MAX_CHUNK };

// Text to speech. Two engines behind one `speak` (or `speakStream`, which
// starts talking while the answer is still being written):
// - "elevenlabs": Eddie's own voice, generated on the server (POST
//   /api/chat?action=speak) piece by piece — the next piece is fetched while
//   the current one plays. Any failure falls back to the browser voice for
//   the rest of the answer, and `cloudError` says why.
// - "browser": Web Speech API, with the most natural voice available for the
//   language (or the one chosen in Configuración), read sentence by sentence
//   so Chrome doesn't cut long answers off.
// Both strip Markdown first. `speaking` is true from the moment a voice is
// asked for until it ends, so nothing else (the microphone) jumps in while
// the audio is still on its way.
export function useSpeechSynthesis() {
  const browserSupported = Boolean(synth);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState(() => (browserSupported ? synth.getVoices() : []));
  const [cloudError, setCloudError] = useState('');
  const runRef = useRef(0);
  const audioRef = useRef(null);
  const abortRef = useRef(null);
  const sessionRef = useRef(null);
  const cloudOffRef = useRef(false);

  // Voices load asynchronously in Chrome.
  useEffect(() => {
    if (!browserSupported) return undefined;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.('voiceschanged', load);
    return () => synth.removeEventListener?.('voiceschanged', load);
  }, [browserSupported]);

  // The browser voice as a place pieces are sent to, one utterance each.
  const createBrowserSink = useCallback(
    (session) => {
      const { run, options } = session;
      let pending = 0;
      let finished = false;
      let started = false;
      const maybeEnd = () => {
        if (!finished || pending > 0 || run !== runRef.current) return;
        setSpeaking(false);
        options.onEnd?.();
      };
      if (!browserSupported) {
        return {
          push() {},
          finish() {
            if (run === runRef.current) setSpeaking(false);
          },
        };
      }
      const voice = pickVoice(synth.getVoices(), options.lang, options.voiceURI);
      return {
        push(chunk) {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.lang = voice?.lang || options.lang;
          if (voice) utterance.voice = voice;
          pending += 1;
          utterance.onstart = () => {
            if (run !== runRef.current || started) return;
            started = true;
            markVoice('audioStart');
            setSpeaking(true);
          };
          utterance.onend = () => {
            pending -= 1;
            maybeEnd();
          };
          utterance.onerror = () => {
            pending -= 1;
            if (run === runRef.current && finished && pending === 0) setSpeaking(false);
          };
          synth.speak(utterance);
        },
        finish() {
          finished = true;
          maybeEnd();
        },
      };
    },
    [browserSupported],
  );

  // Plays the session's pieces with the server voice, fetching the next one
  // while the current one plays.
  const playCloud = useCallback(
    async (session) => {
      const { run, options, queue } = session;
      const language = options.lang.slice(0, 2);
      const controller = new AbortController();
      abortRef.current = controller;
      const urls = [];
      let current = 0;
      const load = (i) => {
        if (queue.has(i) && !urls[i]) {
          urls[i] = fetchCloudAudio(queue.at(i), language, controller.signal, options.cloudVoice);
          urls[i].catch(() => {}); // handled where it's awaited
        }
        return urls[i];
      };
      session.prefetch = () => {
        load(current);
        load(current + 1);
      };
      const release = () => urls.forEach((p) => p?.then((u) => URL.revokeObjectURL(u)).catch(() => {}));
      // Finish this answer with the browser voice instead of going silent:
      // what is left now, and whatever is still to come.
      const fallBack = (index) => {
        session.mode = 'browser';
        session.sink = createBrowserSink(session);
        splitForSpeech(queue.rest(index)).forEach((c) => session.sink.push(c));
        if (queue.finished) session.sink.finish();
      };

      for (let i = 0; ; i += 1) {
        current = i;
        const chunk = await queue.get(i);
        if (run !== runRef.current) return release();
        if (chunk === null) break;
        let url;
        try {
          url = await load(i);
        } catch (err) {
          if (run !== runRef.current) return release();
          if (CLOUD_FATAL_STATUSES.includes(err.status)) cloudOffRef.current = true;
          setCloudError(err.message);
          release();
          fallBack(i);
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
        markVoice('audioStart');
        setSpeaking(true);
        await ended;
        if (run !== runRef.current) return release();
      }
      release();
      setSpeaking(false);
      options.onEnd?.();
      return undefined;
    },
    [createBrowserSink],
  );

  const stopAll = useCallback(() => {
    runRef.current += 1;
    sessionRef.current?.queue.finish(); // wakes a player that was waiting for more text
    sessionRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (browserSupported) synth.cancel();
  }, [browserSupported]);

  // Starts a reading and returns its session; pieces are added with `feed`.
  const open = useCallback(
    ({ lang = 'es-ES', voiceURI, engine = 'browser', cloudVoice, onEnd } = {}) => {
      stopAll();
      const run = runRef.current;
      // "Speaking" from the moment the voice is asked for, not when the first
      // sound plays: the wake-word window and the ring wait for it instead of
      // opening the microphone first.
      setSpeaking(true);
      const session = { run, options: { lang, voiceURI, cloudVoice, onEnd }, queue: createChunkQueue(), mode: 'browser', sink: null, prefetch: null };
      sessionRef.current = session;
      if (engine === 'elevenlabs' && !cloudOffRef.current) {
        session.mode = 'cloud';
        playCloud(session);
      } else {
        session.sink = createBrowserSink(session);
      }
      return session;
    },
    [stopAll, playCloud, createBrowserSink],
  );

  const feed = useCallback((session, chunks) => {
    for (const chunk of chunks) {
      if (session.mode === 'browser') {
        session.sink?.push(chunk);
      } else {
        session.queue.push(chunk);
        session.prefetch?.();
      }
    }
  }, []);

  const finish = useCallback((session) => {
    if (session.mode === 'browser') session.sink?.finish();
    else session.queue.finish();
  }, []);

  const speak = useCallback(
    (text, options = {}) => {
      const clean = speakableText(text);
      if (!clean) return;
      const session = open(options);
      feed(session, session.mode === 'browser' ? splitForSpeech(clean) : splitForCloud(clean));
      finish(session);
    },
    [open, feed, finish],
  );

  // Talks while the answer is still being written: `push(textSoFar)` as it
  // grows, `end(finalText)` when it is complete. Cancelled by any other
  // speak/stop, after which the controller does nothing.
  const speakStream = useCallback(
    (options = {}) => {
      const session = open(options);
      const streamer = createSentenceStreamer(session.mode === 'browser' ? STREAM_BROWSER : STREAM_CLOUD);
      const alive = () => runRef.current === session.run;
      return {
        push(text) {
          if (alive()) feed(session, streamer.push(text));
        },
        end(finalText) {
          if (!alive()) return;
          feed(session, streamer.end(finalText));
          finish(session);
        },
      };
    },
    [open, feed, finish],
  );

  const stop = useCallback(() => {
    stopAll();
    setSpeaking(false);
  }, [stopAll]);

  return useMemo(
    () => ({ supported: browserSupported, speaking, voices, cloudError, speak, speakStream, stop }),
    [browserSupported, speaking, voices, cloudError, speak, speakStream, stop],
  );
}
