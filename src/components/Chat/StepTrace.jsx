import Icon from '../../layout/Icon';
import './StepTrace.css';

const STATUS_TEXT = {
  running: 'En curso',
  done: 'Hecho',
  error: 'Falló',
  waiting: 'Espera tu OK',
  cancelled: 'Cancelado',
};

function StepIcon({ status }) {
  if (status === 'running') return <span className="step__spinner" aria-hidden="true" />;
  if (status === 'error' || status === 'cancelled') return <Icon name="close" size={13} />;
  if (status === 'waiting') return <Icon name="clock" size={13} />;
  return <Icon name="check" size={13} />;
}

// The "receipt" of what Eddie did for a request: one line per tool call with
// its state and outcome, and the plan (make_plan) as a numbered list. Steps
// come from the stream (live) and from `done.steps` (final); a confirmation
// card keeps its step up to date once the user answers.
export default function StepTrace({ steps, live = false }) {
  if (!steps?.length) return null;
  return (
    <ol className={`steps ${live ? 'steps--live' : ''}`} aria-label="Lo que hizo Eddie">
      {steps.map((step) => {
        const plan = Array.isArray(step.detail) && step.detail.length ? step.detail : null;
        const text = step.status === 'running' ? step.activity || step.label : step.summary || step.label;
        return (
          <li key={step.id} className={`step step--${step.status}`}>
            <span className="step__icon" title={STATUS_TEXT[step.status] || ''}>
              <StepIcon status={step.status} />
            </span>
            <div className="step__body">
              <span className="step__label">{step.label}</span>
              {text && text !== step.label && <span className="step__summary">{text}</span>}
              {step.verified === true && <span className="step__tag">verificado</span>}
              {step.verified === false && <span className="step__tag step__tag--warn">sin verificar</span>}
              {plan && (
                <ol className="step__plan">
                  {plan.map((item, i) => (
                    <li key={`${i}-${item}`}>{item}</li>
                  ))}
                </ol>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
