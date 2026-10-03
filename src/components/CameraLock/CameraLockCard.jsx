import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelLockRemoval, createPasswordLock, lockStatus, requestLockRemoval } from '../../services/devices';
import { createPasskey, generatePassword, passkeySupported } from '../../services/cameraLock';
import CameraAuth from './CameraAuth';
import './CameraLock.css';

const when = (iso) => (iso ? new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '');

// Creating the lock: once. The password (typed or generated here) is shown with its Copiar button only now,
// and only its hash is kept; there is no "show" or "change" afterwards. Alternatively the device's own
// fingerprint / face / PIN.
function Create({ onCreated }) {
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [mode, setMode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    passkeySupported().then((ok) => alive && setPasskeyOk(ok));
    return () => {
      alive = false;
    };
  }, []);

  function suggest() {
    const generated = generatePassword();
    setPassword(generated);
    setConfirm(generated);
    setCopied(false);
    setSaved(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setError('No pude copiarla sola: selecciónala y cópiala a mano.');
    }
  }

  async function submit(create) {
    setBusy(true);
    setError('');
    try {
      await create();
      setPassword('');
      setConfirm('');
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <>
        <p>
          Antes de que cualquier dispositivo pueda encender una cámara a distancia hace falta esta protección, para que nadie que entre a tu cuenta pueda espiarte. La creas <b>una sola vez</b>: no se vuelve a mostrar ni se puede cambiar. Solo se
          elimina cuando se lo pides a Eddie.
        </p>
        <div className="camera-lock__row">
          {passkeyOk && (
            <button type="button" className="btn btn-primary" onClick={() => setMode('passkey')}>
              Usar huella / rostro / PIN de este equipo
            </button>
          )}
          <button type="button" className="btn" onClick={() => setMode('password')}>
            Crear una contraseña
          </button>
        </div>
        {!passkeyOk && <p className="camera-auth__note">La huella no está disponible aquí (hace falta HTTPS y un lector o PIN del equipo).</p>}
      </>
    );
  }

  if (mode === 'passkey') {
    return (
      <>
        <p>
          El equipo te pedirá tu huella, rostro o PIN. <b>Quedará guardada solo en este dispositivo</b>: para activar cámaras desde otro equipo necesitarás tener este a mano. Si lo pierdes, la protección se elimina esperando 24 horas.
        </p>
        <div className="camera-lock__row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(createPasskey)}>
            {busy ? 'Esperando al equipo…' : 'Crear con mi huella'}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setMode('')}>
            Atrás
          </button>
        </div>
        {error && <p className="camera-auth__note camera-auth__note--bad" role="alert">{error}</p>}
      </>
    );
  }

  const valid = password.length >= 8 && password === confirm && saved;
  return (
    <>
      <p className="camera-lock__warn">Esta es la única vez que verás tu contraseña. Cópiala y guárdala ahora (un gestor de contraseñas, por ejemplo): Eddie no puede recordártela ni mostrártela después.</p>
      <div className="camera-lock__row">
        <button type="button" className="btn" onClick={suggest}>
          Generar una segura
        </button>
        <button type="button" className="btn" disabled={!password} onClick={copy}>
          {copied ? '✔ Copiada' : 'Copiar'}
        </button>
      </div>
      <input className="input" type="text" autoComplete="off" spellCheck={false} placeholder="Contraseña (mínimo 8 caracteres)" aria-label="Contraseña de la cámara" value={password} onChange={(e) => { setPassword(e.target.value); setCopied(false); }} />
      <input className="input" type="text" autoComplete="off" spellCheck={false} placeholder="Repítela" aria-label="Repite la contraseña" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <label className="camera-lock__check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>La copié y la guardé en un lugar seguro. Entiendo que no volverá a aparecer.</span>
      </label>
      <div className="camera-lock__row">
        <button type="button" className="btn btn-primary" disabled={!valid || busy} onClick={() => submit(() => createPasswordLock(password, confirm))}>
          {busy ? 'Creando…' : 'Crear y ocultar para siempre'}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => { setMode(''); setPassword(''); setConfirm(''); setSaved(false); }}>
          Atrás
        </button>
      </div>
      {password && password !== confirm && <p className="camera-auth__note camera-auth__note--bad">Las dos no coinciden.</p>}
      {error && <p className="camera-auth__note camera-auth__note--bad" role="alert">{error}</p>}
    </>
  );
}

// The lock is set: what it is, and the only way out — asked of Eddie (here or in the chat): with the
// proof it goes at once; if the proof is forgotten, after 24 hours (the owner is warned and can cancel).
function Manage({ status, onChange }) {
  const [step, setStep] = useState(''); // '' | 'proof' | 'forgot'
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function run(fn, done) {
    setBusy(true);
    setMessage('');
    try {
      const out = await fn();
      setStep('');
      setToken('');
      if (done) setMessage(done(out));
      onChange();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  const how = [status.methods.passkey && 'huella / rostro / PIN', status.methods.password && 'contraseña'].filter(Boolean).join(' y ');
  return (
    <>
      <div className="camera-lock__row">
        <span className={`chip ${status.locked ? 'bad' : 'on'}`}>{status.locked ? 'BLOQUEADA POR INTENTOS FALLIDOS' : 'CÁMARA PROTEGIDA'}</span>
        <span className="camera-auth__note">Con {how} · creada {when(status.createdAt)}</span>
      </div>
      <p>Cada vez que alguien active una cámara desde otro dispositivo (o desde el chat de Eddie) tendrá que escribir la contraseña o usar la huella. No se puede ver ni cambiar. Telegram no puede encender cámaras.</p>
      {status.locked && <p className="camera-auth__note camera-auth__note--bad">Demasiados intentos. Se desbloquea después de las {when(status.lockedUntil)}.</p>}

      {status.pendingDelete ? (
        <>
          <p className="camera-lock__warn">Eliminación programada para {when(status.pendingDelete)}. Hasta entonces la protección sigue activa. Si no fuiste tú, cancélala.</p>
          <div className="camera-lock__row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(cancelLockRemoval, () => 'Eliminación cancelada.')}>
              Cancelar la eliminación
            </button>
          </div>
        </>
      ) : step === 'proof' ? (
        <>
          <p>Confirma que eres tú para eliminar la protección ahora:</p>
          <CameraAuth onToken={setToken} />
          <div className="camera-lock__row">
            <button type="button" className="btn btn-danger" disabled={!token || busy} onClick={() => run(() => requestLockRemoval(token), () => 'Protección eliminada. Para usar cámaras a distancia tendrás que crear una nueva.')}>
              Eliminar ahora
            </button>
            <button type="button" className="btn" onClick={() => setStep('')}>
              Atrás
            </button>
          </div>
        </>
      ) : step === 'forgot' ? (
        <>
          <p>Si no recuerdas la contraseña o perdiste el equipo con la huella, se puede programar la eliminación: tarda <b>24 horas</b>, te avisaremos por notificación y Telegram, y puedes cancelarla.</p>
          <div className="camera-lock__row">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => run(() => requestLockRemoval(null), (r) => `Eliminación programada para ${when(r.deleteAt)}.`)}>
              Programar eliminación en 24 h
            </button>
            <button type="button" className="btn" onClick={() => setStep('')}>
              Atrás
            </button>
          </div>
        </>
      ) : (
        <div className="camera-lock__row">
          <button type="button" className="btn" onClick={() => setStep('proof')}>
            Eliminar la protección…
          </button>
          <button type="button" className="device__link" onClick={() => setStep('forgot')}>
            No recuerdo mi contraseña
          </button>
        </div>
      )}
      {message && <p className="camera-auth__note" role="status">{message}</p>}
    </>
  );
}

// Configuración → Dispositivos → Seguridad de la cámara.
export default function CameraLockCard() {
  const [state, setState] = useState({ status: 'loading' });
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await lockStatus();
      if (alive.current) setState({ status: 'ready', lock: data });
    } catch (err) {
      if (alive.current) setState({ status: 'error', error: err.message });
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = window.setTimeout(load, 0);
    return () => {
      alive.current = false;
      window.clearTimeout(first);
    };
  }, [load]);

  return (
    <section className="camera-lock" aria-label="Seguridad de la cámara">
      <h3>SEGURIDAD DE LA CÁMARA</h3>
      {state.status === 'loading' && <p>Comprobando…</p>}
      {state.status === 'error' && <p className="camera-auth__note camera-auth__note--bad">{state.error}</p>}
      {state.status === 'ready' && (state.lock.state === 'set' ? <Manage status={state.lock} onChange={load} /> : <Create onCreated={load} />)}
    </section>
  );
}
