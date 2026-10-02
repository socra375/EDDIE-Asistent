// Eddie's central control: concentric rings around a dark core with five
// sound bars, the EDDIE name and a status chip, and the push-to-talk button.
// `state` drives the animation: idle | listening | processing | speaking |
// disabled | error.
//
// Light on purpose (the first ring froze weak Chromebooks): no `filter` or
// shadow, and every moving part is its own small layer that only changes
// `transform` or `opacity`, in steps — see Home.css.
const C = 200;
const BARS = [0.35, 0.6, 1, 0.6, 0.35];

// Dashed rings are drawn as arcs of the circumference so they read as
// "segments" when they turn.
const circumference = (r) => 2 * Math.PI * r;

export default function EddieOrb({ state, label, onActivate, actionLabel }) {
  return (
    <div className="eddie-orb" data-state={state}>
      <button type="button" className="eddie-orb__hit" onClick={onActivate} aria-label={actionLabel}>
        <span className="eddie-orb__glow" aria-hidden="true" />

        {/* Still rings and the dark core. */}
        <svg className="eddie-orb__layer" viewBox="0 0 400 400" aria-hidden="true">
          <defs>
            <radialGradient id="eddie-orb-core" cx="50%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#10465c" />
              <stop offset="65%" stopColor="#082a3a" />
              <stop offset="100%" stopColor="#041720" />
            </radialGradient>
          </defs>
          <circle cx={C} cy={C} r="194" className="orb-ring orb-ring--outer" />
          <circle cx={C} cy={C} r="166" className="orb-ring" />
          <circle cx={C} cy={C} r="138" className="orb-ring orb-ring--soft" />
          <circle cx={C} cy={C} r="110" className="orb-ring" />
          <circle cx={C} cy={C} r="86" className="orb-core" />
        </svg>

        {/* Turning arcs (slow at rest, quick while thinking). */}
        <svg className="eddie-orb__layer eddie-orb__layer--orbit" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx={C} cy={C} r="180" className="orb-arc" strokeDasharray={`${circumference(180) * 0.22} ${circumference(180) * 0.28}`} />
        </svg>
        <svg className="eddie-orb__layer eddie-orb__layer--orbit2" viewBox="0 0 400 400" aria-hidden="true">
          <circle cx={C} cy={C} r="152" className="orb-arc orb-arc--inner" strokeDasharray={`${circumference(152) * 0.12} ${circumference(152) * 0.13}`} />
        </svg>

        <span className="eddie-orb__bars" aria-hidden="true">
          {BARS.map((h, i) => (
            <i key={i} style={{ '--h': h, '--d': `${i * 0.11}s` }} />
          ))}
        </span>
      </button>

      <h2 className="eddie-orb__name">E.D.D.I.E.</h2>
      <p className="eddie-orb__status" role="status">
        <span className="eddie-orb__dot" aria-hidden="true" />
        {label}
      </p>
    </div>
  );
}
