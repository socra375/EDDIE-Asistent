import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoice } from '../context/VoiceContext';
import { commandState, iceServers, sendCommand, sendSignal, takeSignals, viewFrame } from '../services/devices';
import { createNarrator } from '../services/narration';
import { createViewerRtc, rtcSupported } from '../services/rtc';
import { REMOTE_VIEW_EVENT } from '../services/remoteShare';
import Icon from '../layout/Icon';
import CameraAuth from '../components/CameraLock/CameraAuth';
import './RemoteViewer.css';

const POLL_MS = 1000;
const PREFS_KEY = 'eddie.remoteview';
const EVERY_CHOICES = [5, 10, 15, 30];
const IDLE_REPORT_MS = 30_000; // "sin novedades" is said this often (never in between)
const LOST_AFTER_MS = 10_000;
const MAX_REPORTS = 30;
const START_WAIT_MS = 20_000;
const MAX_ERRORS = 5;
const RTC_CONNECT_MS = 10_000; // no direct path by then: the one-picture-a-second view carries on
const RTC_RETRY_MS = 8_000;
const RTC_ATTEMPTS = 3;
const LIVE_STALE_S = 12; // the device says it is still there at least every 4 s
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { voice: raw.voice !== false, every: EVERY_CHOICES.includes(raw.every) ? raw.every : 5, compact: raw.compact === true };
  } catch {
    return { voice: true, every: 5, compact: false };
  }
}

const timeOf = (at) => new Intl.DateTimeFormat('es', { timeStyle: 'medium' }).format(at);

const catClass = (category) => (category === 'persona' ? 'person' : category === 'animal' ? 'animal' : 'thing');

// "Ver cámara" on another device (also what "activa la vigilancia en mi PC" opens): a floating window with what that device's
// camera sees (about one picture a second, with a box over each thing found)
// and what it says about it. Opened from Configuración → Dispositivos or when
// Eddie shows a device's camera ("enséñame lo que ve el Chromebook"); closing
// it tells the device to stop sharing and turn the camera off if this turned it on.
// While it is open Eddie also tells, out loud and every few seconds, what happens
// in that camera (someone comes in, leaves, the dog…): see services/narration.js.
export default function RemoteViewer() {
  const [view, setView] = useState(null); // { deviceId, name, attach }
  const [phase, setPhase] = useState('starting'); // starting | waiting | live | error
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState(null); // { url, meta, caption, at }
  const [now, setNow] = useState(() => Date.now());
  const [prefs, setPrefs] = useState(loadPrefs);
  const [reports, setReports] = useState([]); // [{ id, at, text, kind }] newest first
  const [videoStream, setVideoStream] = useState(null); // live video (WebRTC) when there is a direct path
  const [rtcLive, setRtcLive] = useState(false);
  const [liveMeta, setLiveMeta] = useState({ objects: [], summary: '', at: 0 }); // what the detector found, next to the video
  const rtcUp = useRef(false); // read by the picture loop: while live video is up it asks for no pictures
  const viewRef = useRef(null);
  const { speakWithSettings, speaking } = useVoice();
  const live = useRef({});
  useEffect(() => {
    live.current = { speak: speakWithSettings, speaking, prefs };
  });
  const narrator = useRef(createNarrator());
  const signal = useRef({ lastKey: null, lastAt: 0, lost: false, ever: false, id: 0 });

  const updatePrefs = (patch) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // The choice just isn't remembered.
      }
      return next;
    });

  useEffect(() => {
    const open = (e) => {
      const { deviceId, name, attach, close: closing } = e.detail || {};
      if (!deviceId) return;
      // Eddie (or the device) ended it: the server already told the device, nothing to send.
      if (closing) {
        if (viewRef.current?.deviceId === deviceId) {
          setView(null);
          setShot(null);
        }
        return;
      }
      setShot(null);
      setReports([]);
      setPhase(attach ? 'waiting' : 'auth');
      setMessage('');
      setView((current) => (current?.deviceId === deviceId ? current : { deviceId, name: name || 'el dispositivo', attach: Boolean(attach) }));
    };
    window.addEventListener(REMOTE_VIEW_EVENT, open);
    return () => window.removeEventListener(REMOTE_VIEW_EVENT, open);
  }, []);

  useEffect(() => {
    viewRef.current = view;
    if (!view) return undefined;
    // Switching a camera on needs the lock's proof first (one use); a view Eddie opened already had it.
    if (!view.attach && !view.token) return undefined;
    let alive = true;
    narrator.current.reset();
    signal.current = { lastKey: null, lastAt: 0, lost: false, ever: false, id: signal.current.id };
    rtcUp.current = false;

    // 1. Ask the device to share (unless Eddie already did).
    let startRtc = () => {};
    const begin = async () => {
      if (view.attach) {
        startRtc();
        return true;
      }
      try {
        const sent = await sendCommand(view.deviceId, 'view_start', view.token);
        // The offer can go at once: the device answers it as soon as its camera is on.
        startRtc();
        const started = Date.now();
        for (;;) {
          await wait(500);
          if (!alive) return;
          const s = await commandState(sent.id);
          if (s.status === 'done') return true;
          if (s.status === 'consent') {
            setMessage(s.text);
            return true;
          }
          if (s.status === 'error' || s.status === 'expired') throw new Error(s.text || 'El dispositivo no pudo compartir la cámara.');
          if (Date.now() - started > START_WAIT_MS) throw new Error(`${view.name} no respondió a tiempo. Puede que Eddie esté cerrado o en segundo plano allí.`);
        }
      } catch (err) {
        if (!alive) return false;
        // The proof was refused or ran out: ask for it again instead of giving up.
        if (['NEEDS_AUTH', 'NO_LOCK'].includes(err.code)) {
          setPhase('auth');
          setMessage(err.message);
          setView((v) => (v ? { ...v, token: '' } : v));
          return false;
        }
        setPhase('error');
        setMessage(err.message);
        return false;
      }
    };

    // What the detector found (next to the video, or in each picture): the boxes and the narration.
    const noteScene = (objects, key) => {
      signal.current.lastAt = Date.now();
      signal.current.ever = true;
      // Only a new look tells the narrator anything (the same one repeated would "confirm" a blur).
      if (key === undefined || key !== signal.current.lastKey) {
        signal.current.lastKey = key;
        narrator.current.push(objects || []);
      }
    };

    // 3. Live video, straight from that device (services/rtc.js). If it can't connect, the pictures carry on.
    let rtc = null;
    let rtcTimer = null;
    let attempts = 0;
    const stopRtc = (tell) => {
      window.clearTimeout(rtcTimer);
      rtc?.close({ tell });
      rtc = null;
      rtcUp.current = false;
      setRtcLive(false);
      setVideoStream(null);
    };
    const tryRtc = async () => {
      if (!rtcSupported() || !alive || attempts >= RTC_ATTEMPTS || rtc) return;
      attempts += 1;
      let servers;
      try {
        servers = (await iceServers()).iceServers;
      } catch {
        servers = [{ urls: 'stun:stun.l.google.com:19302' }];
      }
      if (!alive) return;
      const retry = () => {
        window.clearTimeout(rtcTimer);
        rtcTimer = window.setTimeout(tryRtc, RTC_RETRY_MS);
      };
      const connection = createViewerRtc({
        iceServers: servers,
        post: (kind, payload) => sendSignal({ role: 'viewer', deviceId: view.deviceId, kind, payload }),
        take: () => takeSignals({ role: 'viewer', id: view.deviceId }),
        onStream: (stream) => alive && rtc === connection && setVideoStream(stream),
        onMeta: (m) => {
          if (!alive || rtc !== connection) return;
          setLiveMeta({ objects: Array.isArray(m.objects) ? m.objects : [], summary: typeof m.summary === 'string' ? m.summary : '', at: Date.now() });
          if (m.dup) signal.current.lastAt = Date.now();
          else noteScene(m.objects, m.seq);
        },
        onState: (state) => {
          if (!alive || rtc !== connection) return;
          if (state === 'connected') {
            window.clearTimeout(rtcTimer);
            rtcUp.current = true;
            setRtcLive(true);
            setPhase('live');
            setMessage('');
          } else if (state === 'disconnected') {
            // Often back in a moment; meanwhile the pictures take over.
            rtcUp.current = false;
          } else if (state === 'failed' || state === 'closed') {
            stopRtc(false);
            retry();
          }
        },
      });
      rtc = connection;
      rtcTimer = window.setTimeout(() => {
        if (rtc === connection && !rtcUp.current) {
          stopRtc(true);
          retry();
        }
      }, RTC_CONNECT_MS);
      connection.start().catch(() => {
        if (rtc === connection) {
          stopRtc(false);
          retry();
        }
      });
    };

    // 2. Take its pictures (asking is also what tells it that somebody is watching).
    let errors = 0;
    const poll = async () => {
      while (alive) {
        // With live video up there is no need to ask for pictures.
        if (rtcUp.current) {
          await wait(500);
          continue;
        }
        try {
          const data = await viewFrame(view.deviceId);
          if (!alive) return;
          errors = 0;
          if (data.frame) {
            const url = `data:image/jpeg;base64,${data.frame}`;
            await new Promise((resolve) => {
              const img = new Image();
              img.onload = resolve;
              img.onerror = resolve;
              img.src = url; // decoded before it replaces the one on screen: no flicker
            });
            if (!alive) return;
            setShot({ url, meta: data.meta, caption: data.caption, at: Date.now() - (data.ageMs || 0) });
            noteScene(data.meta?.objects, data.meta?.seq || data.frame);
            setPhase('live');
            setMessage('');
          } else if (!data.online) {
            setPhase((p) => (p === 'error' ? p : 'waiting'));
            setMessage(`${view.name} parece apagado o sin conexión.`);
          } else {
            setPhase((p) => (p === 'live' || p === 'error' ? p : 'waiting'));
          }
        } catch (err) {
          errors += 1;
          if (errors >= MAX_ERRORS && alive) {
            setPhase('error');
            setMessage(err.message);
            return;
          }
        }
        await wait(POLL_MS);
      }
    };

    startRtc = tryRtc;
    begin();
    poll();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000); // "hace 2 s"
    return () => {
      alive = false;
      window.clearInterval(ticker);
      stopRtc(true);
    };
  }, [view]);

  // Every few seconds: say what happened in that camera (and say if the signal is lost or back).
  useEffect(() => {
    if (!view) return undefined;
    const timer = window.setInterval(() => {
      const s = signal.current;
      const { speak, speaking: busy, prefs: p } = live.current;
      if (!s.ever) return;
      const at = Date.now();
      // Eddie is answering something else: the report waits for his turn instead of cutting in.
      if (p.voice && busy) return;
      let report = null;
      if (at - s.lastAt > LOST_AFTER_MS) {
        if (!s.lost) {
          s.lost = true;
          report = { kind: 'lost', text: `${view.name}: perdí la señal de la cámara.` };
        }
      } else {
        if (s.lost) {
          s.lost = false;
          report = { kind: 'back', text: `${view.name}: recuperé la señal.` };
        }
        report = report || narrator.current.report({ now: at, name: view.name, idleEveryMs: IDLE_REPORT_MS });
      }
      if (!report) return;
      s.id += 1;
      setReports((prev) => [{ id: s.id, at, ...report }, ...prev].slice(0, MAX_REPORTS));
      if (p.voice) speak(report.text, undefined, { filler: true });
    }, prefs.every * 1000);
    return () => window.clearInterval(timer);
  }, [view, prefs.every]);

  // The screen stays on while a camera is being watched (a phone left propped up).
  useEffect(() => {
    if (!view || !navigator.wakeLock) return undefined;
    let lock = null;
    let ended = false;
    const take = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        lock = null; // refused (battery saver, hidden page): nothing to do
      }
    };
    take();
    const onVisible = () => document.visibilityState === 'visible' && !ended && take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ended = true;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [view]);

  const close = useCallback(() => {
    const current = viewRef.current;
    setView(null);
    setShot(null);
    setLiveMeta({ objects: [], summary: '', at: 0 });
    // The device stops sharing and, if the viewer had turned its camera on, switches it off.
    if (current) sendCommand(current.deviceId, 'view_stop').catch(() => {});
  }, []);

  useEffect(() => {
    if (!view) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, close]);

  if (!view) return null;
  const video = rtcLive && videoStream;
  const lastSeen = video ? liveMeta.at : shot?.at || 0;
  const age = lastSeen ? Math.max(0, Math.round((now - lastSeen) / 1000)) : 0;
  const stale = phase === 'live' && age > (video ? LIVE_STALE_S : 6);
  const objects = (video ? liveMeta.objects : shot?.meta?.objects) || [];
  const caption = video ? liveMeta.summary : shot?.caption;
  const hasPicture = Boolean(video || shot);
  const needsAuth = !view.attach && !view.token;

  return (
    <aside className="remote-view" role="dialog" aria-label={`Cámara de ${view.name}`}>
      <header className="remote-view__head">
        <strong>CÁMARA · {view.name}</strong>
        <span className={`chip ${phase === 'live' && !stale ? 'on' : phase === 'error' ? 'bad' : 'warn'}`}>
          {needsAuth ? 'AUTORIZACIÓN' : phase === 'live' ? (stale ? `SIN SEÑAL · ${age} s` : video ? 'EN VIVO · VIDEO' : age <= 2 ? 'EN VIVO' : `HACE ${age} s`) : phase === 'error' ? 'ERROR' : 'CONECTANDO…'}
        </span>
        <button type="button" className="remote-view__close" onClick={close} aria-label="Cerrar la cámara remota" title="Cerrar (el dispositivo deja de transmitir)">
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className="remote-view__controls">
        <button type="button" className={`chip chip--button ${prefs.voice ? 'on' : ''}`} aria-pressed={prefs.voice} onClick={() => updatePrefs({ voice: !prefs.voice })} title="Eddie cuenta en voz alta lo que pasa">
          {prefs.voice ? '🔊 VOZ ON' : '🔇 VOZ OFF'}
        </button>
        <label className="remote-view__every">
          <span>Reporta cada</span>
          <select className="select" value={prefs.every} onChange={(e) => updatePrefs({ every: Number(e.target.value) })} aria-label="Cada cuántos segundos cuenta lo que ve">
            {EVERY_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} s
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="chip chip--button" onClick={() => updatePrefs({ compact: !prefs.compact })} aria-pressed={prefs.compact}>
          {prefs.compact ? 'MOSTRAR IMAGEN' : 'OCULTAR IMAGEN'}
        </button>
      </div>

      <div className="remote-view__stage" hidden={prefs.compact && phase === 'live'}>
        {needsAuth ? (
          <div className="remote-view__wait remote-view__auth">
            <Icon name="camera" size={34} />
            <p>Para encender la cámara de {view.name} confirma que eres tú.</p>
            <CameraAuth onToken={(token) => token && setView((v) => (v ? { ...v, token } : v))} />
            {message && <p className="remote-view__note">{message}</p>}
          </div>
        ) : hasPicture ? (
          <>
            {video ? (
              <video
                ref={(el) => {
                  if (el && el.srcObject !== videoStream) el.srcObject = videoStream;
                }}
                className={stale ? 'remote-view__img remote-view__img--stale' : 'remote-view__img'}
                autoPlay
                muted
                playsInline
                aria-label={`Video en vivo de la cámara de ${view.name}`}
              />
            ) : (
              <img src={shot.url} alt={`Lo que ve la cámara de ${view.name}`} className={stale ? 'remote-view__img remote-view__img--stale' : 'remote-view__img'} />
            )}
            {objects
              .filter((o) => o.box)
              .map((o, i) => (
                <span
                  key={`${o.label}-${i}`}
                  className={`camera-box camera-box--${catClass(o.category)}`}
                  style={{ top: `${o.box[0] / 10}%`, left: `${o.box[1] / 10}%`, height: `${(o.box[2] - o.box[0]) / 10}%`, width: `${(o.box[3] - o.box[1]) / 10}%` }}
                >
                  <i>
                    {o.label}
                    {o.count > 1 ? ` ×${o.count}` : ''}
                  </i>
                </span>
              ))}
          </>
        ) : (
          <div className="remote-view__wait">
            <Icon name="camera" size={34} />
            <p>{phase === 'error' ? message : message || (phase === 'starting' ? `Pidiéndole la cámara a ${view.name}…` : 'Esperando la primera imagen…')}</p>
          </div>
        )}
      </div>

      {caption && <p className="remote-view__caption">{caption}</p>}
      {hasPicture && !video && rtcSupported() && phase === 'live' && <p className="remote-view__note remote-view__note--quiet">Imagen cada segundo (intentando conectar el video en vivo…)</p>}
      {hasPicture && message && <p className="remote-view__note">{message}</p>}
      {objects.length > 0 && (
        <ul className="remote-view__list" aria-label="Lo que se ve">
          {objects.slice(0, 8).map((o, i) => (
            <li key={`${o.label}-${i}`} className={`camera-list__item camera-list__item--${catClass(o.category)}`}>
              <b>
                {o.label}
                {o.count > 1 ? ` ×${o.count}` : ''}
              </b>
              <span>{Math.round((o.confidence || 0) * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
      <h3 className="remote-view__log-title">REPORTE</h3>
      {reports.length === 0 ? (
        <p className="remote-view__note remote-view__note--quiet">Eddie irá contando aquí (y en voz alta) lo que pase.</p>
      ) : (
        <ul className="remote-view__log" aria-label="Lo que ha pasado">
          {reports.slice(0, 8).map((r) => (
            <li key={r.id} className={`remote-view__log-item remote-view__log-item--${r.kind}`}>
              <time>{timeOf(r.at)}</time> {r.text}
            </li>
          ))}
        </ul>
      )}
      <p className="remote-view__hint">El video va directo de un equipo a otro (si no hay camino directo, pasa una imagen por segundo por tu cuenta de Eddie, sin guardarse). Sigue mientras esta ventana esté abierta y el otro equipo encendido (máximo 8 h); en ese equipo se ve el chip «TRANSMITIENDO». Mantén esta pantalla encendida y con Eddie abierto para oír los reportes.</p>
    </aside>
  );
}
