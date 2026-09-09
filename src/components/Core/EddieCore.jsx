import './EddieCore.css';

const STATE_LABELS = {
  idle: 'En espera',
  listening: 'Escuchando',
  processing: 'Analizando tu solicitud…',
  responding: 'Listo. Aquí tienes la respuesta.',
  error: 'Algo no salió bien',
};

// Only listening/processing pulse an audio-waveform ring around the core
// (see EddieCore.css) — the other states already have their own animation.
const WAVE_STATES = new Set(['listening', 'processing']);
const WAVE_BAR_COUNT = 16;
const waveBars = Array.from({ length: WAVE_BAR_COUNT }, (_, i) => i);

export default function EddieCore({ state = 'idle', compact = false }) {
  return (
    <div className={`eddie-core ${compact ? 'eddie-core--compact' : ''}`} data-state={state} role="img" aria-label={`Eddie: ${STATE_LABELS[state]}`}>
      <div className="eddie-core__rings">
        <span className="ring ring-1" />
        <span className="ring ring-2" />
        <span className="ring ring-3" />
        {WAVE_STATES.has(state) && (
          <div className="eddie-core__waves" aria-hidden="true">
            {waveBars.map((i) => (
              <span
                key={i}
                className="wave-spoke"
                style={{ transform: `rotate(${(360 / WAVE_BAR_COUNT) * i}deg)`, animationDelay: `${(i % 4) * 0.1}s` }}
              >
                <span className="wave-bar" />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="eddie-core__nucleus">
        {state === 'listening' ? <span className="eddie-core__icon" aria-hidden="true">🎙️</span> : <span className="eddie-core__spark" />}
      </div>
      {!compact && <p className="eddie-core__status">{STATE_LABELS[state]}</p>}
    </div>
  );
}
