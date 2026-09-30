import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
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

const isLive = (c) => c.status === 'ready' || c.status === 'connected';

function ConnectorCard({ connector, enabled, onToggle, onConnect, userEmail }) {
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
              {t.sensitive && <span className="connector__confirm"> · con tu confirmación</span>}
            </li>
          ))}
        </ul>
      )}

      {connector.status === 'connected' && userEmail && <p className="connector__meta">Conectado como {userEmail}</p>}
      {connector.note && <p className="connector__meta">{connector.note}</p>}

      {connector.status === 'needs_account' && connector.auth === 'google-login' && (
        <button type="button" className="btn btn-primary connector__action" onClick={onConnect}>
          Conectar con Google
        </button>
      )}

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

export default function ConnectorsPanel() {
  const { user, login } = useAuth();
  const { settings, setConnectorEnabled } = useSettings();
  const { status, connectors, error, reload } = useConnectors(user?.id || null);
  const off = new Set(settings.disabledConnectors || []);

  const live = connectors.filter(isLive);
  const pending = connectors.filter((c) => c.status === 'needs_account' || c.status === 'needs_setup');
  const planned = connectors.filter((c) => c.status === 'planned');
  const activeTools = live.filter((c) => !off.has(c.id)).reduce((n, c) => n + c.tools.length, 0);

  const card = (c) => (
    <ConnectorCard
      key={c.id}
      connector={c}
      enabled={!off.has(c.id)}
      onToggle={setConnectorEnabled}
      onConnect={login}
      userEmail={user?.email}
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
            Con Claude, Eddie responde sin herramientas. Elige Gemini o Groq en Configuración para usar tus conectores.
          </p>
        )}
      </div>

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
