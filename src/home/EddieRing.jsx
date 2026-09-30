import { useEffect, useMemo, useRef } from 'react';

const C = 300;
const circumference = (r) => 2 * Math.PI * r;
const ARCS = { sec: 252, min: 234, day: 216 };
const WAVE_BARS = 48;

function polar(r, angleRad) {
  return [C + r * Math.sin(angleRad), C - r * Math.cos(angleRad)];
}

// Static geometry, built once: 120 ticks (every 3°), hour numerals and the
// radial bars used by the "listening" animation.
function useGeometry() {
  return useMemo(() => {
    const ticks = Array.from({ length: 120 }, (_, i) => {
      const a = (i * 3 * Math.PI) / 180;
      const major = i % 10 === 0;
      const [x1, y1] = polar(268, a);
      const [x2, y2] = polar(major ? 250 : 260, a);
      return { x1, y1, x2, y2, major };
    });
    const numerals = Array.from({ length: 12 }, (_, h) => {
      const [x, y] = polar(290, (h * 30 * Math.PI) / 180);
      return { x, y: y + 5, label: h === 0 ? 12 : h };
    });
    const bars = Array.from({ length: WAVE_BARS }, (_, i) => ({ angle: (360 / WAVE_BARS) * i, delay: (i % 6) * 0.08 }));
    return { ticks, numerals, bars };
  }, []);
}

// Eddie's central control: a HUD clock ring (seconds, minutes, day arc and
// sweep hand) that doubles as the push-to-talk button. `state` drives the
// animation: idle | listening | processing | speaking | disabled | error.
export default function EddieRing({ state, label, onActivate, actionLabel }) {
  const { ticks, numerals, bars } = useGeometry();
  const secRef = useRef(null);
  const minRef = useRef(null);
  const dayRef = useRef(null);
  const handRef = useRef(null);

  // The clock moves every 100ms; writing SVG attributes directly avoids
  // re-rendering the whole ring ten times a second.
  useEffect(() => {
    const setArc = (el, r, fraction) => {
      el.style.strokeDashoffset = String(circumference(r) * (1 - fraction));
    };
    const tick = () => {
      const d = new Date();
      const sec = d.getSeconds() + d.getMilliseconds() / 1000;
      const min = d.getMinutes() + sec / 60;
      const dayFraction = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
      setArc(secRef.current, ARCS.sec, sec / 60);
      setArc(minRef.current, ARCS.min, min / 60);
      setArc(dayRef.current, ARCS.day, dayFraction);
      handRef.current.setAttribute('transform', `rotate(${sec * 6} ${C} ${C})`);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="eddie-ring" data-state={state}>
      <button type="button" className="eddie-ring__hit" onClick={onActivate} aria-label={actionLabel}>
        <svg className="eddie-ring__svg" viewBox="0 0 600 600" aria-hidden="true">
          <g className="eddie-ring__ticks">
            {ticks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'tick tick--major' : 'tick'} />
            ))}
            {numerals.map((n) => (
              <text key={n.label} x={n.x} y={n.y} className="numeral" textAnchor="middle">
                {n.label}
              </text>
            ))}
          </g>
          <circle cx={C} cy={C} r="268" className="ring-line" />
          <circle ref={secRef} cx={C} cy={C} r={ARCS.sec} className="arc arc--sec" strokeDasharray={circumference(ARCS.sec)} transform={`rotate(-90 ${C} ${C})`} />
          <circle ref={minRef} cx={C} cy={C} r={ARCS.min} className="arc arc--min" strokeDasharray={circumference(ARCS.min)} transform={`rotate(-90 ${C} ${C})`} />
          <circle cx={C} cy={C} r={ARCS.day} className="ring-track" />
          <circle ref={dayRef} cx={C} cy={C} r={ARCS.day} className="arc arc--day" strokeDasharray={circumference(ARCS.day)} transform={`rotate(-90 ${C} ${C})`} />
          <circle cx={C} cy={C} r="196" className="ring-dots" />

          <g className="eddie-ring__process">
            <circle cx={C} cy={C} r="180" className="process-arc" strokeDasharray="160 405" />
            <circle cx={C} cy={C} r="166" className="process-arc process-arc--inner" strokeDasharray="90 431" />
          </g>

          <g className="eddie-ring__waves">
            {bars.map((b) => (
              <g key={b.angle} transform={`rotate(${b.angle} ${C} ${C})`}>
                <line x1={C} y1={C - 150} x2={C} y2={C - 185} className="wave" style={{ animationDelay: `${b.delay}s` }} />
              </g>
            ))}
          </g>

          <g ref={handRef} className="eddie-ring__hand">
            <line x1={C} y1="26" x2={C} y2="8" />
            <path d="M294 40L306 40L300 26Z" />
          </g>

          <g className="eddie-ring__cross">
            <line x1={C} y1="210" x2={C} y2="250" />
            <line x1={C} y1="350" x2={C} y2="390" />
            <line x1="210" y1={C} x2="250" y2={C} />
            <line x1="350" y1={C} x2="390" y2={C} />
          </g>
          <circle cx={C} cy={C} r="30" className="eddie-ring__core" />
          <circle cx={C} cy={C} r="3" className="eddie-ring__dot" />
          <g className="eddie-ring__corners">
            <path d="M110 150V120H140" />
            <path d="M490 150V120H460" />
            <path d="M110 450V480H140" />
            <path d="M490 450V480H460" />
          </g>
        </svg>
      </button>
      <p className="eddie-ring__status" role="status">
        {label}
      </p>
    </div>
  );
}
