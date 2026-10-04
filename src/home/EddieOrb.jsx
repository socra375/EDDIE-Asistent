import ParticleRing from './ParticleRing';

// Eddie's central control: a ring of flowing light particles around an empty
// dark disc, with the EDDIE name and a status chip under it. The whole circle
// is the push-to-talk button. `state` drives the animation: idle | listening |
// processing | speaking | disabled | error (see ParticleRing and Home.css).
//
// The disc in the middle (`eddie-orb__slot`) is kept clear on purpose: it is
// the place where, later on, the image Eddie is asked for will appear.
export default function EddieOrb({ state, label, onActivate, actionLabel, labelTitle, onLabelClick }) {
  return (
    <div className="eddie-orb" data-state={state}>
      <button type="button" className="eddie-orb__hit" onClick={onActivate} aria-label={actionLabel}>
        <span className="eddie-orb__glow" aria-hidden="true" />
        <span className="eddie-orb__slot" aria-hidden="true" />
        <ParticleRing state={state} />
      </button>

      <h2 className="eddie-orb__name">E.D.D.I.E.</h2>
      {onLabelClick ? (
        <button type="button" className="eddie-orb__status eddie-orb__status--action" onClick={onLabelClick} title={labelTitle}>
          <span className="eddie-orb__dot" aria-hidden="true" />
          {label}
        </button>
      ) : (
        <p className="eddie-orb__status" role="status" title={labelTitle}>
          <span className="eddie-orb__dot" aria-hidden="true" />
          {label}
        </p>
      )}
    </div>
  );
}
