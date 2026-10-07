import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function call(path, options) {
  const res = await fetch(`${API_BASE}/api/connectors/${path}`, { credentials: 'include', ...options });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

function Bar({ label, tanda, active }) {
  const pct = tanda.limit ? Math.min(100, Math.round((tanda.used / tanda.limit) * 100)) : 0;
  return (
    <div className={`usage__tanda${active ? ' usage__tanda--active' : ''}`}>
      <div className="usage__head">
        <span>{label}{active ? ' · ahora' : ''}</span>
        <strong>
          {tanda.used} / {tanda.limit}
        </strong>
      </div>
      <div className="usage__bar" role="progressbar" aria-valuemin={0} aria-valuemax={tanda.limit} aria-valuenow={tanda.used} aria-label={`Peticiones de ${label}`}>
        <span className={pct >= 100 ? 'usage__fill usage__fill--full' : 'usage__fill'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// Configuración → Uso: the day's allowance of requests split in a morning and
// an afternoon tanda (each restores by itself), a button to restore the
// running one, and the switch that sends every answer to Telegram too.
export default function UsageCard() {
  const { user, login } = useAuth();
  const { settings, updateSettings } = useSettings();
  const [usage, setUsage] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await call(`usage?timezone=${encodeURIComponent(timezone())}`);
      if (alive.current) setUsage(data);
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;
    const first = window.setTimeout(refresh, 0);
    const timer = window.setInterval(refresh, 60000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [user, refresh]);

  async function restore() {
    setBusy(true);
    setMessage({ tone: 'wait', text: 'Restaurando…' });
    try {
      const data = await call('usage/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timezone: timezone() }) });
      if (alive.current) {
        setUsage(data);
        setMessage({ tone: 'ok', text: 'Listo: la tanda actual tiene todo su cupo otra vez.' });
      }
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (!user) {
    return (
      <>
        <p className="settings-placeholder">Inicia sesión con Google para ver tu cupo de peticiones y recibir las respuestas también en Telegram.</p>
        <button type="button" className="btn btn-primary" onClick={login}>
          Iniciar sesión con Google
        </button>
      </>
    );
  }

  return (
    <>
      {usage && usage.enabled && (
        <>
          <Bar label="Mañana" tanda={usage.tandas.am} active={usage.current === 'am'} />
          <Bar label="Tarde" tanda={usage.tandas.pm} active={usage.current === 'pm'} />
          <p className="device__meta">
            Cupo del día: <strong>{usage.daily}</strong> peticiones, mitad por tanda. La tanda de {usage.name} se restaura a las {usage.resetsAt}
            {usage.resetsAt.endsWith('.') ? '' : '.'}
          </p>
          <div className="device__actions">
            <button type="button" className="btn" disabled={busy} onClick={restore}>
              Restaurar la tanda actual
            </button>
          </div>
        </>
      )}
      {usage && !usage.enabled && <p className="settings-placeholder">No hay límite diario de peticiones.</p>}
      {message.text && (
        <p className={`device__result device__result--${message.tone}`} role="status">
          {message.text}
        </p>
      )}
      <label className="settings-toggle">
        <input type="checkbox" checked={settings.telegramMirror !== false} onChange={(e) => updateSettings({ telegramMirror: e.target.checked })} />
        <span>Enviar también cada respuesta (redacciones, tareas, agenda, ediciones…) a mi Telegram</span>
      </label>
      <p className="settings-placeholder device__note">
        Cada pregunta que Eddie contesta cuenta como una petición (las que fallan sin responder no cuentan). El tope del día se cambia con la variable <code>DAILY_REQUEST_LIMIT</code> en Vercel (0 = sin límite) y la hora en que
        empieza la tarde con <code>QUOTA_SPLIT_HOUR</code>. Para recibir las respuestas hay que vincular Telegram en Conectores; en Telegram también puedes usar /uso y /restaurar.
      </p>
    </>
  );
}
