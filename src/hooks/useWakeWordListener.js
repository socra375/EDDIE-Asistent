import { useEffect, useRef, useState } from 'react';
import { findWakeWord } from '../services/wakeWord';

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const wakeWordSupported = Boolean(SpeechRecognitionImpl);

const RESTART_MS = 400;
// After Eddie speaks or the microphone was used for a command, give the audio
// device a moment to be free before listening for the word again.
const HANDOFF_MS = 600;
// A recognizer that hasn't really started listening after this long is
// restarted (the chip must not claim to listen when it doesn't).
const START_WATCH_MS = 4000;
// "audio-capture" right after another use of the microphone is usually the
// device still being released: retry a few times before giving up.
const CAPTURE_RETRIES = 5;
// A session that ends this soon after starting counts as a failed attempt.
const QUICK_MS = 1500;
// After this many failed attempts in a row the listener reports "retrying"
// (and why), and waits longer between tries (400 ms, 800 ms, … up to 30 s) —
// it keeps trying instead of silently giving up: the connection or the
// microphone may come back.
const TROUBLE_AFTER = 3;
const MAX_WAIT_MS = 30_000;

// Keeps the browser's recognizer running in the background looking for the
// wake word, and calls onWake(rest) when it hears it (`rest` is the command
// said in the same breath, or ''). `paused` stops it while Eddie is using the
// microphone or speaking — two recognizers can't share the mic, and Eddie's
// own voice must not wake itself.
//
// status: off | unsupported | starting | listening | retrying | paused | denied | error
// ("listening" only once the browser says the recognizer is really on.)
// `reason` is the browser's error name while it is retrying ('network', 'audio-capture'…).
export function useWakeWordListener({ enabled, word, lang, paused, onWake }) {
  const [heard, setHeard] = useState('');
  const [failure, setFailure] = useState('');
  const [trouble, setTrouble] = useState('');
  const [confirmed, setConfirmed] = useState(false); // the recognizer is really listening
  const onWakeRef = useRef(onWake);
  useEffect(() => {
    onWakeRef.current = onWake;
  }, [onWake]);

  const active = enabled && wakeWordSupported && !paused && !failure;

  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let timer = null;
    let quick = 0;
    let startedAt = 0;
    let lastError = '';
    let captureFails = 0;
    let running = false; // this session got to listening
    let watch = null;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      window.clearTimeout(watch);
      running = true;
      setConfirmed(true);
    };

    recognition.onresult = (event) => {
      quick = 0;
      captureFails = 0;
      setTrouble('');
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        setHeard(text.trim());
        if (!result.isFinal) continue;
        const { found, rest } = findWakeWord(text, word);
        if (found) {
          stopped = true;
          try {
            recognition.abort();
          } catch {
            /* already stopped */
          }
          onWakeRef.current(rest);
          return;
        }
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        stopped = true;
        setFailure('denied');
      } else if (event.error === 'audio-capture') {
        captureFails += 1;
        lastError = 'audio-capture';
        if (captureFails > CAPTURE_RETRIES) {
          stopped = true;
          setFailure('error');
        }
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        lastError = event.error;
      }
      // no-speech, aborted and network errors just end the session; onend restarts it.
    };

    recognition.onend = () => {
      window.clearTimeout(watch);
      setConfirmed(false);
      if (stopped) return;
      if (!running || Date.now() - startedAt < QUICK_MS) {
        quick += 1;
      } else {
        quick = 0;
        lastError = '';
        setTrouble('');
      }
      if (quick >= TROUBLE_AFTER) setTrouble(lastError || 'quick');
      const wait = Math.min(MAX_WAIT_MS, RESTART_MS * 2 ** Math.max(0, quick - 1));
      timer = window.setTimeout(start, wait);
    };

    function start() {
      if (stopped) return;
      startedAt = Date.now();
      running = false;
      window.clearTimeout(watch);
      watch = window.setTimeout(() => {
        if (running || stopped) return;
        try {
          recognition.abort(); // ends the session; onend retries
        } catch {
          /* already stopped */
        }
      }, START_WATCH_MS);
      try {
        recognition.start();
      } catch {
        // start() throws if a session is still closing; try again shortly.
        timer = window.setTimeout(start, RESTART_MS);
      }
    }
    timer = window.setTimeout(start, HANDOFF_MS);

    return () => {
      stopped = true;
      setTrouble('');
      setConfirmed(false);
      window.clearTimeout(timer);
      window.clearTimeout(watch);
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    };
  }, [active, word, lang]);

  let status = 'listening';
  if (!enabled) status = 'off';
  else if (!wakeWordSupported) status = 'unsupported';
  else if (failure === 'denied') status = 'denied';
  else if (failure) status = 'error';
  else if (paused) status = 'paused';
  else if (trouble) status = 'retrying';
  else if (!confirmed) status = 'starting';

  return { status, reason: trouble, heard, retry: () => setFailure('') };
}
