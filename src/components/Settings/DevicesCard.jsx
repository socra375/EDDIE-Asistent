import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ago } from '../../services/devicePlatform';
import { commandState, listDevices, removeDevice, renameDevice, sendCommand } from '../../services/devices';
import { readIdentity, updateIdentity } from '../../services/deviceIdentity';
import { REMOTE_VIEW_EVENT } from '../../services/remoteShare';
import CameraLockCard from '../CameraLock/CameraLockCard';
import { cameraSupported, describeCameraError, readConsent, stopStream, writeConsent } from '../../services/camera';

const REFRESH_MS = 15_000;
const RESULT_POLL_MS = 500;
const RESULT_WAIT_MS = 18_000;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// This device's camera, ready for use from another device: Eddie's own consent and the browser's permission
// are both given here, once, while sitting in front of it — after that another device can switch it on from
// anywhere without anyone having to accept anything (the point of leaving a PC at home as a camera).
function CameraReady() {
  const [consent, setConsent] = useState(readConsent);
  const [permission, setPermission] = useState('unknown'); // granted | prompt | denied | unknown
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let status = null;
    let alive = true;
    const read = () => alive && setPermission(status?.state || 'unknown');
    navigator.permissions
      ?.query({ name: 'camera' })
      .then((s) => {
        status = s;
        read();
        s.onchange = read;
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (status) status.onchange = null;
    };
  }, []);

  async function grant() {
    setBusy(true);
    setMessage('');
    writeConsent();
    setConsent(true);
    try {
      // Opened and closed at once: it is only so the browser asks now and remembers the answer.
      stopStream(await navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      setPermission('granted');
      setMessage('Listo: esta cámara se puede activar desde otro dispositivo sin preguntar.');
    } catch (err) {
      setMessage(describeCameraError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!cameraSupported()) return <p className="device__meta">Este navegador no permite usar la cámara.</p>;
  const ready = consent && permission === 'granted';
  return (
    <div className="device__camera">
      <span className={`chip ${ready ? 'on' : permission === 'denied' ? 'bad' : 'warn'}`}>{ready ? 'CÁMARA LISTA PARA USO REMOTO' : permission === 'denied' ? 'CÁMARA BLOQUEADA' : 'FALTA EL PERMISO DE LA CÁMARA'}</span>
      {!ready && (
        <button type="button" className="btn" disabled={busy || permission === 'denied'} onClick={grant} title="Se pide una sola vez, delante de este equipo">
          Dar permiso de cámara
        </button>
      )}
      {permission === 'denied' && <span className="device__meta">Desbloquéala en el candado de la barra de direcciones.</span>}
      {message && <span className="device__meta">{message}</span>}
    </div>
  );
}

// One of the account's devices: where it is, whether it is on, and what can
// be done with it from here.
function DeviceRow({ device, busy, result, onCommand, onRename, onRemove, identity, onToggleRemote }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const reachable = device.online && device.remoteEnabled && !device.current;
  const why = device.current ? 'Es este dispositivo' : !device.remoteEnabled ? 'Ese dispositivo no permite el control remoto' : !device.online ? 'Ese dispositivo está apagado o sin conexión' : '';

  function save(e) {
    e.preventDefault();
    setEditing(false);
    if (draft.trim() && draft.trim() !== device.name) onRename(device, draft.trim());
  }

  return (
    <li className={`device ${device.online ? 'device--on' : ''}`}>
      <span className={`device__dot ${device.online ? 'device__dot--on' : ''}`} aria-label={device.online ? 'Encendido' : 'Apagado'} />
      <div className="device__body">
        <div className="device__title">
          {editing ? (
            <form onSubmit={save} className="device__rename">
              <input className="input" value={draft} maxLength={40} autoFocus onChange={(e) => setDraft(e.target.value)} aria-label="Nombre del dispositivo" />
              <button type="submit" className="btn">
                Guardar
              </button>
            </form>
          ) : (
            <>
              <strong>{device.name}</strong>
              {device.current && <span className="chip on">Este dispositivo</span>}
              <button
                type="button"
                className="device__link"
                onClick={() => {
                  setDraft(device.name);
                  setEditing(true);
                }}
              >
                Renombrar
              </button>
            </>
          )}
        </div>
        <span className="device__meta">
          {device.platform || 'Navegador'} · {device.online ? 'encendido ahora' : `visto ${ago(device.lastSeen)}`} · control remoto: {device.remoteEnabled ? 'sí' : 'no'}
        </span>

        {device.current ? (
          <label className="settings-toggle device__toggle">
            <input type="checkbox" checked={identity.allowRemote} onChange={(e) => onToggleRemote(e.target.checked)} />
            <span>Permitir que mis otros dispositivos activen la cámara y vean lo que ve (sin preguntar)</span>
          </label>
        ) : null}
        {device.current ? (
          <CameraReady />
        ) : (
          <div className="device__actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reachable}
              title={why || 'Enciende su cámara, mira lo que ve aquí y Eddie te va contando lo que pasa'}
              onClick={() => window.dispatchEvent(new CustomEvent(REMOTE_VIEW_EVENT, { detail: { deviceId: device.id, name: device.name } }))}
            >
              Activar vigilancia y ver
            </button>
            <button
              type="button"
              className="btn"
              disabled={!reachable || busy}
              title={why}
              onClick={() => {
                window.dispatchEvent(new CustomEvent(REMOTE_VIEW_EVENT, { detail: { deviceId: device.id, close: true } }));
                onCommand(device, 'vigilance_off');
              }}
            >
              Apagar vigilancia
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => onRemove(device)}>
              Quitar
            </button>
          </div>
        )}
        {result && (
          <p className={`device__result device__result--${result.tone}`} role="status">
            {result.text}
          </p>
        )}
      </div>
    </li>
  );
}

// Configuración → Dispositivos: the devices signed in to this account, which
// are on, and the switch for Modo Vigilancia on each one.
export default function DevicesCard() {
  const { user, login } = useAuth();
  const [identity, setIdentity] = useState(readIdentity);
  const [state, setState] = useState({ status: 'loading', devices: [], others: [], error: '' });
  const [busy, setBusy] = useState({});
  const [results, setResults] = useState({});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await listDevices(readIdentity().clientId);
      if (alive.current) setState({ status: 'ready', devices: data.devices || [], others: data.others || [], error: '' });
    } catch (err) {
      if (alive.current) setState((s) => ({ ...s, status: s.devices.length ? 'ready' : 'error', error: err.message }));
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => !document.hidden && load(), REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [user, load]);

  const say = (id, tone, text) => setResults((r) => ({ ...r, [id]: { tone, text } }));

  async function command(device, action) {
    setBusy((b) => ({ ...b, [device.id]: true }));
    say(device.id, 'wait', `Enviando la orden a ${device.name}…`);
    try {
      const sent = await sendCommand(device.id, action);
      const started = Date.now();
      for (;;) {
        await wait(RESULT_POLL_MS);
        const s = await commandState(sent.id);
        if (['done', 'consent', 'error'].includes(s.status)) {
          say(device.id, s.status === 'done' ? 'ok' : s.status === 'consent' ? 'wait' : 'bad', s.text);
          break;
        }
        if (Date.now() - started > RESULT_WAIT_MS) {
          say(device.id, 'bad', `${device.name} no respondió a tiempo. Puede que Eddie esté cerrado o en segundo plano allí.`);
          break;
        }
      }
    } catch (err) {
      say(device.id, 'bad', err.message);
    } finally {
      if (alive.current) {
        setBusy((b) => ({ ...b, [device.id]: false }));
        load();
      }
    }
  }

  async function rename(device, name) {
    try {
      await renameDevice(device.id, name);
      if (device.current) setIdentity(updateIdentity({ name }));
      load();
    } catch (err) {
      say(device.id, 'bad', err.message);
    }
  }

  async function remove(device) {
    if (!window.confirm(`¿Quitar «${device.name}» de tu cuenta? Se cerrará su sesión y tendrá que volver a iniciar sesión.`)) return;
    try {
      await removeDevice(device.id);
      load();
    } catch (err) {
      say(device.id, 'bad', err.message);
    }
  }

  if (!user) {
    return (
      <>
        <p className="settings-placeholder">Inicia sesión con Google para conectar tus dispositivos a la misma cuenta, verlos aquí y manejarlos desde cualquiera de ellos o desde Telegram.</p>
        <button type="button" className="btn btn-primary" onClick={login}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  return (
    <>
      <CameraLockCard />
      {state.status === 'error' && <p className="settings-warning">{state.error}</p>}
      {state.status === 'loading' && <p className="settings-placeholder">Buscando tus dispositivos…</p>}
      {state.status === 'ready' && (
        <ul className="devices" aria-label="Dispositivos de tu cuenta">
          {state.devices.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              busy={Boolean(busy[d.id])}
              result={results[d.id]}
              identity={identity}
              onCommand={command}
              onRename={rename}
              onRemove={remove}
              onToggleRemote={(allowRemote) => {
                setIdentity(updateIdentity({ allowRemote }));
                window.setTimeout(load, 1500);
              }}
            />
          ))}
          {state.others.map((o) => (
            <li key={o.kind} className={`device ${o.linked ? 'device--on' : ''}`}>
              <span className={`device__dot ${o.kind === 'computer' ? (o.online ? 'device__dot--on' : '') : o.linked ? 'device__dot--on' : ''}`} />
              <div className="device__body">
                <div className="device__title">
                  <strong>{o.name}</strong>
                  <span className="chip">{o.kind === 'telegram' ? 'Canal' : 'EDDIE Prime'}</span>
                </div>
                <span className="device__meta">
                  {o.kind === 'telegram'
                    ? o.linked
                      ? 'Vinculado: puedes pedirle a Eddie que active o apague la vigilancia en un dispositivo (con la protección de la cámara encendida, encenderla solo se puede desde la app).'
                      : 'Sin vincular: vincúlalo en Conectores para manejar tus dispositivos desde el chat de Telegram.'
                    : `${o.online ? 'encendido ahora' : `visto ${ago(o.lastSeen)}`} · agente de tu equipo`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="device__foot">
        <button type="button" className="btn" onClick={load}>
          Actualizar
        </button>
        <p className="settings-placeholder device__note">
          Un dispositivo aparece cuando abres Eddie en él con esta misma cuenta, y cuenta como «encendido» mientras Eddie siga abierto. Para que otro dispositivo pueda activarle la
          vigilancia, el control remoto debe estar permitido allí (apagado por defecto) y, si la protección de la cámara está encendida (arriba), cada activación pide tu contraseña o tu huella. La cámara siempre muestra el chip rojo y, la primera vez, pide permiso en ese equipo.
        </p>
      </div>
    </>
  );
}
