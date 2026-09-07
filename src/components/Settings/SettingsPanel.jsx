import { useSettings } from '../../context/SettingsContext';
import { useChat } from '../../context/ChatContext';
import { useProviderHealth } from '../../hooks/useProviderHealth';
import './Settings.css';

const PROVIDER_MODELS = {
  gemini: [
    { value: '', label: 'gemini-1.5-flash (predeterminado)' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
  ],
  claude: [
    { value: '', label: 'claude-3-5-sonnet-20241022 (predeterminado)' },
    { value: 'claude-3-5-haiku-20241022', label: 'claude-3-5-haiku-20241022' },
  ],
};

const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

export default function SettingsPanel() {
  const { settings, updateSettings, memory, forgetFact, forgetEverything } = useSettings();
  const { resetConversation } = useChat();
  const health = useProviderHealth();

  return (
    <section className="settings-panel">
      <div className="glass-panel settings-card">
        <h2>Proveedor de IA</h2>
        <div className="settings-row">
          <label>
            <span className="field-label">Proveedor</span>
            <select
              className="select"
              value={settings.provider}
              onChange={(e) => updateSettings({ provider: e.target.value, model: '' })}
            >
              <option value="gemini">Google Gemini Flash</option>
              <option value="claude">Anthropic Claude</option>
            </select>
          </label>
          <label>
            <span className="field-label">Modelo</span>
            <select className="select" value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })}>
              {PROVIDER_MODELS[settings.provider].map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {health && (
          <div className="settings-health">
            <span className={`health-dot ${health.gemini ? 'health-dot--ok' : 'health-dot--off'}`} /> Gemini {health.gemini ? 'configurado' : 'no configurado'}
            <span className={`health-dot ${health.claude ? 'health-dot--ok' : 'health-dot--off'}`} /> Claude {health.claude ? 'configurado' : 'no configurado'}
          </div>
        )}
        {health && !health[settings.provider] && (
          <p className="settings-warning">
            El proveedor seleccionado no tiene una clave configurada en el servidor. Añade la variable de entorno correspondiente (ver README) o elige otro proveedor.
          </p>
        )}
      </div>

      <div className="glass-panel settings-card">
        <h2>Idioma y apariencia</h2>
        <div className="settings-row">
          <label>
            <span className="field-label">Idioma</span>
            <select className="select" value={settings.language} onChange={(e) => updateSettings({ language: e.target.value })}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">Tema</span>
            <select className="select" value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value })}>
              <option value="dark">Oscuro</option>
              <option value="light">Claro</option>
            </select>
          </label>
        </div>
      </div>

      <div className="glass-panel settings-card">
        <h2>Memoria</h2>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })} />
          <span>Permitir que Eddie recuerde preferencias entre sesiones</span>
        </label>

        {Object.keys(memory).length === 0 ? (
          <p className="settings-placeholder">No hay información guardada todavía.</p>
        ) : (
          <ul className="memory-list">
            {Object.entries(memory).map(([key, value]) => (
              <li key={key}>
                <span>
                  <strong>{key}:</strong> {String(value)}
                </span>
                <button type="button" className="btn tasks-delete" onClick={() => forgetFact(key)}>
                  Eliminar
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="settings-row settings-row--actions">
          <button type="button" className="btn btn-danger" onClick={forgetEverything} disabled={Object.keys(memory).length === 0}>
            Borrar toda la memoria
          </button>
          <button type="button" className="btn btn-danger" onClick={resetConversation}>
            Borrar historial de conversación
          </button>
        </div>
      </div>
    </section>
  );
}
