import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 4000;

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/computer/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

function ago(iso) {
  if (!iso) return 'nunca';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} días`;
}

// A command to copy, with its own button.
function Command({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="computer__cmd">
      <code>{text}</code>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </span>
  );
}

// EDDIE Prime's card: link the computer with a one-time code (three
// commands to paste in the Linux terminal), then test it from the cloud or
// unlink it. While a code is showing the card refreshes quietly and flips to
// "Conectado" once the agent has paired.
export default function ComputerControls({ connector, signedIn, onConnect, onChanged }) {
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [test, setTest] = useState(null);
  const connected = connector.status === 'connected';
  const device = connector.details?.device;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  useEffect(() => {
    if (!pairing || connected) return undefined;
    const timer = window.setInterval(() => onChanged(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [pairing, connected, onChanged]);

  async function run(action, label) {
    setBusy(label);
    setError('');
    try {
      return await post(action);
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy('');
    }
  }

  if (connector.status === 'needs_setup') return null;

  if (!signedIn) {
    return (
      <>
        <p className="connector__meta">Para vincular tu equipo, primero inicia sesión con Google.</p>
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  const steps = pairing && (
    <ol className="computer__steps">
      <li>
        En la terminal de Linux del equipo, descarga el agente (necesita <code>pip install psutil</code>):
        <Command text={`curl -fsSL ${origin}/eddie_agent.py -o eddie_agent.py`} />
      </li>
      <li>
        Vincúlalo (el código caduca en {pairing.minutes} minutos):
        <Command text={`python3 eddie_agent.py pair ${pairing.code} --app ${origin}`} />
      </li>
      <li>
        Arráncalo, o haz que arranque solo con <code>install-service</code>:
        <Command text="python3 eddie_agent.py run" />
      </li>
    </ol>
  );

  if (connected && device) {
    return (
      <div className="computer">
        <p className="connector__meta">
          <strong>{device.name}</strong> · agente {device.version || '?'} · último contacto {ago(device.lastSeen)} (solo se conecta cuando hay trabajo)
        </p>
        {device.tools?.length > 0 && (
          <p className="connector__meta">
            Puede: {device.tools.map((t) => `${t.label}${t.risk === 'confirm' ? ' (con confirmación)' : ''}`).join(' · ')}
          </p>
        )}
        <div className="probe__actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={async () => {
              setTest(null);
              const data = await run('test', 'test');
              if (data) {
                setTest(data);
                onChanged(true);
              }
            }}
          >
            {busy === 'test' ? 'Esperando al equipo…' : 'Probar desde la nube'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={async () => {
              const data = await run('pair-code', 'pair');
              if (data) setPairing(data);
            }}
          >
            Vincular otro equipo
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={Boolean(busy)}
            onClick={async () => {
              if (await run('unlink', 'unlink')) {
                setTest(null);
                setPairing(null);
                onChanged(true);
              }
            }}
          >
            Desvincular
          </button>
        </div>
        {test && (
          <div className={`probe__result probe__result--${test.ok ? 'ok' : 'bad'}`} role="status">
            <p>{test.ok ? `Tu equipo respondió en ${(test.ms / 1000).toFixed(1)} s: ${test.result?.summary || 'listo'}.` : test.error}</p>
          </div>
        )}
        {steps}
        {error && <p className="connectors__warning" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="computer">
      {pairing ? (
        <>
          {steps}
          <p className="connector__meta">Esta tarjeta se actualiza sola cuando el equipo queda vinculado.</p>
        </>
      ) : (
        <button
          type="button"
          className="btn btn-primary connector__action"
          disabled={Boolean(busy)}
          onClick={async () => {
            const data = await run('pair-code', 'pair');
            if (data) setPairing(data);
          }}
        >
          <Icon name="monitor" size={14} /> Vincular un equipo
        </button>
      )}
      {error && <p className="connectors__warning" role="alert">{error}</p>}
    </div>
  );
}
