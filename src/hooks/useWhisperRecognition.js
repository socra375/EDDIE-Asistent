import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
// Stop on its own after this much quiet once the user has spoken, give up
// if nobody speaks at all, and never record longer than the server accepts.
const SILENCE_MS = 1400;
const NO_SPEECH_MS = 8000;
const MAX_RECORD_MS = 60000;
const CALIBRATION_MS = 300;

export const whisperSupported =
  typeof window !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  typeof window.MediaRecorder !== 'undefined' &&
  Boolean(window.AudioContext || window.webkitAudioContext);

function pickMimeType() {
  return MIME_CANDIDATES.find((t) => window.MediaRecorder.isTypeSupported?.(t)) || '';
}

function micErrorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'Eddie necesita permiso para usar el micrófono.';
  if (err?.name === 'NotFoundError') return 'No se encontró ningún micrófono.';
  return 'No se pudo usar el micrófono.';
}

// Records the user's voice and transcribes it with Whisper on Groq through
// POST /api/chat?action=transcribe. Same surface as useSpeechRecognition so
// VoiceContext can swap one for the other; the differences are that there is
// no live (interim) text — Whisper transcribes the whole clip at once — and
// a `transcribing` phase between recording and the final transcript.
// Recording stops by itself after a pause (simple volume-based detection).
export function useWhisperRecognition({ language = 'es' } = {}) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  // True once the user's voice was detected in this recording (there is no live text with Whisper).
  const [heard, setHeard] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null);

  const cleanup = useCallback((session) => {
    if (!session) return;
    clearInterval(session.timer);
    session.stream.getTracks().forEach((t) => t.stop());
    session.audioCtx.close().catch(() => {});
    if (sessionRef.current === session) sessionRef.current = null;
  }, []);

  const upload = useCallback(
    async (blob, mimeType) => {
      setTranscribing(true);
      try {
        const res = await fetch(`${API_BASE}/api/chat?action=transcribe&lang=${encodeURIComponent(language)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Audio-Type': mimeType },
          body: blob,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `No se pudo transcribir (${res.status}).`);
        const text = (data?.text || '').trim();
        if (!text) setError('No se entendió lo que dijiste. Inténtalo de nuevo.');
        setTranscript(text);
      } catch (err) {
        setError(err.message || 'No se pudo transcribir el audio.');
      } finally {
        setTranscribing(false);
      }
    },
    [language],
  );

  // `{ silent: true }` ends the recording without the "no voice detected"
  // warning — for a wait that simply ran out (the follow-up window).
  const stop = useCallback((options) => {
    const session = sessionRef.current;
    if (!session || session.recorder.state === 'inactive') return;
    session.silent = Boolean(options?.silent);
    session.recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (!whisperSupported) {
      setError('Este navegador no permite grabar audio.');
      return;
    }
    if (sessionRef.current || transcribing) return;
    setError('');
    setTranscript('');
    setHeard(false);

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      setError(micErrorMessage(err));
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioCtx();
    // Created after an await, so make sure autoplay rules didn't leave it
    // suspended (a suspended context would read as endless silence).
    audioCtx.resume?.().catch(() => {});
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(stream).connect(analyser);

    const chunks = [];
    const session = { stream, recorder, audioCtx, timer: null, heardSpeech: false };
    sessionRef.current = session;

    // Volume-based end of speech: measure the room for a moment, then treat
    // anything clearly louder as speech, and a long enough quiet after it
    // as the end of the sentence.
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = performance.now();
    let noiseFloor = 0;
    let calibrationFrames = 0;
    let lastVoiceAt = startedAt;
    session.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const now = performance.now();
      if (now - startedAt < CALIBRATION_MS) {
        noiseFloor = (noiseFloor * calibrationFrames + rms) / (calibrationFrames + 1);
        calibrationFrames += 1;
        return;
      }
      if (rms > Math.max(0.012, noiseFloor * 3)) {
        if (!session.heardSpeech) setHeard(true);
        session.heardSpeech = true;
        lastVoiceAt = now;
      }
      const quietFor = now - lastVoiceAt;
      if ((session.heardSpeech && quietFor > SILENCE_MS) || (!session.heardSpeech && quietFor > NO_SPEECH_MS) || now - startedAt > MAX_RECORD_MS) {
        stop();
      }
    }, 100);

    recorder.ondataavailable = (e) => {
      if (e.data?.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const spoke = session.heardSpeech;
      cleanup(session);
      setRecording(false);
      if (!spoke) {
        if (!session.silent) setError('No se detectó voz. Inténtalo de nuevo.');
        return;
      }
      const type = recorder.mimeType || mimeType || 'audio/webm';
      upload(new Blob(chunks, { type }), type);
    };

    recorder.start(250);
    setRecording(true);
  }, [cleanup, stop, transcribing, upload]);

  // Release the microphone if the component using it goes away mid-recording.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      if (!session) return;
      session.recorder.onstop = null;
      if (session.recorder.state !== 'inactive') session.recorder.stop();
      cleanup(session);
    },
    [cleanup],
  );

  const reset = useCallback(() => setTranscript(''), []);

  return { supported: whisperSupported, recording, transcribing, transcript, heard, error, start, stop, reset };
}
