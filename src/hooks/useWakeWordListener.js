import { useEffect, useRef, useState } from 'react';
import { findWakeWord } from '../services/wakeWord';

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const wakeWordSupported = Boolean(SpeechRecognitionImpl);

const RESTART_MS = 400;
// A recognizer that dies right after starting this many times in a row
// (mic taken, no network) is given up on instead of spinning.
const MAX_QUICK_FAILURES = 6;

// Keeps the browser's recognizer running in the background looking for the
// wake word, and calls onWake(rest) when it hears it (`rest` is the command
// said in the same breath, or ''). `paused` stops it while Eddie is using the
// microphone or speaking — two recognizers can't share the mic, and Eddie's
// own voice must not wake itself.
//
// status: off | unsupported | listening | paused | denied | error
export function useWakeWordListener({ enabled, word, lang, paused, onWake }) {
  const [heard, setHeard] = useState('');
  const [failure, setFailure] = useState('');
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
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
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
      }
      // no-speech, aborted and network errors just end the session; onend restarts it.
    };

    recognition.onend = () => {
      if (stopped) return;
      quick = Date.now() - startedAt < 1500 ? quick + 1 : 0;
      if (quick >= MAX_QUICK_FAILURES) {
        setFailure('error');
        return;
      }
      timer = window.setTimeout(start, RESTART_MS);
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

  return { status, heard, retry: () => setFailure('') };
}
