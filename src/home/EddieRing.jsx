import { useEffect, useMemo, useRef } from 'react';

const C = 300;
const circumference = (r) => 2 * Math.PI * r;
const ARCS = { sec: 262, min: 194 };
const SEGMENTS = 48;
const BAND = { inner: 206, outer: 250 };

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}

// Annular sector between two radii, angles in degrees clockwise from 12.
function sector(r1, r2, from, to) {
  const [ax, ay] = polar(r2, from);
  const [bx, by] = polar(r2, to);
  const [cx, cy] = polar(r1, to);
  const [dx, dy] = polar(r1, from);
  const large = to - from > 180 ? 1 : 0;
  return `M${ax} ${ay}A${r2} ${r2} 0 ${large} 1 ${bx} ${by}L${cx} ${cy}A${r1} ${r1} 0 ${large} 0 ${dx} ${dy}Z`;
}

function arc(r, from, to) {
  const [ax, ay] = polar(r, from);
  const [bx, by] = polar(r, to);
  return `M${ax} ${ay}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${bx} ${by}`;
}

// Static geometry, built once: the segmented light band (lit from the lower
// left over the top to the upper right), the outer tick bezel and the amber
// bracket with its dots.
function useGeometry() {
  return useMemo(() => {
    const step = 360 / SEGMENTS;
    const segments = Array.from({ length: SEGMENTS }, (_, i) => {
      const from = i * step + 0.8;
      const mid = i * step + step / 2;
      // Lit between 225° (≈7:30) and 60° (2 o'clock), brightest near 11.
      const lit = mid >= 225 || mid <= 60;
      const dist = Math.min(Math.abs(mid - 330), 360 - Math.abs(mid - 330));
      return {
        d: sector(BAND.inner, BAND.outer, from, from + step - 1.6),
        lit,
        strength: lit ? 1 - dist / 140 : 0,
        delay: (i % 8) * 0.07,
      };
    });
    const ticks = Array.from({ length: 180 }, (_, i) => {
      const deg = i * 2;
      const major = i % 5 === 0;
      const [x1, y1] = polar(272, deg);
      const [x2, y2] = polar(major ? 286 : 279, deg);
      return { x1, y1, x2, y2, major };
    });
    const dots = [-14, -7, 0, 7, 14].map((deg) => polar(240, deg + 8));
    return { segments, ticks, dots };
  }, []);
}

// Eddie's central control, drawn after the J.A.R.V.I.S. interface: a
// segmented light band around a dark core with the EDDIE name. It is still
// a clock (outer arc = seconds, inner arc = minutes, amber pointer sweeps
// with the seconds) and doubles as the push-to-talk button. `state` drives
// the animation: idle | listening | processing | speaking | disabled | error.
export default function EddieRing({ state, label, onActivate, actionLabel }) {
  const { segments, ticks, dots } = useGeometry();
  const secRef = useRef(null);
  const minRef = useRef(null);
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
      setArc(secRef.current, ARCS.sec, sec / 60);
      setArc(minRef.current, ARCS.min, min / 60);
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
          <defs>
            <radialGradient id="eddie-core-bg" cx="50%" cy="45%" r="55%">
              <stop offset="0%" stopColor="#0d3345" />
              <stop offset="70%" stopColor="#06202c" />
              <stop offset="100%" stopColor="#031118" />
            </radialGradient>
            <linearGradient id="eddie-name" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="55%" stopColor="#e4f6ff" />
              <stop offset="100%" stopColor="#9fc9dc" />
            </linearGradient>
          </defs>

          {/* Outer bezel: ticks, thin ring, a few bright arcs and the seconds. */}
          <g className="eddie-ring__bezel">
            {ticks.map((t, i) => (
              <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'tick tick--major' : 'tick'} />
            ))}
            <path d={arc(294, 100, 140)} className="bezel-arc" />
            <path d={arc(294, 200, 215)} className="bezel-arc" />
            <path d={arc(294, 300, 335)} className="bezel-arc" />
          </g>
          <circle cx={C} cy={C} r="268" className="ring-line" />
          <circle cx={C} cy={C} r={ARCS.sec} className="ring-track" />
          <circle ref={secRef} cx={C} cy={C} r={ARCS.sec} className="arc arc--sec" strokeDasharray={circumference(ARCS.sec)} transform={`rotate(-90 ${C} ${C})`} />

          {/* Segmented light band. */}
          <g className="eddie-ring__band">
            <circle cx={C} cy={C} r={BAND.outer + 3} className="band-edge" />
            <circle cx={C} cy={C} r={BAND.inner - 3} className="band-edge" />
            {segments.map((s, i) => (
              <path
                key={i}
                d={s.d}
                className={s.lit ? 'seg seg--lit' : 'seg'}
                style={s.lit ? { '--seg': 0.45 + s.strength * 0.5, animationDelay: `${s.delay}s` } : undefined}
              />
            ))}
            {dots.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="3.2" className="band-dot" />
            ))}
          </g>

          {/* Amber bracket on the left of the band. */}
          <g className="eddie-ring__amber">
            <path d={arc(212, 212, 300)} />
            <path d={`M${polar(212, 212).join(' ')}L${polar(226, 212).join(' ')}`} />
            <path d={`M${polar(212, 300).join(' ')}L${polar(222, 300).join(' ')}`} />
            <path d={arc(226, 196, 212)} />
          </g>

          {/* Inner rings: the minutes arc and two fine guides. */}
          <circle cx={C} cy={C} r={ARCS.min} className="ring-inner" />
          <circle ref={minRef} cx={C} cy={C} r={ARCS.min} className="arc arc--min" strokeDasharray={circumference(ARCS.min)} transform={`rotate(-90 ${C} ${C})`} />
          <circle cx={C} cy={C} r="184" className="ring-dots" />

          <g className="eddie-ring__process">
            <circle cx={C} cy={C} r="184" className="process-arc" strokeDasharray="150 428" />
            <circle cx={C} cy={C} r="168" className="process-arc process-arc--inner" strokeDasharray="80 448" />
          </g>

          {/* Dark core with the name. */}
          <circle cx={C} cy={C} r="174" className="eddie-ring__core" />
          <circle cx={C} cy={C} r="150" className="eddie-ring__core-guide" />
          <g className="eddie-ring__name">
            <text x={C} y={C + 13} textAnchor="middle" textLength="290" lengthAdjust="spacingAndGlyphs">
              E.D.D.I.E.
            </text>
            <path d={`M${C - 120} ${C + 34}H${C + 120}`} className="name-rule" />
            <path d={`M${C - 60} ${C - 36}H${C + 60}`} className="name-rule name-rule--top" />
          </g>

          <g ref={handRef} className="eddie-ring__hand">
            <path d="M293 4L307 4L300 18Z" />
          </g>
        </svg>
      </button>
      <p className="eddie-ring__status" role="status">
        {label}
      </p>
    </div>
  );
}
