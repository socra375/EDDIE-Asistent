import { useEffect, useMemo, useRef, useState } from 'react';

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

// One stacked picture of the ring. Each moving part is its OWN layer (an svg
// with `will-change`), so the browser moves a ready-made picture on the
// graphics side instead of repainting the whole ring every frame: that is
// what keeps a Chromebook from freezing. The still parts (rings, core, clock
// arcs) are drawn once and repainted only when the second changes.
function Layer({ name, children }) {
  return (
    <svg className={`eddie-ring__layer eddie-ring__layer--${name}`} viewBox="0 0 600 600" aria-hidden="true">
      {children}
    </svg>
  );
}

// Eddie's central control, drawn after the J.A.R.V.I.S. interface: a
// segmented light band around a dark core with the EDDIE name. It is still
// a clock (outer arc = seconds, inner arc = minutes, amber pointer ticks
// with the seconds) and doubles as the push-to-talk button. `state` drives
// the animation: idle | listening | processing | speaking | disabled | error.
// In reposo the only movement is one tick per second.
export default function EddieRing({ state, label, onActivate, actionLabel }) {
  const { segments, ticks, dots } = useGeometry();
  const secRef = useRef(null);
  const minRef = useRef(null);
  // The pointer's animation starts where the seconds are now (a negative delay).
  const [handDelay] = useState(() => {
    const d = new Date();
    return -(d.getSeconds() + d.getMilliseconds() / 1000);
  });

  // The two arcs move once a second; writing the attribute directly avoids
  // re-rendering the ring, and nothing runs while the tab is hidden.
  useEffect(() => {
    const setArc = (el, r, fraction) => {
      el.style.strokeDashoffset = String(circumference(r) * (1 - fraction));
    };
    const tick = () => {
      if (document.hidden) return;
      const d = new Date();
      const sec = d.getSeconds();
      const min = d.getMinutes() + sec / 60;
      setArc(secRef.current, ARCS.sec, sec / 60);
      setArc(minRef.current, ARCS.min, min / 60);
    };
    tick();
    const id = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  return (
    <div className="eddie-ring" data-state={state} style={{ '--hand-delay': `${handDelay}s` }}>
      <button type="button" className="eddie-ring__hit" onClick={onActivate} aria-label={actionLabel}>
        <span className="eddie-ring__glow" aria-hidden="true" />

        {/* Still parts: rings, the dark core, the amber bracket and the clock arcs. */}
        <Layer name="static">
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
          <circle cx={C} cy={C} r="268" className="ring-line" />
          <circle cx={C} cy={C} r={ARCS.sec} className="ring-track" />
          <circle ref={secRef} cx={C} cy={C} r={ARCS.sec} className="arc arc--sec" strokeDasharray={circumference(ARCS.sec)} transform={`rotate(-90 ${C} ${C})`} />
          <g className="eddie-ring__amber">
            <path d={arc(212, 212, 300)} />
            <path d={`M${polar(212, 212).join(' ')}L${polar(226, 212).join(' ')}`} />
            <path d={`M${polar(212, 300).join(' ')}L${polar(222, 300).join(' ')}`} />
            <path d={arc(226, 196, 212)} />
          </g>
          <circle cx={C} cy={C} r={ARCS.min} className="ring-inner" />
          <circle ref={minRef} cx={C} cy={C} r={ARCS.min} className="arc arc--min" strokeDasharray={circumference(ARCS.min)} transform={`rotate(-90 ${C} ${C})`} />
          <circle cx={C} cy={C} r="184" className="ring-dots" />
          <circle cx={C} cy={C} r="174" className="eddie-ring__core" />
          <circle cx={C} cy={C} r="150" className="eddie-ring__core-guide" />
        </Layer>

        {/* Outer bezel: ticks and a few bright arcs (drifts slowly). */}
        <Layer name="bezel">
          {ticks.map((t, i) => (
            <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} className={t.major ? 'tick tick--major' : 'tick'} />
          ))}
          <path d={arc(294, 100, 140)} className="bezel-arc" />
          <path d={arc(294, 200, 215)} className="bezel-arc" />
          <path d={arc(294, 300, 335)} className="bezel-arc" />
        </Layer>

        {/* Segmented light band (pulses while listening, spins while processing). */}
        <Layer name="band">
          <circle cx={C} cy={C} r={BAND.outer + 3} className="band-edge" />
          <circle cx={C} cy={C} r={BAND.inner - 3} className="band-edge" />
          {segments.map((s, i) => (
            <path key={i} d={s.d} className={s.lit ? 'seg seg--lit' : 'seg'} style={s.lit ? { '--seg': 0.45 + s.strength * 0.5 } : undefined} />
          ))}
          {dots.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.2" className="band-dot" />
          ))}
        </Layer>

        {/* Amber arcs that race around the core while processing. */}
        <Layer name="process">
          <circle cx={C} cy={C} r="184" className="process-arc" strokeDasharray="150 428" />
          <circle cx={C} cy={C} r="168" className="process-arc process-arc--inner" strokeDasharray="80 448" />
        </Layer>

        {/* The name. */}
        <Layer name="name">
          <g className="eddie-ring__name">
            <text x={C} y={C + 13} textAnchor="middle" textLength="290" lengthAdjust="spacingAndGlyphs">
              E.D.D.I.E.
            </text>
            <path d={`M${C - 120} ${C + 34}H${C + 120}`} className="name-rule" />
            <path d={`M${C - 60} ${C - 36}H${C + 60}`} className="name-rule name-rule--top" />
          </g>
        </Layer>

        {/* The amber pointer: one tick per second. */}
        <Layer name="hand">
          <path d="M293 4L307 4L300 18Z" className="eddie-ring__hand" />
        </Layer>
      </button>
      <p className="eddie-ring__status" role="status">
        {label}
      </p>
    </div>
  );
}
