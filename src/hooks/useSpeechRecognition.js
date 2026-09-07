import { useCallback, useEffect, useRef, useState } from 'react';

const SpeechRecognitionImpl =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;

// Wraps the Web Speech API's recognizer with continuous listening, live
// interim transcripts, and graceful degradation when the browser lacks support
// or the user denies microphone permission.
export function useSpeechRecognition({ lang = 'es-ES' } = {}) {
  const supported = Boolean(SpeechRecognitionImpl);
  const recognitionRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported) return undefined;

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText) setTranscript((prev) => `${prev}${finalText}`.trim());
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setError('Eddie necesita permiso para usar el micrófono.');
      } else if (event.error === 'no-speech') {
        setError('No se detectó voz. Inténtalo de nuevo.');
      } else {
        setError(`Error de reconocimiento de voz: ${event.error}`);
      }
      setListening(false);
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [supported, lang]);

  const start = useCallback(() => {
    if (!supported || !recognitionRef.current) {
      setError('Este navegador no admite reconocimiento de voz.');
      return;
    }
    setError('');
    setTranscript('');
    setInterimTranscript('');
    try {
      recognitionRef.current.start();
      setListening(true);
    } catch {
      // start() throws if already started; ignore
    }
  }, [supported]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
  }, []);

  return { supported, listening, transcript, interimTranscript, error, start, stop, reset };
}
