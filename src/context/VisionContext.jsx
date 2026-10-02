import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './SettingsContext';
import { useVoice } from './VoiceContext';
import { useChat } from './ChatContext';
import { VisionContext } from './visionState';
import { analyzeVisionFrame } from '../services/api';
import { cameraSupported, captureFrame, captureGray, createFeedVideo, describeCameraError, openCamera, readConsent, stopStream, writeConsent } from '../services/camera';
import { createAnnouncer, createEventTracker, describeEvent, motionScore, shouldAnalyze } from '../services/vigilance';
import { VIGILANCE_EVENT, visionBridge } from '../services/visionBridge';

const MAX_LOG = 20;
const MAX_ERRORS = 3;
// A hidden tab sends nothing; after this long hidden the camera is released.
const HIDDEN_STOP_MS = 2 * 60 * 1000;
const FIRST_LOOK_MS = 800;
const NO_SCENE = { summary: '', objects: [], provider: '' };

// "Modo Vigilancia": opens the camera and, every few seconds, sends a small
// frame to the AI (only when the scene moved) to learn what is in it. It runs
// while on any screen — the header chip shows it and turns it off — and stops
// by itself (time limit, hidden tab, camera unplugged, closing the page).
// Frames are sent and dropped: nothing is saved.
export function VisionProvider({ children }) {
  const { settings } = useSettings();
  const { speakWithSettings, speaking } = useVoice();
  const { status: chatStatus } = useChat();

  const [phase, setPhase] = useState('off'); // off | consent | starting | watching | error
  const [error, setError] = useState('');
  const [stream, setStream] = useState(null);
  const [scene, setScene] = useState(NO_SCENE);
  const [analyzing, setAnalyzing] = useState(false);
  const [note, setNote] = useState('');
  const [events, setEvents] = useState([]);

  const intervalMs = Math.min(15, Math.max(3, Number(settings.vision?.intervalSeconds) || 5)) * 1000;
  const maxMinutes = Math.min(30, Math.max(1, Number(settings.vision?.maxMinutes) || 10));

  // Latest values for timers and async work, which outlive a render.
  const live = useRef({});
  useEffect(() => {
    live.current = {
      intervalMs,
      maxMinutes,
      announce: settings.vision?.announce !== false,
      voiceOn: Boolean(settings.voice?.autoRead),
      speaking,
      chatIdle: chatStatus === 'idle',
      speak: speakWithSettings,
    };
  });

  const run = useRef({
    id: 0,
    starting: false,
    stream: null,
    video: null,
    prevGray: null,
    grayCanvas: null,
    lastAt: 0,
    errors: 0,
    abort: null,
    tick: 0,
    limit: 0,
    hidden: 0,
    eventId: 0,
    tracker: createEventTracker(),
    announcer: createAnnouncer(),
  });

  const stop = useCallback(({ error: failure = '', note: message = '' } = {}) => {
    const r = run.current;
    r.id += 1; // anything still running for the old session ends quietly
    r.starting = false;
    window.clearTimeout(r.tick);
    window.clearTimeout(r.limit);
    window.clearTimeout(r.hidden);
    r.abort?.abort();
    r.abort = null;
    stopStream(r.stream);
    r.stream = null;
    r.video = null;
    r.prevGray = null;
    setStream(null);
    setAnalyzing(false);
    setScene(NO_SCENE);
    setNote(message);
    setError(failure);
    setPhase(failure ? 'error' : 'off');
  }, []);
  const stopRef = useRef(stop);
  const tickRef = useRef(() => {});
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const handleEvents = useCallback((found) => {
    if (!found.length) return;
    const r = run.current;
    const at = Date.now();
    const entries = found.map((e) => ({ id: (r.eventId += 1), at, text: describeEvent(e), type: e.type, category: e.category }));
    setEvents((prev) => [...entries.reverse(), ...prev].slice(0, MAX_LOG));
    const s = live.current;
    if (!s.announce || !s.voiceOn || s.speaking || !s.chatIdle) return;
    for (const event of found) {
      const line = r.announcer.next(event, at);
      if (line) {
        s.speak(line, undefined, { filler: true });
        break;
      }
    }
  }, []);

  const tick = useCallback(
    async (id) => {
      const r = run.current;
      if (id !== r.id) return;
      let next = live.current.intervalMs;
      try {
        if (document.hidden) {
          setNote('En pausa: la pestaña está oculta');
          return;
        }
        r.grayCanvas ||= document.createElement('canvas');
        const gray = captureGray(r.video, r.grayCanvas);
        if (!gray) {
          setNote('Esperando la imagen de la cámara…');
          return;
        }
        const score = motionScore(r.prevGray, gray);
        const go = shouldAnalyze({ score, sinceLastMs: Date.now() - r.lastAt, hasPrevious: Boolean(r.prevGray), force: r.tracker.hasPending() });
        r.prevGray = gray;
        if (!go) {
          setNote('Sin cambios en la escena');
          return;
        }
        const frame = captureFrame(r.video);
        if (!frame) return;
        r.abort = new AbortController();
        setAnalyzing(true);
        setNote('Analizando…');
        const result = await analyzeVisionFrame(frame, r.abort.signal);
        if (id !== r.id) return;
        r.lastAt = Date.now();
        r.errors = 0;
        setScene({ summary: result.summary || '', objects: result.objects || [], provider: result.provider || '' });
        setNote('Escena al día');
        handleEvents(r.tracker.update(result.objects || []));
      } catch (err) {
        if (id !== r.id || err.name === 'AbortError') return;
        r.errors += 1;
        if (err.status === 503) {
          stopRef.current({ error: err.message });
          return;
        }
        if (err.status === 429) {
          next = Math.max(next, (err.retryAfter || 15) * 1000);
          setNote('Límite de la IA alcanzado: reintento en unos segundos');
        } else if (r.errors >= MAX_ERRORS) {
          stopRef.current({ error: `La vigilancia se apagó: ${err.message}` });
          return;
        } else {
          setNote(`No pude analizar: ${err.message}`);
        }
      } finally {
        if (id === r.id) {
          setAnalyzing(false);
          r.tick = window.setTimeout(() => tickRef.current(id), next);
        }
      }
    },
    [handleEvents],
  );
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const start = useCallback(async () => {
    const r = run.current;
    if (r.stream || r.starting) return true;
    if (!cameraSupported()) {
      setPhase('error');
      setError('Este navegador no permite usar la cámara.');
      return false;
    }
    if (!readConsent()) {
      setPhase('consent');
      return false;
    }
    r.id += 1;
    const id = r.id;
    r.starting = true;
    setPhase('starting');
    setError('');
    let media;
    try {
      media = await openCamera();
    } catch (err) {
      if (id === r.id) {
        r.starting = false;
        setPhase('error');
        setError(describeCameraError(err));
      }
      return false;
    }
    if (id !== r.id) {
      stopStream(media); // turned off while the browser was asking
      return false;
    }
    r.starting = false;
    r.stream = media;
    r.video = createFeedVideo(media);
    r.lastAt = 0;
    r.errors = 0;
    r.tracker.reset();
    r.announcer.reset();
    media.getVideoTracks()[0]?.addEventListener('ended', () => stopRef.current({ error: 'La cámara se desconectó.' }));
    setEvents([]);
    setScene(NO_SCENE);
    setStream(media);
    setPhase('watching');
    setNote('Observando…');
    r.tick = window.setTimeout(() => tickRef.current(id), FIRST_LOOK_MS);
    window.clearTimeout(r.limit);
    const minutes = live.current.maxMinutes;
    r.limit = window.setTimeout(() => stopRef.current({ note: `Vigilancia apagada: pasaron ${minutes} ${minutes === 1 ? "minuto" : "minutos"}.` }), minutes * 60 * 1000);
    return true;
  }, []);

  const toggle = useCallback(() => {
    if (run.current.stream || run.current.starting) stop({ note: 'Vigilancia desactivada.' });
    else start();
  }, [start, stop]);

  const grantConsent = useCallback(() => {
    writeConsent();
    start();
  }, [start]);

  const cancelConsent = useCallback(() => setPhase('off'), []);

  // The command ("Modo Vigilancia" / "desactiva el modo vigilancia") arrives as an event from the chat.
  useEffect(() => {
    const onCommand = (e) => {
      if (e.detail?.action === 'on') start();
      else if (e.detail?.action === 'off' && (run.current.stream || run.current.starting)) stop({ note: 'Vigilancia desactivada.' });
      else if (e.detail?.action === 'off') setPhase((p) => (p === 'consent' || p === 'error' ? 'off' : p));
    };
    window.addEventListener(VIGILANCE_EVENT, onCommand);
    return () => window.removeEventListener(VIGILANCE_EVENT, onCommand);
  }, [start, stop]);

  // What the chat needs to know: is the camera on, may it be opened, and the current picture.
  useEffect(() => {
    Object.assign(visionBridge, {
      isActive: () => Boolean(run.current.stream),
      hasConsent: readConsent,
      isSupported: cameraSupported,
      getFrame: async () => (run.current.video ? captureFrame(run.current.video, { withThumb: true }) : null),
    });
    return () =>
      Object.assign(visionBridge, {
        isActive: () => false,
        hasConsent: () => true,
        isSupported: () => true,
        getFrame: async () => null,
      });
  }, []);

  // Released when the page closes, or after a while in a hidden tab.
  useEffect(() => {
    const onHide = () => stopRef.current();
    const onVisibility = () => {
      const r = run.current;
      window.clearTimeout(r.hidden);
      if (document.hidden && r.stream) r.hidden = window.setTimeout(() => stopRef.current({ note: 'Vigilancia apagada: la pestaña estuvo oculta.' }), HIDDEN_STOP_MS);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
      stopRef.current();
    };
  }, []);

  const value = useMemo(
    () => ({
      phase,
      active: phase === 'watching',
      busy: phase === 'starting' || phase === 'watching',
      error,
      stream,
      scene,
      analyzing,
      note,
      events,
      maxMinutes,
      start,
      stop,
      toggle,
      grantConsent,
      cancelConsent,
    }),
    [phase, error, stream, scene, analyzing, note, events, maxMinutes, start, stop, toggle, grantConsent, cancelConsent],
  );

  return <VisionContext.Provider value={value}>{children}</VisionContext.Provider>;
}
