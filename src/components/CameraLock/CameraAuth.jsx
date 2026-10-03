import { useCallback, useEffect, useRef, useState } from 'react';
import { lockStatus } from '../../services/devices';
import { proveWithPasskey, proveWithPassword } from '../../services/cameraLock';
import './CameraLock.css';

const TOKEN_TTL_MS = 110_000; // the server's token lasts 120 s

// Asks for the camera lock's proof — the password and/or the device's fingerprint — and hands the
// one-use token to `onToken` (and '' when it runs out). The password never leaves this component
// except to the server: not in the chat, not in the card's stored arguments.
export default function CameraAuth({ onToken, label = 'Contraseña de la cámara' }) {
  const [methods, setMethods] = useState(null); // { password, passkey } | 'none' | 'error'
  const [password, setPassword] = useState('');
  const [state, setState] = useState('idle'); // idle | busy | ok
  const [error, setError] = useState('');
  const timer = useRef(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    lockStatus()
      .then((s) => alive.current && setMethods(s.state === 'set' ? s.methods : 'none'))
      .catch((err) => {
        if (!alive.current) return;
        setMethods('error');
        setError(err.message);
      });
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const granted = useCallback(
    (token) => {
      if (!alive.current) return;
      setState('ok');
      setPassword('');
      onToken(token);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (!alive.current) return;
        setState('idle');
        onToken('');
        setError('La autorización caducó. Vuelve a confirmarla.');
      }, TOKEN_TTL_MS);
    },
    [onToken],
  );

  async function run(prove) {
    setState('busy');
    setError('');
    try {
      granted(await prove());
    } catch (err) {
      if (!alive.current) return;
      setState('idle');
      setError(err.message);
    }
  }

  if (methods === null) return <p className="camera-auth__note">Comprobando la seguridad de la cámara…</p>;
  if (methods === 'none') return <p className="camera-auth__note camera-auth__note--bad">Todavía no hay contraseña de cámara: créala en Configuración → Dispositivos.</p>;
  if (methods === 'error') return <p className="camera-auth__note camera-auth__note--bad">{error}</p>;
  if (state === 'ok') return <p className="camera-auth__note camera-auth__note--ok" role="status">✔ Autorizado (vale para esta activación)</p>;

  return (
    <div className="camera-auth">
      {methods.passkey && (
        <button type="button" className="btn" disabled={state === 'busy'} onClick={() => run(proveWithPasskey)}>
          Usar mi huella / rostro
        </button>
      )}
      {methods.password && (
        <form
          className="camera-auth__row"
          onSubmit={(e) => {
            e.preventDefault();
            if (password) run(() => proveWithPassword(password));
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={label}
            aria-label={label}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={state === 'busy'}
          />
          <button type="submit" className="btn" disabled={!password || state === 'busy'}>
            {state === 'busy' ? 'Verificando…' : 'Verificar'}
          </button>
        </form>
      )}
      {error && (
        <p className="camera-auth__note camera-auth__note--bad" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
