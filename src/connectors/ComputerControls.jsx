import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 4000;

const PLATFORM = { windows: 'Windows', mac: 'Mac', linux: 'Linux', chromebook: 'Chromebook' };

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

// Hands a text file to the browser's downloads (the installer is generated on the server, per user).
function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// EDDIE Prime's card: link the computer with a one-time code (three
// commands to paste in the Linux terminal), then test it from the cloud or
// unlink it. While a code is showing the card refreshes quietly and flips to
// "Conectado" once the agent has paired.
export default function ComputerControls({ connector, signedIn, onConnect, onChanged }) {
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // The result of "Probar" for one computer: { id, ok, ms, result, error }.
  const [test, setTest] = useState(null);
  // The Windows installer that was just downloaded: { filename, minutes }.
  const [installer, setInstaller] = useState(null);
  const connected = connector.status === 'connected';
  const devices = connector.details?.devices || [];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // While a code is out (the installer, or the Linux commands), the card refreshes quietly until
  // one more computer shows up; then the steps go away and the new computer is in the list.
  const [baseline, setBaseline] = useState(0);
  const waiting = Boolean(pairing || installer) && devices.length <= baseline;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = window.setInterval(() => onChanged(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, onChanged]);

  async function run(action, label, body) {
    setBusy(label);
    setError('');
    try {
      return await post(action, body);
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

  async function downloadInstaller() {
    const data = await run('installer', 'installer');
    if (!data) return;
    downloadText(data.filename, data.content);
    setBaseline(devices.length);
    setInstaller({ filename: data.filename, minutes: data.minutes });
    setPairing(null);
  }

  const installerButton = (
    <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={downloadInstaller}>
      <Icon name="monitor" size={14} /> {busy === 'installer' ? 'Preparando…' : 'Descargar instalador para Windows'}
    </button>
  );

  const installerSteps = waiting && installer && (
    <ol className="computer__steps">
      <li>
        Abre <code>{installer.filename}</code> (está en tu carpeta de Descargas) con doble clic. Es un archivo de texto: puedes abrirlo con el Bloc de notas y leer
        qué hace antes de ejecutarlo.
      </li>
      <li>
        Si Windows dice «Windows protegió tu PC», pulsa <strong>Más información → Ejecutar de todas formas</strong> (el instalador no está firmado).
      </li>
      <li>
        Espera a que diga <strong>Listo</strong>: instala lo que falte, se vincula y queda en segundo plano, arrancando solo cada vez que inicias sesión. Para quitarlo:
        Configuración de Windows → Aplicaciones → EDDIE Prime.
      </li>
      <li>El código del instalador dura {installer.minutes} minutos y sirve una vez: si caduca, descarga otro. Puedes tener varios equipos vinculados; instalar otra vez en este mismo PC lo actualiza.</li>
    </ol>
  );

  const steps = waiting && pairing && (
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

  if (connected && devices.length > 0) {
    return (
      <div className="computer">
        <ul className="computer__devices" aria-label="Equipos vinculados">
          {devices.map((device) => (
            <li key={device.id} className="computer__device">
              <p className="connector__meta">
                <strong>{device.name}</strong>
                {device.platform ? ` · ${PLATFORM[device.platform] || device.platform}` : ''} · agente {device.version || '?'} · último contacto {ago(device.lastSeen)} (solo se conecta cuando hay trabajo)
              </p>
              {device.tools?.length > 0 && (
                <p className="connector__meta">Puede: {device.tools.map((t) => `${t.label}${t.risk === 'confirm' ? ' (con confirmación)' : ''}`).join(' · ')}</p>
              )}
              <div className="probe__actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(busy)}
                  aria-label={`Probar ${device.name}`}
                  onClick={async () => {
                    setTest(null);
                    const data = await run('test', `test-${device.id}`, { id: device.id });
                    if (data) {
                      setTest({ id: device.id, ...data });
                      onChanged(true);
                    }
                  }}
                >
                  {busy === `test-${device.id}` ? 'Esperando al equipo…' : 'Probar desde la nube'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={Boolean(busy)}
                  aria-label={`Desvincular ${device.name}`}
                  onClick={async () => {
                    if (await run('unlink', `unlink-${device.id}`, { id: device.id })) {
                      setTest(null);
                      onChanged(true);
                    }
                  }}
                >
                  Desvincular
                </button>
              </div>
              {test?.id === device.id && (
                <div className={`probe__result probe__result--${test.ok ? 'ok' : 'bad'}`} role="status">
                  <p>{test.ok ? `«${device.name}» respondió en ${(test.ms / 1000).toFixed(1)} s: ${test.result?.summary || 'listo'}.` : test.error}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="probe__actions">
          {installerButton}
          <button
            type="button"
            className="btn"
            disabled={Boolean(busy)}
            onClick={async () => {
              const data = await run('pair-code', 'pair');
              if (data) {
                setBaseline(devices.length);
                setPairing(data);
                setInstaller(null);
              }
            }}
          >
            Vincular otro equipo (Linux)
          </button>
        </div>
        {devices.length > 1 && <p className="connector__meta">Con varios equipos, dile a Eddie cuál: «abre la calculadora en el PC», «¿cuánto disco queda en el Chromebook?».</p>}
        {installerSteps}
        {steps}
        {error && <p className="connectors__warning" role="alert">{error}</p>}
      </div>
    );
  }

  return (
    <div className="computer">
      {pairing || installer ? (
        <>
          {installerSteps}
          {steps}
          <p className="connector__meta">Esta tarjeta se actualiza sola cuando el equipo queda vinculado.</p>
        </>
      ) : (
        <>
          <p className="connector__meta">
            <strong>Windows:</strong> descarga el instalador, ábrelo y listo: se queda en segundo plano y arranca solo. <strong>Linux o Chromebook:</strong> se vincula con tres comandos en la terminal (en el Chromebook, Linux se apaga al cerrar la terminal; ahí
            conviene más la extensión «Tu navegador»).
          </p>
          <div className="probe__actions">
            {installerButton}
            <button
              type="button"
              className="btn"
              disabled={Boolean(busy)}
              onClick={async () => {
                const data = await run('pair-code', 'pair');
                if (data) {
                setBaseline(devices.length);
                setPairing(data);
                setInstaller(null);
              }
              }}
            >
              Vincular con comandos (Linux)
            </button>
          </div>
        </>
      )}
      {error && <p className="connectors__warning" role="alert">{error}</p>}
    </div>
  );
}
