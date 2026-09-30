import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 4000;

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/telegram/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

// The Telegram card's own controls: link a chat with a one-time code (the
// user opens the bot through the link and presses Start), then switch voice
// replies or unlink. While a code is showing the list refreshes quietly, so
// the card flips to "Conectado" by itself once the chat is linked.
export default function TelegramControls({ connector, signedIn, onConnect, onChanged }) {
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
        <p className="connector__meta">Para vincular Telegram, primero inicia sesión con Google.</p>
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
        <p className="connector__meta">En Telegram: /llamar abre su pantalla de voz, /voz on|off, /nuevo, /ayuda.</p>
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
          Desvincular este chat
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
            <Icon name="send" size={14} /> Abrir Telegram
          </a>
          <p className="connector__meta">
            Se abre el chat con @{link.username}: pulsa <strong>Iniciar</strong> (Start). Si no se abre, envíale{' '}
            <code>/start {link.code}</code>. Caduca en {link.minutes} minutos. Esta tarjeta se actualiza sola al vincular.
          </p>
          {link.webhook?.host && <p className="connector__meta">El bot le escribe a: {link.webhook.host}</p>}
          {link.webhook?.lastError && (
            <p className="connectors__warning" role="alert">
              Telegram no pudo entregar un mensaje a tu sitio: {link.webhook.lastError}. Revisa que APP_URL en Vercel sea tu dominio fijo (con https) y vuelve a desplegar.
            </p>
          )}
        </>
      ) : (
        <button type="button" className="btn btn-primary connector__action" disabled={busy} onClick={startLink}>
          Vincular Telegram
        </button>
      )}
      {error && <p className="connectors__warning" role="alert">{error}</p>}
    </div>
  );
}
