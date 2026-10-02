import { useState } from 'react';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useChat } from '../../context/ChatContext';
import { useVoice } from '../../context/VoiceContext';
import { formatSeconds, useVoiceTimings } from '../../services/voiceTiming';
import { useProviderHealth } from '../../hooks/useProviderHealth';
import Icon from '../../layout/Icon';
import { countItems } from '../../services/memory';
import './Settings.css';

// "-latest" son alias de Google que siempre apuntan al modelo Flash/Pro/
// Flash-Lite recomendado del momento, para no depender de un id con fecha
// que Google termine retirando.
const PROVIDER_MODELS = {
  gemini: [
    { value: '', label: 'gemini-flash-lite-latest (predeterminado, gratis, ~1500 prompts/día)' },
    { value: 'gemini-flash-latest', label: 'gemini-flash-latest (más capaz, límite más bajo por minuto)' },
    { value: 'gemini-pro-latest', label: 'gemini-pro-latest (requiere plan de pago)' },
  ],
  claude: [
    { value: '', label: 'claude-sonnet-5 (predeterminado)' },
    { value: 'claude-haiku-4-5-20251001', label: 'claude-haiku-4-5 (más rápido)' },
  ],
  groq: [
    { value: '', label: 'openai/gpt-oss-120b (predeterminado, gratis)' },
    { value: 'openai/gpt-oss-20b', label: 'openai/gpt-oss-20b (más rápido)' },
  ],
  openrouter: [
    { value: '', label: 'openrouter/free (predeterminado, gratis: elige un modelo gratuito)' },
    { value: 'openrouter/auto', label: 'openrouter/auto (elige el mejor modelo; gasta créditos)' },
  ],
};

// OpenRouter has hundreds of models, so besides the two above the user can
// type any model id from openrouter.ai/models.
const CUSTOM_MODEL = '__custom__';

const CLOUD_VOICE = '__elevenlabs__';

// Browser voices for the chosen language, by name, for the picker.
function voicesFor(voices, language) {
  const base = (language || 'es').toLowerCase();
  return voices
    .filter((v) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(base))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

export default function SettingsPanel({ onOpenConversation }) {
  const { settings, updateSettings, updateVoiceSettings, memory, forgetEverything } = useSettings();
  const { user, login, logout, deleteAccount } = useAuth();
  const { resetConversation, conversations, conversationId, loadConversation, deleteConversation, clearAllConversations } = useChat();
  const { ttsSupported, voices, sttEngine, whisperAvailable, ttsEngine, cloudVoiceAvailable, cloudVoices, cloudVoice, cloudVoiceError, speakWithSettings } =
    useVoice();
  const health = useProviderHealth();
  const timings = useVoiceTimings();
  const [deleting, setDeleting] = useState(false);
  const [customModel, setCustomModel] = useState(false);

  // A saved model that isn't in the list (typed before) also shows the field.
  const knownModels = PROVIDER_MODELS[settings.provider];
  const isCustomModel =
    settings.provider === 'openrouter' && (customModel || (Boolean(settings.model) && !knownModels.some((m) => m.value === settings.model)));
  const backups = [health?.groq && settings.provider !== 'groq' && 'Groq', health?.openrouter && settings.provider !== 'openrouter' && 'OpenRouter'].filter(Boolean);
  const onFreeOpenRouter = settings.provider === 'openrouter' && (!settings.model || settings.model.endsWith(':free') || settings.model === 'openrouter/free');

  function chooseVoice(value) {
    if (value === CLOUD_VOICE) updateVoiceSettings({ tts: 'elevenlabs', elevenVoice: '' });
    else if (value.startsWith(`${CLOUD_VOICE}:`)) updateVoiceSettings({ tts: 'elevenlabs', elevenVoice: value.slice(CLOUD_VOICE.length + 1) });
    else updateVoiceSettings({ tts: 'browser', voiceURI: value });
  }

  async function handleDeleteAccount() {
    if (!window.confirm('Esto elimina tu cuenta de Google en Eddie y todas tus tareas, ajustes y memoria guardados en el servidor. ¿Continuar?')) return;
    setDeleting(true);
    try {
      await deleteAccount();
    } finally {
      setDeleting(false);
    }
  }

  function handleOpenConversation(id) {
    loadConversation(id);
    onOpenConversation?.();
  }

  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  const dateFormatter = new Intl.DateTimeFormat(settings.language, { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section className="settings-panel">
      <div className="glass-panel settings-card">
        <h2>Cuenta de Google</h2>
        {user ? (
          <>
            <p className="settings-placeholder">
              Sesión iniciada como <strong>{user.name || user.email}</strong>. Tus tareas, ajustes y memoria se sincronizan
              entre dispositivos, y puedes agregar tareas a Google Calendar o guardar documentos en Drive.
            </p>
            <div className="settings-row settings-row--actions">
              <button type="button" className="btn" onClick={logout}>
                Cerrar sesión
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDeleteAccount} disabled={deleting}>
                {deleting ? 'Eliminando…' : 'Eliminar mi cuenta y datos'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="settings-placeholder">
              Inicia sesión con Google para sincronizar tus tareas entre dispositivos y usar Calendar/Drive. Sin iniciar
              sesión, Eddie sigue funcionando por completo, guardando todo solo en este navegador.
            </p>
            <button type="button" className="btn btn-primary" onClick={login} disabled={health && (!health.database || !health.google)}>
              Iniciar sesión con Google
            </button>
            {health && (!health.database || !health.google) && (
              <p className="settings-warning">
                El inicio de sesión con Google no está disponible: faltan variables de entorno en el servidor
                ({!health.database && 'DATABASE_URL'}
                {!health.database && !health.google && ', '}
                {!health.google && 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET'}). Ver README.
              </p>
            )}
          </>
        )}
      </div>

      <div className="glass-panel settings-card">
        <h2>Proveedor de IA</h2>
        <div className="settings-row">
          <label>
            <span className="field-label">Proveedor</span>
            <select
              className="select"
              value={settings.provider}
              onChange={(e) => {
                setCustomModel(false);
                updateSettings({ provider: e.target.value, model: '' });
              }}
            >
              <option value="gemini">Google Gemini Flash</option>
              <option value="claude">Anthropic Claude</option>
              <option value="groq">Groq (gratis y rápido)</option>
              <option value="openrouter">OpenRouter (cientos de modelos, con opción gratis)</option>
            </select>
          </label>
          <label>
            <span className="field-label">Modelo</span>
            <select
              className="select"
              value={isCustomModel ? CUSTOM_MODEL : settings.model}
              onChange={(e) => {
                const custom = e.target.value === CUSTOM_MODEL;
                setCustomModel(custom);
                updateSettings({ model: custom ? '' : e.target.value });
              }}
            >
              {knownModels.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              {settings.provider === 'openrouter' && <option value={CUSTOM_MODEL}>Otro modelo (escribir su id)…</option>}
            </select>
          </label>
        </div>
        {isCustomModel && (
          <label>
            <span className="field-label">Id del modelo de OpenRouter</span>
            <input
              className="input"
              value={settings.model}
              maxLength={99}
              placeholder="p. ej. anthropic/claude-sonnet-5 o meta-llama/llama-4-maverick:free"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => updateSettings({ model: e.target.value.trim() })}
            />
            <span className="settings-placeholder">Copia el id desde openrouter.ai/models (los gratuitos terminan en ":free"). Vacío = openrouter/free.</span>
          </label>
        )}
        {health && (
          <div className="settings-health">
            <span className={`health-dot ${health.gemini ? 'health-dot--ok' : 'health-dot--off'}`} /> Gemini {health.gemini ? 'configurado' : 'no configurado'}
            <span className={`health-dot ${health.claude ? 'health-dot--ok' : 'health-dot--off'}`} /> Claude {health.claude ? 'configurado' : 'no configurado'}
            <span className={`health-dot ${health.groq ? 'health-dot--ok' : 'health-dot--off'}`} /> Groq {health.groq ? 'configurado' : 'no configurado'}
            <span className={`health-dot ${health.openrouter ? 'health-dot--ok' : 'health-dot--off'}`} /> OpenRouter{' '}
            {health.openrouter ? 'configurado' : 'no configurado'}
          </div>
        )}
        {health && (
          <p className="settings-placeholder">
            {backups.length
              ? `Respaldo activo: si el proveedor elegido falla antes de responder (límite gratuito, saturación o error), responde ${backups.join(' y, si también falla, ')}.`
              : 'Sin respaldo: agrega GROQ_API_KEY u OPENROUTER_API_KEY en las variables de entorno de Vercel para que otro proveedor responda cuando el elegido falle.'}
          </p>
        )}
        {onFreeOpenRouter && (
          <p className="settings-placeholder">
            Los modelos gratuitos de OpenRouter permiten 20 solicitudes por minuto y 50 al día; con 10 USD de créditos (una sola vez) el límite diario sube a 1.000.
          </p>
        )}
        {health && !health[settings.provider] && (
          <p className="settings-warning">
            El proveedor seleccionado no tiene una clave configurada en el servidor. Añade la variable de entorno correspondiente (ver README) o elige otro proveedor.
          </p>
        )}
        {settings.provider === 'gemini' && settings.model === 'gemini-pro-latest' && (
          <p className="settings-warning">
            Con una clave de API gratuita de Google, este modelo (Pro) devuelve un error de cuota excedida (límite 0
            en el nivel gratuito) — Google solo habilita el modelo Pro en cuentas con facturación activa. Usa
            "gemini-flash-lite-latest" a menos que tengas facturación configurada en tu proyecto de Google Cloud.
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
        <h2>Voz</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.voice.autoRead}
            onChange={(e) => updateVoiceSettings({ autoRead: e.target.checked })}
            disabled={!ttsSupported}
          />
          <span>Eddie lee sus respuestas en voz alta</span>
        </label>
        {!ttsSupported && <p className="settings-warning">Este navegador no admite síntesis de voz.</p>}

        <div className="settings-row">
          <label>
            <span className="field-label">Reconocimiento de voz</span>
            <select
              className="select"
              value={settings.voice.stt === 'browser' ? 'browser' : 'whisper'}
              onChange={(e) => updateVoiceSettings({ stt: e.target.value })}
            >
              <option value="whisper">Whisper de Groq (más preciso)</option>
              <option value="browser">El del navegador</option>
            </select>
          </label>
          {ttsSupported && (
            <label>
              <span className="field-label">Voz de Eddie</span>
              <select
                className="select"
                value={ttsEngine === 'elevenlabs' ? (cloudVoices.some((v) => v.id === cloudVoice && !v.default) ? `${CLOUD_VOICE}:${cloudVoice}` : CLOUD_VOICE) : settings.voice.voiceURI || ''}
                onChange={(e) => chooseVoice(e.target.value)}
              >
                {cloudVoiceAvailable && cloudVoices.length <= 1 && <option value={CLOUD_VOICE}>Voz de Eddie · ElevenLabs</option>}
                {cloudVoiceAvailable &&
                  cloudVoices.length > 1 &&
                  cloudVoices.map((v) => (
                    <option key={v.id} value={v.default ? CLOUD_VOICE : `${CLOUD_VOICE}:${v.id}`}>
                      ElevenLabs · {v.name}
                      {v.default ? ' (por defecto)' : ''}
                    </option>
                  ))}
                <option value="">Navegador · automática (la más natural)</option>
                {voicesFor(voices, settings.language).map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    Navegador · {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="settings-placeholder">
          {sttEngine === 'whisper'
            ? 'Eddie graba lo que dices y lo transcribe con Whisper (whisper-large-v3-turbo) en Groq; deja de escuchar solo cuando haces una pausa.'
            : settings.voice.stt !== 'browser' && !whisperAvailable
              ? 'Whisper no está disponible: falta GROQ_API_KEY en Vercel o este navegador no puede grabar audio. Se usa el reconocimiento del navegador.'
              : 'Se usa el reconocimiento de voz del navegador.'}
        </p>
        {!cloudVoiceAvailable && (
          <p className="settings-placeholder">
            Para la voz propia de Eddie (ElevenLabs), agrega ELEVENLABS_API_KEY en las variables de entorno de Vercel y vuelve a desplegar.
          </p>
        )}
        {ttsEngine === 'elevenlabs' && cloudVoiceError && <p className="settings-warning">{cloudVoiceError}</p>}
        {ttsSupported && (
          <button type="button" className="btn settings-voice-test" onClick={() => speakWithSettings('Hola, soy Eddie. Así suena mi voz.')}>
            Probar voz
          </button>
        )}
        <p className="settings-placeholder" aria-live="polite">
          Última respuesta · transcribir: {formatSeconds(timings.transcribe)} · primeras palabras: {formatSeconds(timings.firstToken)} · primera voz: {formatSeconds(timings.firstVoice)} · total desde que
          dejaste de hablar: {formatSeconds(timings.total)}
        </p>
      </div>

      <div className="glass-panel settings-card">
        <h2>Historial de conversaciones</h2>
        {sortedConversations.length === 0 ? (
          <p className="settings-placeholder">No hay conversaciones guardadas todavía.</p>
        ) : (
          <ul className="memory-list">
            {sortedConversations.map((c) => (
              <li key={c.id} className="history-item">
                <span className="history-item__info">
                  <strong>{c.title}</strong>
                  <span className="history-item__meta">
                    {dateFormatter.format(new Date(c.updatedAt))} · {c.messages.length} mensaje{c.messages.length === 1 ? '' : 's'}
                    {c.id === conversationId && ' · actual'}
                  </span>
                </span>
                <span className="history-item__actions">
                  <button type="button" className="btn" onClick={() => handleOpenConversation(c.id)} disabled={c.id === conversationId}>
                    Abrir
                  </button>
                  <button type="button" className="btn tasks-delete" onClick={() => deleteConversation(c.id)} aria-label="Eliminar conversación">
                    <Icon name="close" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="settings-row settings-row--actions">
          <button type="button" className="btn" onClick={resetConversation}>
            Nueva conversación
          </button>
          <button type="button" className="btn btn-danger" onClick={clearAllConversations} disabled={conversations.length === 0}>
            Borrar todo el historial
          </button>
        </div>
      </div>

      <div className="glass-panel settings-card">
        <h2>Memoria</h2>
        <label className="settings-toggle">
          <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })} />
          <span>Permitir que Eddie recuerde preferencias entre sesiones</span>
        </label>

        <p className="settings-placeholder">
          {countItems(memory) === 0
            ? 'No hay información guardada todavía.'
            : `Eddie recuerda ${countItems(memory)} ${countItems(memory) === 1 ? 'cosa' : 'cosas'} de ti.`}{' '}
          Revísalas, añade o borra en el módulo Memoria.
        </p>

        <div className="settings-row settings-row--actions">
          <button type="button" className="btn btn-danger" onClick={forgetEverything} disabled={countItems(memory) === 0}>
            Borrar toda la memoria
          </button>
        </div>
      </div>
    </section>
  );
}
