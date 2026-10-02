import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { markVoice } from '../services/voiceTiming';
import { CLOUD_FIRST_CHUNK, MAX_CHUNK, pickVoice, speakableText, splitForCloud, splitForSpeech } from '../services/speechText';
import { createSentenceStreamer } from '../services/speechStream';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Errors that won't fix themselves soon (no key, no credits, a voice the
// plan can't use): stop trying ElevenLabs for a few minutes. Busy/limit/
// timeout errors only send the current answer to the browser voice.
const CLOUD_FATAL_STATUSES = [401, 402, 403, 503];
const CLOUD_PAUSE_MS = 5 * 60 * 1000;
// A server voice that doesn't answer in this long counts as failed, so Eddie
// doesn't stay "about to speak" forever.
const CLOUD_FETCH_TIMEOUT_MS = 20000;
// How many pieces may be fetched/scheduled beyond the one being heard: enough
// to never leave a gap, few enough for ElevenLabs' concurrent-request limit.
const CLOUD_AHEAD = 2;
// Short fade at both ends of each piece so joining them doesn't click.
const FADE_S = 0.008;
// A touch quicker than the browser's default, which drags.
const BROWSER_RATE = 1.05;

function audioContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!window.__eddieAudio) window.__eddieAudio = new Ctor();
  return window.__eddieAudio;
}

async function fetchCloudAudioOnce(text, language, signal, voiceId, context) {
  // The caller's `signal` stops everything; ours adds the time limit.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLOUD_FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${API_BASE}/api/chat?action=speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, ...(voiceId ? { voiceId } : {}), ...context }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error(data?.error || `No se pudo generar la voz (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return await res.arrayBuffer();
  } catch (err) {
    if (err.name === 'AbortError' && !signal.aborted) throw new Error('La voz de Eddie tardó demasiado en responder.');
    throw err;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

// One automatic retry for a dropped connection or a server hiccup.
async function fetchCloudAudio(text, language, signal, voiceId, context) {
  try {
    return await fetchCloudAudioOnce(text, language, signal, voiceId, context);
  } catch (err) {
    if (signal.aborted || (err.status && err.status < 500)) throw err;
    return fetchCloudAudioOnce(text, language, signal, voiceId, context);
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
const STREAM_BROWSER = { firstMin: 25, firstMax: 120, min: 70, max: MAX_CHUNK };

// Text to speech. Two engines behind one `speak` (or `speakStream`, which
// starts talking while the answer is still being written):
// - "elevenlabs": Eddie's own voice, generated on the server (POST
//   /api/chat?action=speak) piece by piece. Each piece is decoded and
//   scheduled on the Web Audio clock right behind the previous one, so the
//   sentences join without gaps, and the server gets the neighbouring text so
//   the intonation carries on. Any failure falls back to the browser voice for
//   the rest of the answer; `cloudError` says why.
// - "browser": Web Speech API, with the most natural voice available for the
//   language (or the one chosen in Configuración), read sentence by sentence
//   so Chrome doesn't cut long answers off.
// Both strip Markdown first. `speaking` is true from the moment a voice is
// asked for until it ends, so nothing else (the microphone) jumps in while
// the audio is still on its way. `engineInfo` tells which engine spoke last
// and, for the browser, why.
export function useSpeechSynthesis() {
  const browserSupported = Boolean(synth);
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState(() => (browserSupported ? synth.getVoices() : []));
  const [cloudError, setCloudError] = useState('');
  const [engineInfo, setEngineInfo] = useState({ engine: null, reason: '' });
  const runRef = useRef(0);
  const abortRef = useRef(null);
  const sessionRef = useRef(null);
  const cloudOffUntilRef = useRef(0);

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
      const announced = new Set();
      // Some browser voices (ChromeOS network voices) sometimes never report
      // that an utterance ended. Once everything has been handed over, if the
      // engine is idle — or far longer than the text could take has passed —
      // the reading is over, and the microphone must not stay locked out.
      let chars = 0;
      let watchdog = null;
      const armWatchdog = () => {
        if (watchdog) return;
        const deadline = Date.now() + 8000 + chars * 110;
        let idleSince = 0;
        watchdog = window.setInterval(() => {
          if (run !== runRef.current) {
            window.clearInterval(watchdog);
            return;
          }
          const idle = !synth.speaking && !synth.pending;
          idleSince = idle ? idleSince || Date.now() : 0;
          if ((idle && Date.now() - idleSince > 1500) || Date.now() > deadline) {
            window.clearInterval(watchdog);
            if (pending > 0) {
              pending = 0;
              try {
                synth.cancel();
              } catch {
                /* nothing to cancel */
              }
              maybeEnd();
            }
          }
        }, 500);
      };
      return {
        // `tag` names the piece this chunk belongs to (see speakPieces).
        push(chunk, tag) {
          const utterance = new SpeechSynthesisUtterance(chunk);
          utterance.lang = voice?.lang || options.lang;
          utterance.rate = BROWSER_RATE * (options.rate || 1);
          utterance.volume = options.volume ?? 1;
          if (voice) utterance.voice = voice;
          pending += 1;
          chars += chunk.length;
          utterance.onstart = () => {
            if (run !== runRef.current || started) return;
            started = true;
            if (!options.filler) markVoice('audioStart');
            setSpeaking(true);
          };
          utterance.addEventListener('start', () => {
            if (run !== runRef.current || tag === undefined || announced.has(tag)) return;
            announced.add(tag);
            options.onPiece?.(tag);
          });
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
          if (pending > 0) armWatchdog();
        },
      };
    },
    [browserSupported],
  );

  // Plays the session's pieces with the server voice. Each piece is fetched
  // (up to CLOUD_AHEAD pieces ahead), decoded and scheduled to start the
  // moment the previous one ends.
  const playCloud = useCallback(
    async (session) => {
      const { run, options, queue } = session;
      const language = options.lang.slice(0, 2);
      const ctx = audioContext();
      const controller = new AbortController();
      abortRef.current = controller;
      const loads = [];
      let current = 0;
      let ended = 0; // pieces already heard to the end
      const peak = Math.min(1, Math.max(0.05, options.volume ?? 1));
      const context = (i) => ({
        ...(options.rate && options.rate !== 1 ? { speed: options.rate } : {}),
        ...(i > 0 && queue.at(i - 1) ? { previousText: queue.at(i - 1) } : {}),
        ...(queue.has(i + 1) ? { nextText: queue.at(i + 1) } : {}),
      });
      const load = (i) => {
        if (queue.has(i) && !loads[i]) {
          loads[i] = fetchCloudAudio(queue.at(i), language, controller.signal, options.cloudVoice, context(i));
          loads[i].catch(() => {}); // handled where it's awaited
        }
        return loads[i];
      };
      session.prefetch = () => {
        load(current);
        if (current + 1 - ended <= CLOUD_AHEAD) load(current + 1);
      };
      session.sources = [];
      let waiter = null;
      session.wake = () => {
        waiter?.();
        waiter = null;
      };
      const waitForEnd = () =>
        new Promise((resolve) => {
          waiter = resolve;
        });
      // Finish this answer with the browser voice instead of going silent:
      // what is left now, and whatever is still to come.
      const fallBack = (index, err) => {
        // Pieces announced by their start can't be timed any more: say they're here.
        session.pieceIds?.slice(index).forEach((id) => options.onPiece?.(id));
        session.mode = 'browser';
        session.sink = createBrowserSink(session);
        setEngineInfo({ engine: 'browser', reason: 'error', detail: err.message });
        splitForSpeech(queue.rest(index)).forEach((c) => session.sink.push(c));
        if (queue.finished) session.sink.finish();
      };

      // A context created before the user touched the page starts suspended;
      // if it can't be woken now (autoplay blocked), give up quietly.
      if (ctx.state !== 'running') {
        await Promise.race([ctx.resume().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 1500))]);
        if (run !== runRef.current) return undefined;
        if (ctx.state !== 'running') {
          setSpeaking(false);
          return undefined;
        }
      }
      let clock = 0; // when the next piece should start (context time)
      let lastEnded = Promise.resolve();
      let started = false;
      for (let i = 0; ; i += 1) {
        current = i;
        const chunk = await queue.get(i);
        if (run !== runRef.current) return undefined;
        if (chunk === null) break;
        while (i - ended >= CLOUD_AHEAD) {
          await waitForEnd();
          if (run !== runRef.current) return undefined;
        }
        let buffer;
        try {
          buffer = await ctx.decodeAudioData(await load(i));
        } catch (err) {
          if (run !== runRef.current) return undefined;
          if (CLOUD_FATAL_STATUSES.includes(err.status)) cloudOffUntilRef.current = Date.now() + CLOUD_PAUSE_MS;
          setCloudError(err.status ? err.message : err.name === 'EncodingError' ? 'ElevenLabs devolvió un audio que el navegador no pudo reproducir.' : err.message);
          // Whatever is already scheduled finishes first, so the two voices don't overlap.
          await lastEnded;
          if (run !== runRef.current) return undefined;
          fallBack(i, err);
          return undefined;
        }
        if (run !== runRef.current) return undefined;
        load(i + 1);

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.connect(gain).connect(ctx.destination);
        const when = Math.max(ctx.currentTime + 0.03, clock);
        const end = when + buffer.duration;
        gain.gain.setValueAtTime(0, when);
        gain.gain.linearRampToValueAtTime(peak, when + FADE_S);
        gain.gain.setValueAtTime(peak, Math.max(when + FADE_S, end - FADE_S));
        gain.gain.linearRampToValueAtTime(0, end);
        // The next piece starts as this one ends (the fades overlap slightly).
        clock = end - FADE_S / 2;
        lastEnded = new Promise((resolve) => {
          source.onended = () => {
            ended += 1;
            session.wake?.();
            resolve();
          };
        });
        session.sources.push(source);
        source.start(when);
        if (options.onPiece) {
          const id = session.pieceIds ? session.pieceIds[i] : i;
          window.setTimeout(() => run === runRef.current && options.onPiece(id), Math.max(0, (when - ctx.currentTime) * 1000));
        }
        if (!started) {
          started = true;
          setCloudError('');
          setEngineInfo({ engine: 'elevenlabs', reason: '' });
          if (!options.filler) markVoice('audioStart');
          setSpeaking(true);
        }
      }
      await lastEnded;
      if (run !== runRef.current) return undefined;
      setSpeaking(false);
      options.onEnd?.();
      return undefined;
    },
    [createBrowserSink],
  );

  const stopAll = useCallback(() => {
    runRef.current += 1;
    const session = sessionRef.current;
    session?.queue.finish(); // wakes a player that was waiting for more text
    session?.wake?.();
    session?.sources?.forEach((source) => {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    });
    sessionRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    if (browserSupported) synth.cancel();
  }, [browserSupported]);

  // Starts a reading and returns its session; pieces are added with `feed`.
  const open = useCallback(
    ({ lang = 'es-ES', voiceURI, engine = 'browser', cloudVoice, browserReason = 'chosen', filler = false, onEnd, onPiece, volume, rate } = {}) => {
      stopAll();
      const run = runRef.current;
      // "Speaking" from the moment the voice is asked for, not when the first
      // sound plays: the wake-word window and the ring wait for it instead of
      // opening the microphone first.
      setSpeaking(true);
      const session = { run, options: { lang, voiceURI, cloudVoice, filler, onEnd, onPiece, volume, rate }, queue: createChunkQueue(), mode: 'browser', sink: null, prefetch: null };
      sessionRef.current = session;
      const paused = Date.now() < cloudOffUntilRef.current;
      if (engine === 'elevenlabs' && !paused && audioContext()) {
        session.mode = 'cloud';
        playCloud(session);
      } else {
        session.sink = createBrowserSink(session);
        let reason = browserReason;
        if (engine === 'elevenlabs') reason = paused ? 'paused' : 'unsupported';
        setEngineInfo({ engine: 'browser', reason });
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
      const clean = speakableText(text, (options.lang || 'es').slice(0, 2));
      if (!clean) return;
      const session = open(options);
      feed(session, session.mode === 'browser' ? splitForSpeech(clean) : splitForCloud(clean));
      finish(session);
    },
    [open, feed, finish],
  );

  // Reads a list of pieces, each as one unit, and says when each one starts
  // being heard: `onPiece(index)`. For things that go with what is being said
  // (the home screen's panels). Pieces are short; the server voice gets each
  // as one request, and they play back to back.
  const speakPieces = useCallback(
    (pieces, options = {}) => {
      const lang = (options.lang || 'es').slice(0, 2);
      const ids = [];
      const clean = [];
      pieces.forEach((piece, id) => {
        const text = speakableText(piece, lang);
        if (text) {
          ids.push(id);
          clean.push(text);
        } else {
          options.onPiece?.(id);
        }
      });
      if (!clean.length) return;
      const session = open(options);
      session.pieceIds = ids;
      clean.forEach((text, k) => {
        if (session.mode === 'browser') {
          splitForSpeech(text).forEach((chunk) => session.sink.push(chunk, ids[k]));
        } else {
          session.queue.push(text);
          session.prefetch?.();
        }
      });
      finish(session);
    },
    [open, finish],
  );

  // Talks while the answer is still being written: `push(textSoFar)` as it
  // grows, `end(finalText)` when it is complete. Cancelled by any other
  // speak/stop, after which the controller does nothing.
  const speakStream = useCallback(
    (options = {}) => {
      const session = open(options);
      const base = session.mode === 'browser' ? STREAM_BROWSER : STREAM_CLOUD;
      const streamer = createSentenceStreamer({ ...base, lang: (options.lang || 'es').slice(0, 2) });
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
    () => ({ supported: browserSupported, speaking, voices, cloudError, engineInfo, speak, speakPieces, speakStream, stop }),
    [browserSupported, speaking, voices, cloudError, engineInfo, speak, speakPieces, speakStream, stop],
  );
}
