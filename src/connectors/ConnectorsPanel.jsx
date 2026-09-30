import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import TelegramControls from './TelegramControls';
import Icon from '../layout/Icon';
import { useConnectors } from './useConnectors';
import './Connectors.css';

// Server statuses (see describeConnectors in api/_lib/connectors/registry.js)
// plus "off", which is the user's own switch and lives in their settings.
const STATUS = {
  ready: { label: 'Listo', tone: 'on' },
  connected: { label: 'Conectado', tone: 'on' },
  off: { label: 'Apagado', tone: '' },
  needs_account: { label: 'Por conectar', tone: 'warn' },
  needs_setup: { label: 'Falta configurar', tone: 'bad' },
  planned: { label: 'Próximamente', tone: '' },
};

const CATEGORY = { asistente: 'Asistente', informacion: 'Información', comunicacion: 'Comunicación', agenda: 'Agenda' };

const isLive = (c) => c.status === 'ready' || c.status === 'connected';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

function ConnectorCard({ connector, enabled, onToggle, onConnect, userEmail, onChanged }) {
  const switchable = isLive(connector) && connector.tools.length > 0;
  const status = STATUS[switchable && !enabled ? 'off' : connector.status] || STATUS.planned;

  return (
    <article
      className={`glass-panel connector connector--${connector.status} ${switchable && !enabled ? 'connector--off' : ''}`}
      aria-label={connector.name}
    >
      <header className="connector__head">
        <span className="connector__icon" aria-hidden="true">
          <Icon name={connector.icon || 'plug'} size={20} />
        </span>
        <div className="connector__title">
          {CATEGORY[connector.category] && <span className="connector__category">{CATEGORY[connector.category]}</span>}
          <h3>{connector.name}</h3>
          <span className={`chip ${status.tone}`}>{status.label}</span>
        </div>
        {switchable && (
          <button
            type="button"
            className="connector__switch"
            role="switch"
            aria-checked={enabled}
            aria-label={`${connector.name}: ${enabled ? 'encendido' : 'apagado'}`}
            onClick={() => onToggle(connector.id, !enabled)}
          />
        )}
      </header>

      <p className="connector__desc">{connector.description}</p>

      {connector.tools.length > 0 && (
        <ul className="connector__tools" aria-label="Lo que Eddie puede hacer">
          {connector.tools.map((t) => (
            <li key={t.name}>
              {t.label}
              {t.risk === 'confirm' && <span className="connector__confirm"> · con tu confirmación</span>}
              {t.risk === 'write' && <span className="connector__write"> · guarda cambios</span>}
            </li>
          ))}
        </ul>
      )}

      {connector.status === 'connected' && userEmail && <p className="connector__meta">Conectado como {userEmail}</p>}
      {connector.note && <p className="connector__meta">{connector.note}</p>}

      {connector.status === 'needs_account' && connector.auth === 'google-login' && !connector.connectScope && (
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Conectar con Google
        </button>
      )}
      {connector.status === 'needs_account' && connector.auth === 'google-login' && connector.connectScope && (
        // Asks Google for this connector's extra permissions (and signs in
        // too if needed); Google then sends the user back here.
        <a className="btn btn-primary connector__action" href={`${API_BASE}/api/auth/google/start?scope=${connector.connectScope}`}>
          Conectar {connector.name}
        </a>
      )}

      {connector.id === 'telegram' && <TelegramControls connector={connector} signedIn={Boolean(userEmail)} onConnect={onConnect} onChanged={onChanged} />}

      {connector.status === 'needs_setup' && (
        <p className="connector__setup">
          Falta configurar en Vercel:{' '}
          {connector.missingEnv.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </p>
      )}

      {connector.status === 'planned' && (
        <p className="connector__meta">
          Sesión {connector.session} del plan · a más tardar el {connector.due}
        </p>
      )}
    </article>
  );
}

function Section({ title, children }) {
  return (
    <section className="connectors__section">
      <h2 className="connectors__heading">{title}</h2>
      <div className="connectors__grid">{children}</div>
    </section>
  );
}

// Why the user came back from Google (see the ?connected / ?google_error
// handling in App.jsx).
function connectNotice(notice, connectors) {
  if (!notice) return null;
  const name = connectors.find((c) => c.id === notice.connector)?.name || notice.connector;
  if (notice.type === 'connected') {
    const card = connectors.find((c) => c.id === notice.connector);
    if (card && card.status !== 'connected') {
      return { tone: 'warn', text: `Google no dio todos los permisos de ${name}. Vuelve a pulsar "Conectar ${name}" y marca todas las casillas.` };
    }
    return { tone: 'ok', text: `${name} quedó conectado. Ya puedes pedírselo a Eddie.` };
  }
  if (notice.error === 'missing_secret') return { tone: 'bad', text: `Para conectar ${name} falta configurar CONNECTOR_SECRET en Vercel.` };
  if (notice.error === 'access_denied') return { tone: 'warn', text: `No se conectó ${name}: cancelaste el permiso en Google.` };
  return { tone: 'bad', text: `No se pudo conectar ${name} (${notice.error}).` };
}

export default function ConnectorsPanel({ notice = null }) {
  const { user, login } = useAuth();
  const { settings, setConnectorEnabled } = useSettings();
  const { status, connectors, error, reload } = useConnectors(user?.id || null);
  const off = new Set(settings.disabledConnectors || []);

  const live = connectors.filter(isLive);
  const pending = connectors.filter((c) => c.status === 'needs_account' || c.status === 'needs_setup');
  const planned = connectors.filter((c) => c.status === 'planned');
  const activeTools = live.filter((c) => !off.has(c.id)).reduce((n, c) => n + c.tools.length, 0);
  const banner = status === 'ready' ? connectNotice(notice, connectors) : null;

  const card = (c) => (
    <ConnectorCard
      key={c.id}
      connector={c}
      enabled={!off.has(c.id)}
      onToggle={setConnectorEnabled}
      onConnect={login}
      userEmail={user?.email}
      onChanged={reload}
    />
  );

  return (
    <section className="connectors">
      <div className="glass-panel connectors__summary">
        <p>
          Los conectores le dan a Eddie acceso a datos y servicios reales. Apaga los que no quieras que use: sus herramientas dejan de
          ofrecerse en el chat.
        </p>
        {status === 'ready' && (
          <div className="chips">
            <span className={`chip ${activeTools ? 'on' : ''}`}>
              {activeTools} {activeTools === 1 ? 'herramienta activa' : 'herramientas activas'}
            </span>
            <span className={`chip ${pending.length ? 'warn' : ''}`}>{pending.length} por conectar</span>
            <span className="chip">{planned.length} próximamente</span>
          </div>
        )}
        {settings.provider === 'claude' && (
          <p className="connectors__warning">
            Con Claude, Eddie responde sin herramientas. Elige Gemini, Groq u OpenRouter en Configuración para usar tus conectores.
          </p>
        )}
      </div>

      {banner && (
        <p className={`glass-panel connectors__notice connectors__notice--${banner.tone}`} role="status">
          {banner.text}
        </p>
      )}

      {status === 'loading' && <p className="connectors__state">Cargando conectores…</p>}

      {status === 'error' && (
        <div className="glass-panel connectors__state connectors__state--error" role="alert">
          <p>No se pudo cargar la lista de conectores: {error}</p>
          <button type="button" className="btn" onClick={reload}>
            Reintentar
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          {live.length > 0 && <Section title="Activos">{live.map(card)}</Section>}
          {pending.length > 0 && <Section title="Por conectar">{pending.map(card)}</Section>}
          {planned.length > 0 && <Section title="Próximamente">{planned.map(card)}</Section>}
        </>
      )}
    </section>
  );
}
