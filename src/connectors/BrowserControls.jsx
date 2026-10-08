import { useEffect, useState } from 'react';
import Icon from '../layout/Icon';
import { bridgeState, initBridge, onBridgeChange, pairExtension, refreshBridge, unlinkExtension } from '../services/browserBridge';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 4000;

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/browser/${action}`, {
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

// 1.2.0 < 1.10.0
function olderThan(a, b) {
  const x = String(a || '0').split('.').map(Number);
  const y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  }
  return false;
}

function browserName() {
  const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || 'este equipo';
  return `Chrome en ${platform}`.slice(0, 60);
}

function useBridge() {
  const [bridge, setBridge] = useState(bridgeState());
  useEffect(() => {
    initBridge();
    const off = onBridgeChange(setBridge);
    refreshBridge();
    return off;
  }, []);
  return bridge;
}

// A command to copy (chrome:// pages can't be opened from a web page).
function Copy({ text }) {
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

// "Tu navegador": download and load the extension, link it with one button
// (the page hands it the code), choose what it opens by itself, test it.
export default function BrowserControls({ connector, signedIn, onConnect, onChanged }) {
  const bridge = useBridge();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [test, setTest] = useState(null);
  const connected = connector.status === 'connected';
  const link = connector.details?.browser;
  const latest = connector.details?.latestVersion;
  const saved = link?.prefs || { autoMeetings: true, leadMinutes: 1, openCreated: true };
  // A choice shows at once; it counts only while the server's answer is still the one it was made against.
  const [pending, setPending] = useState(null);
  const prefs = pending && pending.base === JSON.stringify(saved) ? { ...saved, ...pending.change } : saved;

  // While waiting for the user to install it, notice it when they come back.
  useEffect(() => {
    if (connected || bridge.installed) return undefined;
    const timer = window.setInterval(() => refreshBridge(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [connected, bridge.installed]);

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      return await fn();
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
        <p className="connector__meta">Para vincular tu navegador, primero inicia sesión con Google.</p>
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  async function linkHere() {
    const state = await refreshBridge();
    if (!state.installed) throw new Error('No detecto la extensión en este navegador. Instálala (pasos 1 y 2) y recarga Eddie.');
    const { code } = await post('pair-code');
    const result = await pairExtension({ server: API_BASE || window.location.origin, code, name: browserName() });
    if (!result.ok) {
      if (result.error === 'permission') {
        throw new Error('La extensión no tiene permiso para hablar con esta dirección de Eddie. Ábrela desde su ícono en Chrome y usa «Vincular con un código».');
      }
      throw new Error(result.error || 'No se pudo vincular.');
    }
    onChanged(true);
  }

  async function setPref(change) {
    setPending({ base: JSON.stringify(saved), change: { ...(pending?.base === JSON.stringify(saved) ? pending.change : {}), ...change } });
    const done = await run('prefs', async () => {
      await post('prefs', change);
      onChanged(true);
      return true;
    });
    if (!done) setPending(null); // it didn't save: back to what the server has
  }

  if (connected && link) {
    const outdated = latest && olderThan(bridge.version || link.version, latest);
    return (
      <div className="computer">
        <p className="connector__meta">
          <strong>{link.name}</strong> · extensión {link.version || '?'} · último contacto {ago(link.lastSeen)} (revisa cada 30 segundos)
        </p>
        {!bridge.installed && (
          <p className="connector__meta">Este navegador no tiene la extensión: está vinculado otro. Puedes instalarla aquí también (pasos de abajo).</p>
        )}
        {outdated && (
          <p className="connector__meta">
            Hay una versión nueva ({latest}): <a href="/eddie-extension.zip" download>descárgala</a>, reemplaza la carpeta y pulsa «Recargar» en chrome://extensions.
          </p>
        )}
        <div className="browserlink__options">
          <label className="browserlink__option">
            <input type="checkbox" checked={prefs.autoMeetings} disabled={busy === 'prefs'} onChange={(e) => setPref({ autoMeetings: e.target.checked })} />
            <span>Abrir mis reuniones del calendario a su hora</span>
          </label>
          {prefs.autoMeetings && (
            <label className="browserlink__option browserlink__option--sub">
              <span>Abrirlas</span>
              <select value={prefs.leadMinutes} disabled={busy === 'prefs'} onChange={(e) => setPref({ leadMinutes: Number(e.target.value) })}>
                {[0, 1, 2, 3, 5, 10].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? 'justo a la hora' : `${m} min antes`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="browserlink__option">
            <input type="checkbox" checked={prefs.openCreated} disabled={busy === 'prefs'} onChange={(e) => setPref({ openCreated: e.target.checked })} />
            <span>Abrir lo que Eddie cree (documentos, hojas, presentaciones)</span>
          </label>
        </div>
        <div className="probe__actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={async () => {
              setTest(null);
              const data = await run('test', () => post('test'));
              if (data) {
                setTest(data);
                onChanged(true);
              }
            }}
          >
            {busy === 'test' ? 'Esperando al navegador…' : 'Probar'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={Boolean(busy)}
            onClick={async () => {
              const ok = await run('unlink', async () => {
                await post('unlink');
                if (bridge.installed) await unlinkExtension();
                return true;
              });
              if (ok) {
                setTest(null);
                onChanged(true);
              }
            }}
          >
            Desvincular
          </button>
        </div>
        {test && (
          <div className={`probe__result probe__result--${test.ok ? 'ok' : 'bad'}`} role="status">
            <p>{test.ok ? `Tu navegador abrió la página de prueba en ${test.seconds} s.` : test.error}</p>
          </div>
        )}
        {error && (
          <p className="connectors__warning" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="computer">
      <ol className="computer__steps">
        <li>
          <a href="/eddie-extension.zip" download>
            Descarga la extensión
          </a>{' '}
          y descomprímela: se crea la carpeta <code>eddie-extension</code>.
        </li>
        <li>
          En Chrome abre esta dirección (cópiala y pégala), activa el <strong>Modo de desarrollador</strong>, pulsa <strong>Cargar descomprimida</strong> y elige esa carpeta:
          <Copy text="chrome://extensions" />
        </li>
        <li>
          Recarga Eddie y pulsa <strong>Vincular este navegador</strong>.
          {bridge.installed && <span className="browserlink__found"> ✓ Extensión detectada.</span>}
        </li>
      </ol>
      <button type="button" className="btn btn-primary connector__action" disabled={Boolean(busy)} onClick={() => run('link', linkHere)}>
        <Icon name="globe" size={14} /> {busy === 'link' ? 'Vinculando…' : 'Vincular este navegador'}
      </button>
      <p className="connector__meta">La extensión solo abre pestañas: no lee ni controla lo que tienes abierto.</p>
      {error && (
        <p className="connectors__warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
