import './EddieCore.css';

const STATE_LABELS = {
  idle: 'En espera',
  listening: 'Escuchando',
  processing: 'Analizando tu solicitud…',
  responding: 'Listo. Aquí tienes la respuesta.',
  error: 'Algo no salió bien',
};

export default function EddieCore({ state = 'idle', compact = false }) {
  return (
    <div className={`eddie-core ${compact ? 'eddie-core--compact' : ''}`} data-state={state} role="img" aria-label={`Eddie: ${STATE_LABELS[state]}`}>
      <div className="eddie-core__rings">
        <span className="ring ring-1" />
        <span className="ring ring-2" />
        <span className="ring ring-3" />
      </div>
      <div className="eddie-core__nucleus">
        <span className="eddie-core__spark" />
      </div>
      {!compact && <p className="eddie-core__status">{STATE_LABELS[state]}</p>}
    </div>
  );
}
