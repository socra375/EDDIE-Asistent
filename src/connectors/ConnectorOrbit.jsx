import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';
import { layoutRings } from './orbitLayout.js';

// Seconds the whole "gira y se detiene" intro lasts (keep in sync with
// --orbit-spin in Connectors.css).
const SPIN_SECONDS = 3.4;
// The reactor in the middle: static rings, plus one dashed ring per direction
// that turns during the intro and then stops. Pure SVG, no filters.
function Reactor() {
  return (
    <svg className="orbit__reactor-svg" viewBox="0 0 200 200" aria-hidden="true">
      <circle className="orbit__r-track" cx="100" cy="100" r="92" />
      <g className="orbit__r-spin orbit__r-spin--cw">
        <circle className="orbit__r-dash" cx="100" cy="100" r="84" />
      </g>
      <g className="orbit__r-spin orbit__r-spin--ccw">
        <circle className="orbit__r-ticks" cx="100" cy="100" r="74" />
      </g>
      <circle className="orbit__r-ring" cx="100" cy="100" r="62" />
      <circle className="orbit__r-ring orbit__r-ring--thin" cx="100" cy="100" r="54" />
      <polygon className="orbit__r-tri" points="100,58 136,121 64,121" />
      <circle className="orbit__r-core" cx="100" cy="100" r="16" />
    </svg>
  );
}

// Connectors as icon nodes in orbit around a central reactor. On arrival the
// rings sweep round while the nodes light up one by one, then everything
// slows down and stops (see "orbit-*" keyframes in Connectors.css).
// `nodes`: [{ connector, tone, label, off }]
export default function ConnectorOrbit({ nodes, selectedId, onSelect, summary }) {
  const [spinning, setSpinning] = useState(true);
  const [run, setRun] = useState(0);

  // Failsafe: animationend doesn't fire when animations are off (Modo ligero,
  // reduced motion) or the tab was hidden.
  useEffect(() => {
    if (!spinning) return undefined;
    const timer = window.setTimeout(() => setSpinning(false), (SPIN_SECONDS + 1.2) * 1000);
    return () => window.clearTimeout(timer);
  }, [spinning, run]);

  const placed = layoutRings(nodes);
  const selected = nodes.find((n) => n.connector.id === selectedId) || null;

  const replay = () => {
    setSpinning(true);
    setRun((n) => n + 1);
  };

  const sweepDone = (event) => {
    if (event.target === event.currentTarget && event.animationName === 'orbit-sweep-outer') setSpinning(false);
  };

  return (
    <div className={`orbit ${spinning ? 'orbit--spinning' : 'orbit--still'}`} data-run={run}>
      <div className="orbit__stage">
        <span className="orbit__track orbit__track--outer" aria-hidden="true" />
        <span className="orbit__track orbit__track--inner" aria-hidden="true" />

        <div className="orbit__reactor">
          <Reactor />
          <div className="orbit__center" aria-live="polite">
            {selected ? (
              <>
                <Icon name={selected.connector.icon || 'plug'} size={26} />
                <strong>{selected.connector.name}</strong>
                <span className={`orbit__center-state orbit__center-state--${selected.tone || 'none'}`}>{selected.label}</span>
              </>
            ) : (
              <>
                <strong>E.D.D.I.E.</strong>
                <span>{summary}</span>
              </>
            )}
          </div>
        </div>

        {['inner', 'outer'].map((ring) => (
          <div key={ring} className={`orbit__ring orbit__ring--${ring}`} onAnimationEnd={ring === 'outer' ? sweepDone : undefined}>
            {placed
              .filter((p) => p.ring === ring)
              .map(({ node, angle, order }) => {
                const c = node.connector;
                const isSelected = c.id === selectedId;
                return (
                  <div key={c.id} className="orbit__slot" style={{ '--a': `${angle}deg` }}>
                    <div className="orbit__upright">
                      <div className="orbit__counter">
                        <button
                          type="button"
                          className={`orbit__node orbit__node--${node.off ? 'off' : c.status} ${isSelected ? 'orbit__node--selected' : ''}`}
                          style={{ '--i': order, '--n': placed.length }}
                          aria-pressed={isSelected}
                          aria-label={`${c.name}: ${node.label}`}
                          onClick={() => onSelect(isSelected ? null : c.id)}
                        >
                          <Icon name={c.icon || 'plug'} size={22} />
                          <span className="orbit__label">{c.name}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <button type="button" className="btn orbit__replay" onClick={replay} disabled={spinning}>
        Girar de nuevo
      </button>
    </div>
  );
}
