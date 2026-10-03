import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from './SettingsContext';
import { useVoice } from './VoiceContext';
import { useChat } from './ChatContext';
import { VisionContext } from './visionState';
import { analyzeVisionFrame } from '../services/api';
import { detectLocal, loadLocalDetector, localBackend } from '../services/localVision';
import { describeScene, sceneFromPredictions } from '../services/localScene';
import { cameraSupported, captureFrame, captureGray, createFeedVideo, describeCameraError, openCamera, readConsent, stopStream, writeConsent } from '../services/camera';
import { createAnnouncer, createEventTracker, describeEvent, motionScore, shouldAnalyze } from '../services/vigilance';
import { VIGILANCE_EVENT, visionBridge } from '../services/visionBridge';
import { shareState } from '../services/remoteShare';

const MAX_LOG = 20;
const MAX_ERRORS = 3;
// A hidden tab sends nothing; after this long hidden the camera is released.
const HIDDEN_STOP_MS = 2 * 60 * 1000;
const FIRST_LOOK_MS = 500;
// The detector in this browser costs only a bit of CPU, so it looks again as soon
// as it can (about 2.5 times what one look takes, at least this often) instead
// of waiting the full interval; the interval is the ceiling, and the pace of
// the cloud AI.
// A camera watched from another device keeps going past the usual time limit, up to this long.
const REMOTE_HARD_CAP_MS = 8 * 60 * 60 * 1000;
const LOCAL_MIN_MS = 1000;
// The picture shared with the device that is watching: small, a few tens of KB.
const SHARE_SIDE = 480;
const SHARE_QUALITY = 0.55;
const LOCAL_LOAD = 2.5;
const NO_SCENE = { summary: '', objects: [], extras: [], provider: '' };
// With the local detector doing the watching, the cloud AI is only asked now
// and then for a better description (and the materials), to spare its free quota.
const CLOUD_EVERY_MS = 20_000;
const CLOUD_SUMMARY_FRESH_MS = 45_000;

// "Modo Vigilancia": opens the camera and, every few seconds (only when the
// scene moved), learns what is in it. The default engine is a detector that
// runs in this browser — free, no keys, no quota, nothing leaves the device —
// optionally helped, every ~20 s, by a cloud AI (Gemini, Groq or Claude,
// whichever is set up) for a better description and the materials. "Solo en
// la nube" uses the AI for everything. It runs while on any screen — the
// header chip shows it and turns it off — and stops by itself (time limit,
// hidden tab, camera unplugged, closing the page). Nothing is saved.
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
  const [perf, setPerf] = useState({ ms: 0, backend: '' }); // how long one look takes in this browser

  const intervalMs = Math.min(15, Math.max(3, Number(settings.vision?.intervalSeconds) || 5)) * 1000;
  const maxMinutes = Math.min(30, Math.max(1, Number(settings.vision?.maxMinutes) || 10));

  // Latest values for timers and async work, which outlive a render.
  const live = useRef({});
  useEffect(() => {
    live.current = {
      intervalMs,
      maxMinutes,
      engine: settings.vision?.engine || 'auto',
      announce: settings.vision?.announce !== false,
      voiceOn: Boolean(settings.voice?.autoRead),
      speaking,
      chatIdle: chatStatus === 'idle',
      speak: speakWithSettings,
      phase,
      error,
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
    quiet: false,
    tracker: createEventTracker(),
    announcer: createAnnouncer(),
    scene: NO_SCENE,
    model: null,
    localFailed: false,
    cloudAt: 0,
    cloudUntil: 0,
    cloudBusy: false,
    cloudOff: false,
    cloudAbort: null,
    cloudSummaryAt: 0,
  });

  const commitScene = useCallback((next) => {
    run.current.scene = next;
    run.current.sceneSeq = (run.current.sceneSeq || 0) + 1; // each look is a new sample for whoever is watching
    setScene(next);
  }, []);

  const stop = useCallback(({ error: failure = '', note: message = '' } = {}) => {
    const r = run.current;
    r.id += 1; // anything still running for the old session ends quietly
    r.quiet = false;
    r.starting = false;
    window.clearTimeout(r.tick);
    window.clearTimeout(r.limit);
    window.clearTimeout(r.hidden);
    r.abort?.abort();
    r.abort = null;
    r.cloudAbort?.abort();
    r.cloudAbort = null;
    r.cloudBusy = false;
    r.scene = NO_SCENE;
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
    // A camera started from another device (or being watched from one) is narrated by THAT device, not here:
    // the PC left at home says nothing out loud.
    if (r.quiet || shareState().sharing) return;
    for (const event of found) {
      const line = r.announcer.next(event, at);
      if (line) {
        s.speak(line, undefined, { filler: true });
        break;
      }
    }
  }, []);

  // Asks the cloud AI for a description now and then (never while one is
  // pending, never faster than CLOUD_EVERY_MS, and not at all when it isn't
  // set up). Its summary and the materials it sees are added to the scene the
  // local detector made; its failures never stop the watching.
  const enrich = useCallback(
    (id) => {
      const r = run.current;
      const now = Date.now();
      if (r.cloudBusy || r.cloudOff || now < r.cloudUntil || now - r.cloudAt < CLOUD_EVERY_MS) return;
      const frame = captureFrame(r.video);
      if (!frame) return;
      r.cloudBusy = true;
      r.cloudAt = now;
      r.cloudAbort = new AbortController();
      analyzeVisionFrame(frame, r.cloudAbort.signal)
        .then((result) => {
          if (id !== r.id) return;
          const known = new Set(r.scene.objects.map((o) => o.label));
          // What the detector doesn't know (materials, other things) rides along, without boxes.
          const extras = (result.objects || [])
            .filter((o) => o.material || o.category === 'material' || !known.has(o.label))
            .slice(0, 6)
            .map((o) => {
              const { box, ...rest } = o;
              return box ? rest : o;
            });
          r.cloudSummaryAt = Date.now();
          commitScene({ ...r.scene, summary: result.summary || r.scene.summary, extras, provider: `local + ${result.provider}` });
        })
        .catch((err) => {
          if (id !== r.id || err.name === 'AbortError') return;
          if (err.status === 503) {
            r.cloudOff = true;
            setNote('Sin IA en la nube (falta una clave): sigo con el detector de este equipo.');
          } else {
            r.cloudUntil = Date.now() + (err.status === 429 ? Math.max(30, err.retryAfter || 0) : 60) * 1000;
          }
        })
        .finally(() => {
          r.cloudBusy = false;
        });
    },
    [commitScene],
  );

  const tick = useCallback(
    async (id) => {
      const r = run.current;
      if (id !== r.id) return;
      // While the local detector does the watching it looks again quickly (see LOCAL_MIN_MS).
      let next = r.localMs ? Math.min(live.current.intervalMs, Math.max(LOCAL_MIN_MS, r.localMs * LOCAL_LOAD)) : live.current.intervalMs;
      try {
        // Another device is watching this camera (say, a phone used as the screen of a PC left at
        // home): the camera keeps running with the tab in the background. A browser doesn't freeze a
        // page that is capturing the camera.
        if (document.hidden && !shareState().sharing) {
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
        const engine = live.current.engine;

        // 1. The detector in this browser (unless "solo en la nube").
        let local = null;
        if (engine !== 'cloud' && !r.localFailed) {
          setAnalyzing(true);
          setNote(r.model ? 'Analizando…' : 'Cargando el detector (la primera vez baja unos 18 MB)…');
          try {
            r.model ||= await loadLocalDetector();
            if (id !== r.id) return;
            const began = performance.now();
            const predictions = await detectLocal(r.model, r.video);
            if (id !== r.id) return;
            const took = performance.now() - began;
            r.localMs = r.localMs ? r.localMs * 0.6 + took * 0.4 : took;
            next = Math.min(live.current.intervalMs, Math.max(LOCAL_MIN_MS, r.localMs * LOCAL_LOAD));
            if (!r.perfShown || Math.abs(r.localMs - r.perfShown) > Math.max(100, r.perfShown * 0.25)) {
              r.perfShown = r.localMs;
              localBackend().then((backend) => id === r.id && setPerf({ ms: Math.round(r.localMs), backend })).catch(() => {});
            }
            local = sceneFromPredictions(predictions, r.video.videoWidth, r.video.videoHeight);
          } catch (err) {
            if (id !== r.id) return;
            if (engine === 'local') {
              stopRef.current({ error: `No pude cargar el detector de este equipo (${err.message || 'sin conexión'}). Se descarga la primera vez: revisa tu conexión o elige otro motor en Configuración.` });
              return;
            }
            r.localFailed = true;
            setNote('El detector de este equipo no está disponible; uso la IA en la nube.');
          }
        }

        if (local) {
          r.lastAt = Date.now();
          r.errors = 0;
          const fresh = Date.now() - r.cloudSummaryAt < CLOUD_SUMMARY_FRESH_MS;
          commitScene({
            summary: fresh ? r.scene.summary : local.summary,
            objects: local.objects,
            extras: fresh ? r.scene.extras : [],
            provider: fresh ? r.scene.provider : 'local',
          });
          setNote('Escena al día');
          handleEvents(r.tracker.update(local.objects));
          if (engine === 'auto') enrich(id);
          return;
        }

        // 2. The cloud AI does everything ("solo en la nube", or no local detector).
        const frame = captureFrame(r.video);
        if (!frame) return;
        r.abort = new AbortController();
        setAnalyzing(true);
        setNote('Analizando…');
        const result = await analyzeVisionFrame(frame, r.abort.signal);
        if (id !== r.id) return;
        r.lastAt = Date.now();
        r.errors = 0;
        commitScene({ summary: result.summary || '', objects: result.objects || [], extras: [], provider: result.provider || '' });
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
    [handleEvents, enrich, commitScene],
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
    // The detector starts loading now, while the camera asks for permission and warms up.
    if (live.current.engine !== 'cloud') loadLocalDetector().then((model) => id === r.id && (r.model ||= model)).catch(() => {});
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
    r.localFailed = false;
    r.cloudAt = 0;
    r.cloudUntil = 0;
    r.cloudOff = false;
    r.cloudSummaryAt = 0;
    r.scene = NO_SCENE;
    r.localMs = 0;
    r.perfShown = 0;
    setPerf({ ms: 0, backend: '' });
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
    const began = Date.now();
    // The time limit ends the camera — unless another device is watching it right now (a phone used as the
    // screen of a PC left at home): then it goes on, checking again every few minutes, up to REMOTE_HARD_CAP.
    const onLimit = () => {
      if (shareState().sharing && Date.now() - began < REMOTE_HARD_CAP_MS) {
        r.limit = window.setTimeout(onLimit, 5 * 60 * 1000);
        return;
      }
      stopRef.current({ note: `Vigilancia apagada: pasaron ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.` });
    };
    r.limit = window.setTimeout(onLimit, minutes * 60 * 1000);
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
      if (e.detail?.action === 'on') {
        // Started by an order from another device: no voice announcements on this one. A local start (chat, button) keeps them.
        if (!run.current.stream && !run.current.starting) run.current.quiet = e.detail?.remote === true;
        start();
      } else if (e.detail?.action === 'off' && (run.current.stream || run.current.starting)) stop({ note: 'Vigilancia desactivada.' });
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
      engine: () => live.current.engine || 'auto',
      describe: () => describeScene(run.current.scene),
      status: () => ({ phase: live.current.phase, error: live.current.error }),
      snapshot: () => {
        const r = run.current;
        const frame = r.video ? captureFrame(r.video, { side: SHARE_SIDE, quality: SHARE_QUALITY }) : null;
        if (!frame) return null;
        const { summary, objects, extras } = r.scene;
        return { data: frame.data, meta: { summary, objects: [...objects, ...(extras || [])], width: r.video.videoWidth, height: r.video.videoHeight, seq: r.sceneSeq || 0 } };
      },
      // What was found, without a picture (sent next to the live video), and the camera's own stream.
      scene: () => {
        const r = run.current;
        if (!r.stream) return null;
        const { summary, objects, extras } = r.scene;
        return { summary, objects: [...objects, ...(extras || [])], seq: r.sceneSeq || 0 };
      },
      stream: () => run.current.stream || null,
    });
    return () =>
      Object.assign(visionBridge, {
        isActive: () => false,
        hasConsent: () => true,
        isSupported: () => true,
        getFrame: async () => null,
        engine: () => 'auto',
        describe: () => '',
        status: () => ({ phase: 'off', error: '' }),
        snapshot: () => null,
        scene: () => null,
        stream: () => null,
      });
  }, []);

  // Released when the page closes, or after a while in a hidden tab.
  useEffect(() => {
    const onHide = () => stopRef.current();
    const onVisibility = () => {
      const r = run.current;
      window.clearTimeout(r.hidden);
      if (document.hidden && r.stream && !shareState().sharing) r.hidden = window.setTimeout(() => stopRef.current({ note: 'Vigilancia apagada: la pestaña estuvo oculta.' }), HIDDEN_STOP_MS);
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
      engine: settings.vision?.engine || 'auto',
      error,
      stream,
      scene,
      analyzing,
      note,
      events,
      perf,
      maxMinutes,
      start,
      stop,
      toggle,
      grantConsent,
      cancelConsent,
    }),
    [phase, settings.vision?.engine, error, stream, scene, analyzing, note, events, perf, maxMinutes, start, stop, toggle, grantConsent, cancelConsent],
  );

  return <VisionContext.Provider value={value}>{children}</VisionContext.Provider>;
}
