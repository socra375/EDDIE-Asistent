import { useEffect, useRef, useState } from 'react';

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

export const dictationSupported = Boolean(SpeechRecognitionImpl);

const RESTART_MS = 300;
const START_WATCH_MS = 4000;
const CAPTURE_RETRIES = 5;
const MAX_WAIT_MS = 15_000;

// Keeps the browser's recognizer open (continuous) while `active`, restarting
// it by itself when the browser closes it (long silences, network blips), and
// reports what is heard: onFinal(text) for each finished phrase, `interim` for
// the phrase still being said. `paused` (Eddie is speaking) closes it without
// ending the dictation.
//
// status: off | unsupported | starting | listening | retrying | denied | error
export function useDictation({ active, lang, paused, onFinal }) {
  const [interim, setInterim] = useState('');
  const [failure, setFailure] = useState('');
  const [trouble, setTrouble] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  // A new dictation starts clean.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (active) setFailure('');
  }

  const running = active && dictationSupported && !paused && !failure;

  useEffect(() => {
    if (!running) return undefined;
    let stopped = false;
    let timer = null;
    let watch = null;
    let startedAt = 0;
    let quick = 0;
    let captureFails = 0;
    let lastError = '';
    let live = false;
    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onstart = () => {
      window.clearTimeout(watch);
      live = true;
      setConfirmed(true);
    };

    recognition.onresult = (event) => {
      quick = 0;
      captureFails = 0;
      setTrouble('');
      let pending = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          if (text.trim()) onFinalRef.current(text);
        } else {
          pending += text;
        }
      }
      setInterim(pending.trim());
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
    };

    recognition.onend = () => {
      window.clearTimeout(watch);
      setConfirmed(false);
      setInterim('');
      if (stopped) return;
      if (!live || Date.now() - startedAt < 1500) quick += 1;
      else {
        quick = 0;
        lastError = '';
        setTrouble('');
      }
      if (quick >= 3) setTrouble(lastError || 'quick');
      timer = window.setTimeout(start, Math.min(MAX_WAIT_MS, RESTART_MS * 2 ** Math.max(0, quick - 1)));
    };

    function start() {
      if (stopped) return;
      startedAt = Date.now();
      live = false;
      window.clearTimeout(watch);
      watch = window.setTimeout(() => {
        if (live || stopped) return;
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
      }, START_WATCH_MS);
      try {
        recognition.start();
      } catch {
        timer = window.setTimeout(start, RESTART_MS);
      }
    }
    timer = window.setTimeout(start, RESTART_MS);

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.clearTimeout(watch);
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      setConfirmed(false);
      setInterim('');
      setTrouble('');
      try {
        recognition.stop(); // lets the phrase being said finish
      } catch {
        /* already stopped */
      }
    };
  }, [running, lang]);

  let status = 'listening';
  if (!active) status = 'off';
  else if (!dictationSupported) status = 'unsupported';
  else if (failure === 'denied') status = 'denied';
  else if (failure) status = 'error';
  else if (paused) status = 'starting';
  else if (trouble) status = 'retrying';
  else if (!confirmed) status = 'starting';
  return { status, interim, reason: trouble };
}
