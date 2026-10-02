import { useCallback, useEffect, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { BOOT_GAUGES, BOOT_LINES, BOOT_REPLAY_EVENT, BOOT_SEEN_KEY, bootDuration, greetingFor, shouldShowBoot } from '../services/boot';
import './Boot.css';

const LEAVE_MS = 650;
const SPARKS = Array.from({ length: 28 }, (_, i) => ({ angle: (360 / 28) * i, reach: 150 + ((i * 53) % 90), delay: (i % 7) * 0.025 }));
const COILS = Array.from({ length: 10 }, (_, i) => i);
const TITLE = 'E.D.D.I.E.'.split('');

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

// The start-up animation: a black screen where a reactor ignites, the system
// reports in, and Eddie greets — then the screen opens onto the app. Any tap,
// click or key skips it. Plays when Eddie is opened (see services/boot.js).
export default function BootSplash() {
  const { settings } = useSettings();
  const [phase, setPhase] = useState(() => {
    const shortcut = new URLSearchParams(window.location.search).has('accion');
    return shouldShowBoot({ enabled: settings.display?.boot !== false, seen: storage('get', BOOT_SEEN_KEY) === '1', shortcut }) ? 'run' : 'off';
  });
  const [run, setRun] = useState(0);
  const [greeting] = useState(() => greetingFor());

  useEffect(() => {
    if (phase === 'run') storage('set', BOOT_SEEN_KEY, '1');
  }, [phase]);

  const leave = useCallback(() => setPhase((p) => (p === 'run' ? 'leave' : p)), []);

  // Leaves by itself; removed once it has faded.
  useEffect(() => {
    if (phase === 'run') {
      const timer = window.setTimeout(leave, bootDuration(reducedMotion()));
      return () => window.clearTimeout(timer);
    }
    if (phase === 'leave') {
      const timer = window.setTimeout(() => setPhase('off'), LEAVE_MS);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [phase, run, leave]);

  // Any key skips it.
  useEffect(() => {
    if (phase !== 'run') return undefined;
    window.addEventListener('keydown', leave);
    return () => window.removeEventListener('keydown', leave);
  }, [phase, leave]);

  // "Ver animación de inicio" in Configuración.
  useEffect(() => {
    const replay = () => {
      setRun((n) => n + 1);
      setPhase('run');
    };
    window.addEventListener(BOOT_REPLAY_EVENT, replay);
    return () => window.removeEventListener(BOOT_REPLAY_EVENT, replay);
  }, []);

  if (phase === 'off') return null;

  return (
    <div key={run} className={`boot boot--${phase}`} onClick={leave} role="presentation" aria-hidden="true">
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
      <p className="boot__greeting">{greeting}</p>
      <p className="boot__sub">Todos los sistemas están en línea.</p>

      <ul className="boot__log">
        {BOOT_LINES.map(([label, state], i) => (
          <li key={label} style={{ '--i': i }}>
            <span>{label}</span>
            <i />
            <b>{state}</b>
          </li>
        ))}
      </ul>

      <div className="boot__gauges">
        {BOOT_GAUGES.map((label, i) => (
          <div key={label} className="boot__gauge" style={{ '--i': i }}>
            <span>{label}</span>
            <b className="boot__num" />
            <em>
              <i />
            </em>
          </div>
        ))}
      </div>

      <div className="boot__bar">
        <i />
      </div>
      <p className="boot__hint">Toca para omitir</p>
    </div>
  );
}
