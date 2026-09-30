import { useState } from 'react';
import Icon from '../../layout/Icon';
import './ConfirmCard.css';

const STATE_TEXT = {
  running: 'Haciéndolo…',
  cancelled: 'Cancelado.',
};

// An action Eddie proposed that needs the user's OK before it happens
// (deleting, and later sending emails…). Buttons: the action itself
// ("Borrar", "Enviar"), Editar when some field can be changed, and Cancelar.
// The user can also just say "sí" or "no". `onResolve(decision, args)`.
export default function ConfirmCard({ card, onResolve, compact = false }) {
  const [editing, setEditing] = useState(false);
  const fields = card.preview?.fields || [];
  const editable = fields.filter((f) => f.editable);
  const [draft, setDraft] = useState(() => Object.fromEntries(editable.map((f) => [f.key, card.args?.[f.key] ?? f.value ?? ''])));
  const pending = card.state === 'pending';
  const confirmLabel = card.preview?.confirmLabel || 'Confirmar';

  // Edits stay once "Listo" closes the fields; they're what gets confirmed.
  function confirm() {
    setEditing(false);
    onResolve('confirm', editable.length ? { ...card.args, ...draft } : card.args);
  }

  function valueOf(field) {
    if (field.editable && field.key in draft) return draft[field.key];
    return card.args?.[field.key] ?? field.value;
  }

  return (
    <section
      className={`confirm-card confirm-card--${card.state} ${card.preview?.danger ? 'confirm-card--danger' : ''} ${compact ? 'confirm-card--compact' : ''}`}
      aria-label={`Confirmar: ${card.preview?.title || card.label}`}
    >
      <header className="confirm-card__head">
        <Icon name="check" size={14} />
        <span>{card.preview?.title || card.label}</span>
        {pending && <span className="confirm-card__hint">Esperando tu confirmación</span>}
      </header>

      <dl className="confirm-card__fields">
        {fields.map((f) => (
          <div key={f.key} className="confirm-card__field">
            <dt>{f.label}</dt>
            <dd>
              {editing && f.editable ? (
                f.multiline ? (
                  <textarea
                    className="input"
                    rows={4}
                    value={draft[f.key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    aria-label={f.label}
                  />
                ) : (
                  <input className="input" value={draft[f.key]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} aria-label={f.label} />
                )
              ) : (
                valueOf(f)
              )}
            </dd>
          </div>
        ))}
      </dl>

      {pending ? (
        <div className="confirm-card__actions">
          <button type="button" className={`btn ${card.preview?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={confirm}>
            {confirmLabel}
          </button>
          {editable.length > 0 && (
            <button type="button" className="btn" onClick={() => setEditing((v) => !v)} aria-pressed={editing}>
              {editing ? 'Listo' : 'Editar'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => onResolve('cancel')}>
            Cancelar
          </button>
        </div>
      ) : (
        <p className={`confirm-card__status confirm-card__status--${card.state}`} role="status">
          {card.state === 'done' || card.state === 'error' ? card.result : STATE_TEXT[card.state]}
        </p>
      )}
    </section>
  );
}
