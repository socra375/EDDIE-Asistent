import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 4000;

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/whatsapp/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

// The WhatsApp card's own controls: link a phone with a one-time code (the
// user sends "VINCULAR <code>" to Eddie's number — the button opens that
// message ready to send), then switch voice replies or unlink. While a code is
// showing the list refreshes quietly, so the card flips to "Conectado" by
// itself once the phone is linked.
export default function WhatsAppControls({ connector, signedIn, onConnect, onChanged }) {
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = connector.status === 'connected';
  // Shown as soon as it is clicked; the server's value takes over if saving fails.
  const [voiceOverride, setVoiceOverride] = useState(null);
  const voiceReplies = voiceOverride ?? Boolean(connector.details?.voiceReplies);

  useEffect(() => {
    if (!link || connected) return undefined;
    const timer = window.setInterval(() => onChanged(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [link, connected, onChanged]);

  async function run(action, body) {
    setBusy(true);
    setError('');
    try {
      return await post(action, body);
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startLink() {
    const data = await run('link', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    if (data) setLink(data);
  }

  if (connector.status === 'needs_setup') return null;

  if (!signedIn) {
    return (
      <>
        <p className="connector__meta">Para vincular WhatsApp, primero inicia sesión con Google.</p>
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  if (connected) {
    return (
      <div className="telegram">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={voiceReplies}
            disabled={busy}
            onChange={async (e) => {
              const wanted = e.target.checked;
              setVoiceOverride(wanted);
              if (await run('settings', { voiceReplies: wanted })) onChanged(true);
              else setVoiceOverride(null);
            }}
          />
          <span>Contestar siempre con voz (si no, solo cuando le mandes una nota de voz)</span>
        </label>
        <p className="connector__meta">En WhatsApp: /ayuda, /voz on|off, /resumen, /recordatorios, /nuevo, /desvincular.</p>
        <button
          type="button"
          className="btn btn-danger connector__action"
          disabled={busy}
          onClick={async () => {
            if (await run('unlink')) {
              setVoiceOverride(null);
              onChanged(true);
            }
          }}
        >
          Desvincular este número
        </button>
        {error && <p className="connectors__warning" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="telegram">
      {link && !connected ? (
        <>
          <a className="btn btn-primary connector__action" href={link.url} target="_blank" rel="noreferrer">
            <Icon name="phone" size={14} /> Abrir WhatsApp
          </a>
          <p className="connector__meta">
            Se abre el chat con Eddie (+{link.number}) con el mensaje ya escrito: envíalo. Si no se abre, mándale a ese número el mensaje{' '}
            <code>{link.message}</code>. Caduca en {link.minutes} minutos. Esta tarjeta se actualiza sola al vincular.
          </p>
        </>
      ) : (
        <button type="button" className="btn btn-primary connector__action" disabled={busy} onClick={startLink}>
          Vincular WhatsApp
        </button>
      )}
      {error && <p className="connectors__warning" role="alert">{error}</p>}
    </div>
  );
}
