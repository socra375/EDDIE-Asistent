import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import { BOOT_GAUGES, BOOT_REPLAY_EVENT, BOOT_SEEN_KEY, shouldShowBoot } from '../services/boot';
import { useMorningBrief } from './useMorningBrief';
import './Boot.css';

const LEAVE_MS = 650;
const AFTER_MS = 1400; // the screen stays a moment after the last word
const FAILSAFE_MS = 150_000; // whatever happens, it leaves
const BLOCKED_MS = 2500; // no piece started by then: the browser has not let Eddie speak yet
const SPARKS = Array.from({ length: 28 }, (_, i) => ({ angle: (360 / 28) * i, reach: 150 + ((i * 53) % 90), delay: (i % 7) * 0.025 }));
const COILS = Array.from({ length: 10 }, (_, i) => i);
const TITLE = 'E.D.D.I.E.'.split('');

const CALENDAR_STATE = {
  loading: 'CARGANDO',
  ok: 'LISTA',
  off: 'APAGADA',
  needs_login: 'INICIA SESIÓN',
  needs_connect: 'SIN CONECTAR',
  error: 'SIN RESPUESTA',
};
const CALENDAR_NOTE = {
  loading: 'Cargando…',
  ok: null,
  off: 'Desactivada en Conectores',
  needs_login: 'Inicia sesión con Google para verla',
  needs_connect: 'Conecta Google Calendar en Conectores',
  error: 'No pude leerla ahora',
};
const WEATHER_STATE = { loading: 'CARGANDO', ok: 'LISTO', none: 'SIN UBICACIÓN', error: 'SIN DATOS' };

function reducedMotion() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function storage(action, key, value) {
  try {
    if (action === 'get') return window.sessionStorage.getItem(key);
    window.sessionStorage.setItem(key, value);
  } catch {
    // Without storage it just plays on every load.
  }
  return null;
}

const pct = (minutes) => `${(minutes / 1440) * 100}%`;

// The arc reactor: rings that draw themselves and spin up, the ten coils, the
// triangle and the core that lights.
function Reactor() {
  return (
    <svg className="boot__reactor" viewBox="0 0 400 400">
      <defs>
        <radialGradient id="boot-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="var(--core-soft, var(--accent-2))" />
          <stop offset="100%" stopColor="var(--core, var(--accent))" stopOpacity="0.2" />
        </radialGradient>
      </defs>
      <g className="boot__ring boot__ring--ticks">
        <circle cx="200" cy="200" r="186" pathLength="100" />
      </g>
      <g className="boot__ring boot__ring--segments">
        <circle cx="200" cy="200" r="166" pathLength="100" />
      </g>
      <circle className="boot__draw boot__draw--outer" cx="200" cy="200" r="150" pathLength="100" />
      <g className="boot__coils">
        {COILS.map((i) => (
          <g key={i} transform={`rotate(${i * 36} 200 200)`}>
            <rect x="188" y="84" width="24" height="42" rx="2" style={{ '--i': i }} />
          </g>
        ))}
      </g>
      <circle className="boot__draw boot__draw--inner" cx="200" cy="200" r="66" pathLength="100" />
      <polygon className="boot__draw boot__draw--triangle" points="200,152 242,224 158,224" pathLength="100" />
      <circle className="boot__core" cx="200" cy="200" r="26" fill="url(#boot-core)" />
    </svg>
  );
}

// One card of the morning brief; it lights up when Eddie gets to it.
function Card({ on, title, children }) {
  return (
    <section className={`boot__card ${on ? 'is-on' : ''}`} aria-hidden={!on}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// The start-up animation: a black screen where a reactor ignites, the system
// reports in, and Eddie greets — then the screen opens onto the app. While it
// runs, Eddie reads the morning brief (date, weather, agenda, tasks) with the
// real data, and each card appears when he talks about it. Any tap, click or
// key skips it. Plays when Eddie is opened (see services/boot.js).
export default function BootSplash() {
  const { settings } = useSettings();
  const voice = useVoice();
  const [phase, setPhase] = useState(() => {
    const shortcut = new URLSearchParams(window.location.search).has('accion');
    return shouldShowBoot({ enabled: settings.display?.boot !== false, seen: storage('get', BOOT_SEEN_KEY) === '1', shortcut }) ? 'run' : 'off';
  });
  const [run, setRun] = useState(0);
  const [current, setCurrent] = useState(-1); // the piece of the brief Eddie is saying
  const [blocked, setBlocked] = useState(false); // the browser would not let Eddie speak
  const brief = useMorningBrief(phase !== 'off');
  const started = useRef(false);
  const texts = useRef([]);
  const timers = useRef([]);
  const leaveRef = useRef(() => {});
  const speakingRef = useRef(false);

  const clearTimers = useCallback(() => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  }, []);

  useEffect(() => {
    if (phase === 'run') storage('set', BOOT_SEEN_KEY, '1');
  }, [phase]);

  const leave = useCallback(() => {
    clearTimers();
    if (speakingRef.current) voice.stopSpeaking?.();
    speakingRef.current = false;
    setPhase((p) => (p === 'run' ? 'leave' : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers]);
  leaveRef.current = leave;

  // Without the voice: each piece on its own time, then leave.
  const silentFrom = useCallback(
    (from) => {
      const step = reducedMotion() ? 1600 : 3800;
      const count = texts.current.length;
      for (let i = from; i < count; i += 1) {
        timers.current.push(window.setTimeout(() => setCurrent(i), (i - from) * step));
      }
      timers.current.push(window.setTimeout(() => leaveRef.current(), (count - from) * step + AFTER_MS));
    },
    [],
  );

  // Eddie reads the brief. If the browser does not let him speak (it needs a
  // tap first), the screen carries on in silence and offers a button to hear it.
  const startVoice = useCallback(
    (fromStart = true) => {
      clearTimers();
      setBlocked(false);
      if (fromStart) setCurrent(-1);
      speakingRef.current = true;
      let heard = false;
      timers.current.push(
        window.setTimeout(() => {
          if (heard) return;
          speakingRef.current = false;
          voice.stopSpeaking?.();
          setBlocked(true);
          silentFrom(0);
        }, BLOCKED_MS),
      );
      voice.speakPiecesWithSettings(
        texts.current,
        (i) => {
          heard = true;
          setBlocked(false);
          setCurrent(i);
        },
        () => {
          speakingRef.current = false;
          timers.current.push(window.setTimeout(() => leaveRef.current(), AFTER_MS));
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clearTimers, silentFrom],
  );

  // Once the real data is in, the brief starts.
  useEffect(() => {
    if (phase !== 'run' || !brief.brief || started.current) return;
    started.current = true;
    texts.current = brief.brief.pieces.map((p) => p.text);
    if (settings.voice.autoRead && voice.ttsSupported) startVoice(true);
    else silentFrom(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, brief.brief]);

  // The whole thing ends by itself, however it goes.
  useEffect(() => {
    if (phase !== 'run') return undefined;
    const failsafe = window.setTimeout(() => leaveRef.current(), FAILSAFE_MS);
    return () => window.clearTimeout(failsafe);
  }, [phase, run]);

  useEffect(() => {
    if (phase === 'leave') {
      const timer = window.setTimeout(() => setPhase('off'), LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  // Any key skips it.
  useEffect(() => {
    if (phase !== 'run') return undefined;
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [phase, leave]);

  // "Ver animación de inicio" in Configuración.
  useEffect(() => {
    const replay = () => {
      clearTimers();
      started.current = false;
      setCurrent(-1);
      setBlocked(false);
      setRun((n) => n + 1);
      setPhase('run');
    };
    window.addEventListener(BOOT_REPLAY_EVENT, replay);
    return () => window.removeEventListener(BOOT_REPLAY_EVENT, replay);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  if (phase === 'off') return null;

  const view = brief.brief?.view;
  const hasBrief = Boolean(brief.brief);
  const spoken = current >= 0 ? texts.current[current] : '';
  const voiceLabel = !voice.ttsSupported ? 'SIN VOZ' : !settings.voice.autoRead ? 'SILENCIADA' : voice.ttsEngine === 'elevenlabs' ? 'ELEVENLABS' : 'NAVEGADOR';
  const log = [
    ['NÚCLEO DE ARCO', 'ESTABLE'],
    ['CONEXIÓN', brief.online ? 'EN LÍNEA' : 'SIN RED'],
    ['PROTOCOLO DE VOZ', voiceLabel],
    ['AGENDA', CALENDAR_STATE[brief.sources.calendar] || 'SIN DATOS'],
    ['CLIMA', WEATHER_STATE[brief.sources.weather] || 'SIN DATOS'],
    ['TAREAS', `${brief.pendingTasks} PENDIENTES`],
  ];
  const gauges = [
    { label: BOOT_GAUGES[0], text: brief.battery ? `${brief.battery.level}%` : '—', value: brief.battery ? brief.battery.level / 100 : 0 },
    { label: BOOT_GAUGES[1], text: brief.online ? 'EN LÍNEA' : 'SIN RED', value: brief.online ? 1 : 0 },
    { label: BOOT_GAUGES[2], text: `${Math.round((brief.loaded / brief.total) * 100)}%`, value: brief.loaded / brief.total },
  ];
  const agendaNote = CALENDAR_NOTE[brief.sources.calendar];

  return (
    <div key={run} className={`boot boot--${phase} ${hasBrief ? 'boot--brief' : ''}`} onClick={leave} role="presentation" aria-hidden="true">
      <div className="boot__grid" />
      <div className="boot__vignette" />
      <span className="boot__scan" />
      {['tl', 'tr', 'bl', 'br'].map((c) => (
        <span key={c} className={`boot__corner boot__corner--${c}`} />
      ))}
      <p className="boot__top">PROTOCOLO DE INICIO</p>

      <div className="boot__stage">
        <div className="boot__halo" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="boot__shock" style={{ '--i': i }} />
        ))}
        <div className="boot__sparks">
          {SPARKS.map((s) => (
            <i key={s.angle} style={{ '--a': `${s.angle}deg`, '--reach': `${s.reach}px`, '--delay': `${s.delay}s` }} />
          ))}
        </div>
        <Reactor />
      </div>

      <h1 className="boot__title">
        {TITLE.map((ch, i) => (
          <span key={i} style={{ '--i': i }}>
            {ch}
          </span>
        ))}
      </h1>
      <p className="boot__greeting">{view ? view.date.greeting : 'Cargando tu día…'}{view && view.date.greeting ? ', señor.' : ''}</p>
      {hasBrief ? (
        <>
          <p className="boot__date">{current >= 0 ? view.date.line : ' '}</p>
          <p className="boot__caption" aria-live="polite">{spoken || ' '}</p>
        </>
      ) : (
        <p className="boot__sub">Todos los sistemas están en línea.</p>
      )}

      {hasBrief && (
        <div className="boot__brief">
          <Card on={current >= 1} title="Clima">
            {view.weather ? (
              <>
                <p className="boot__big">{view.weather.temperature}°</p>
                <p className="boot__small">{view.weather.condition}</p>
                <p className="boot__small">Humedad {view.weather.humidity}% · viento {view.weather.wind} km/h</p>
              </>
            ) : (
              <p className="boot__small">Sin ubicación todavía</p>
            )}
          </Card>
          <Card on={current >= 2} title="Agenda de hoy">
            <div className="boot__timeline" aria-hidden="true">
              {view.agenda.timeline.map((b) => (
                <i key={`${b.from}-${b.title}`} style={{ left: pct(b.from), width: pct(Math.max(15, b.to - b.from)) }} />
              ))}
            </div>
            {view.agenda.items.length > 0 ? (
              <ul className="boot__list">
                {view.agenda.items.map((e) => (
                  <li key={`${e.title}-${e.start}`}>
                    <span>{e.allDay ? 'Todo el día' : e.start}</span> {e.title}
                  </li>
                ))}
                {view.agenda.more > 0 && <li className="boot__more">y {view.agenda.more} más</li>}
              </ul>
            ) : (
              <p className="boot__small">{agendaNote || 'Nada para hoy'}</p>
            )}
          </Card>
          <Card on={current >= 3} title="Tareas">
            <p className="boot__big">{view.tasks.pending}</p>
            <p className="boot__small">pendientes</p>
            <ul className="boot__list">
              {view.tasks.items.map((t) => (
                <li key={t.title}>
                  {t.high && <span className="boot__high">alta</span>} {t.title}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <ul className="boot__log">
        {log.map(([label, state], i) => (
          <li key={label} style={{ '--i': i }}>
            <span>{label}</span>
            <i />
            <b>{state}</b>
          </li>
        ))}
      </ul>

      <div className="boot__gauges">
        {gauges.map((g, i) => (
          <div key={g.label} className="boot__gauge" style={{ '--i': i }}>
            <span>{g.label}</span>
            <b className="boot__num">{g.text}</b>
            <em>
              <i style={{ '--v': g.value }} />
            </em>
          </div>
        ))}
      </div>

      <div className="boot__bar">
        <i style={{ '--v': brief.ready ? 1 : brief.loaded / brief.total }} />
      </div>
      {blocked ? (
        <button
          type="button"
          className="boot__retry"
          onClick={(e) => {
            e.stopPropagation();
            startVoice(true);
          }}
        >
          Escuchar el resumen
        </button>
      ) : (
        <p className="boot__hint">Toca para omitir</p>
      )}
    </div>
  );
}
