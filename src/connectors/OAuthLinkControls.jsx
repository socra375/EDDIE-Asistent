import { useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Connect / disconnect for a connector that links an account through its own
// OAuth page: "Conectar" goes to the server, which sends the user to
// the service and brings them back; "Desconectar" makes the server forget the tokens.
export default function OAuthLinkControls({ connector, signedIn, onConnect, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function disconnect() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/connectors/${connector.id}/disconnect`, { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `No se pudo desconectar (${res.status}).`);
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (connector.status === 'needs_account') {
    return signedIn ? (
      <a className="btn btn-primary connector__action" href={`${API_BASE}${connector.connectUrl}`}>
        Conectar {connector.name}
      </a>
    ) : (
      <>
        <p className="connector__meta">Primero inicia sesión con Google: {connector.name} se vincula a tu cuenta de Eddie.</p>
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Iniciar sesión
        </button>
      </>
    );
  }
  if (connector.status === 'connected') {
    return (
      <>
        <button type="button" className="btn connector__action" onClick={disconnect} disabled={busy}>
          {busy ? 'Desconectando…' : `Desconectar ${connector.name}`}
        </button>
        {error && (
          <p className="connector__meta tone-bad" role="alert">
            {error}
          </p>
        )}
      </>
    );
  }
  return null;
}
