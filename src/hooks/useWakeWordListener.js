import { useEffect, useRef, useState } from 'react';
import { findWakeWord } from '../services/wakeWord';

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const wakeWordSupported = Boolean(SpeechRecognitionImpl);

const RESTART_MS = 400;
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
// status: off | unsupported | listening | retrying | paused | denied | error
// `reason` is the browser's error name while it is retrying ('network', 'audio-capture'…).
export function useWakeWordListener({ enabled, word, lang, paused, onWake }) {
  const [heard, setHeard] = useState('');
  const [failure, setFailure] = useState('');
  const [trouble, setTrouble] = useState('');
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
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      quick = 0;
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
        stopped = true;
        setFailure('error');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        lastError = event.error;
      }
      // no-speech, aborted and network errors just end the session; onend restarts it.
    };

    recognition.onend = () => {
      if (stopped) return;
      if (Date.now() - startedAt < QUICK_MS) {
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
      try {
        recognition.start();
      } catch {
        // start() throws if a session is still closing; try again shortly.
        timer = window.setTimeout(start, RESTART_MS);
      }
    }
    start();

    return () => {
      stopped = true;
      setTrouble('');
      window.clearTimeout(timer);
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

  return { status, reason: trouble, heard, retry: () => setFailure('') };
}
