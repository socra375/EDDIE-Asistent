import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import EddieLogo from './EddieLogo';
import LiveClock from './LiveClock';

const STATUS_LABEL = {
  idle: 'En línea',
  processing: 'Analizando…',
  responding: 'Respondiendo',
  error: 'Error',
};

export default function Header({ section, status = 'idle' }) {
  const { user, loading, login, logout } = useAuth();
  const { settings, updateSettings, updateVoiceSettings } = useSettings();
  const { ttsSupported, stopSpeaking } = useVoice();
  const voiceOn = settings.voice.autoRead;

  function toggleVoice() {
    if (voiceOn) stopSpeaking();
    updateVoiceSettings({ autoRead: !voiceOn });
  }

  return (
    <header className="header">
      <div className="header__brand">
        <EddieLogo size={30} />
        <div>
          <p className="header__name">EDDIE</p>
          <p className="header__section">{section}</p>
        </div>
      </div>

      <div className="header__right">
        <LiveClock />
        <span className={`status-pill status-pill--${status}`}>
          <span className="status-pill__dot" />
          {STATUS_LABEL[status] || status}
        </span>
        {!loading &&
          (user ? (
            <button type="button" className="btn header__account" onClick={logout} title="Cerrar sesión">
              {user.avatarUrl ? (
                <img className="header__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span aria-hidden="true">👤</span>
              )}
              <span className="header__account-name">{user.name?.split(' ')[0] || 'Cuenta'}</span>
            </button>
          ) : (
            <button type="button" className="btn header__account" onClick={login}>
              Iniciar sesión
            </button>
          ))}
        <button
          type="button"
          className={`voice-switch ${voiceOn ? 'voice-switch--on' : ''}`}
          role="switch"
          aria-checked={voiceOn}
          onClick={toggleVoice}
          disabled={!ttsSupported}
          title={ttsSupported ? 'Eddie lee sus respuestas en voz alta' : 'Este navegador no admite síntesis de voz'}
        >
          <span className="voice-switch__label">{voiceOn ? 'VOZ ON' : 'VOZ OFF'}</span>
          <span className="voice-switch__knob" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn header__theme"
          onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title="Cambiar tema"
        >
          {settings.theme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  );
}
