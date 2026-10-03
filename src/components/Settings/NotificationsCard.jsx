import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { readIdentity } from '../../services/deviceIdentity';
import { disablePush, enablePush, needsInstall, pushState, sendTestPush } from '../../services/push';

// Configuración → Dispositivos: notifications that reach this device with
// Eddie closed (reminders, the morning summary).
export default function NotificationsCard() {
  const { user, login } = useAuth();
  const [state, setState] = useState({ supported: true, permission: 'default', endpoint: '', subscribed: false, devices: 0, loading: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await pushState(Boolean(user));
    if (alive.current) setState({ ...next, loading: false });
  }, [user]);

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function run(task, doneText) {
    setBusy(true);
    setMessage({ tone: 'wait', text: 'Un momento…' });
    try {
      await task();
      if (alive.current) setMessage({ tone: 'ok', text: doneText });
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy(false);
      refresh();
    }
  }

  const enable = () => run(() => enablePush({ clientId: readIdentity().clientId, platform: readIdentity().platform }), 'Listo: este dispositivo recibirá las notificaciones de Eddie.');
  const disable = () => run(disablePush, 'Notificaciones desactivadas en este dispositivo.');
  const test = () =>
    run(async () => {
      const r = await sendTestPush();
      if (!r.sent) throw new Error(r.removed ? 'El navegador ya no estaba registrado: vuelve a activar las notificaciones.' : 'El servicio de notificaciones no entregó la prueba. Inténtalo de nuevo en un momento.');
    }, 'Prueba enviada: debería aparecer una notificación en unos segundos.');

  if (!user) {
    return (
      <>
        <p className="settings-placeholder">Inicia sesión con Google para recibir recordatorios y el resumen de la mañana como notificación, aunque Eddie esté cerrado.</p>
        <button type="button" className="btn btn-primary" onClick={login}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  if (!state.loading && !state.supported) {
    return (
      <p className="settings-placeholder">
        {needsInstall()
          ? 'En iPhone y iPad las notificaciones solo funcionan con Eddie añadido a la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y abierto desde ahí.'
          : 'Este navegador no admite notificaciones en segundo plano. Prueba con Chrome, Edge, Firefox o Safari reciente (o instala Eddie como app).'}
      </p>
    );
  }

  const denied = state.permission === 'denied';
  return (
    <>
      <p className="device__meta">
        Este dispositivo: <strong>{state.loading ? '…' : state.subscribed ? 'recibe notificaciones' : denied ? 'bloqueadas por el navegador' : 'sin notificaciones'}</strong> · dispositivos de tu cuenta con
        notificaciones: {state.devices}
      </p>
      <div className="device__actions">
        {state.subscribed ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={test}>
              Enviar prueba
            </button>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={disable}>
              Desactivar aquí
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" disabled={busy || state.loading || denied} onClick={enable}>
            Activar notificaciones aquí
          </button>
        )}
      </div>
      {denied && <p className="settings-warning">El navegador las tiene bloqueadas para Eddie: permítelas en el candado de la barra de direcciones y vuelve aquí.</p>}
      {message.text && (
        <p className={`device__result device__result--${message.tone}`} role="status">
          {message.text}
        </p>
      )}
      <p className="settings-placeholder device__note">
        Con esto, los recordatorios («avísame en 20 minutos…») y el resumen de la mañana te llegan a este dispositivo aunque Eddie esté cerrado, sin necesitar Telegram. Es lo que un navegador permite en segundo plano: no puede
        escuchar el micrófono ni la palabra clave con la app cerrada (para hablarle desde cualquier lugar usa Telegram). En iPhone solo funciona con Eddie instalado en la pantalla de inicio. Los avisos pueden tardar unos minutos
        (el trabajo programado corre cada 5 min).
      </p>
    </>
  );
}
