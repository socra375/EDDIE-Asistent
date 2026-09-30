import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import { useLocation } from '../context/LocationContext';
import LiveClock from './LiveClock';
import { EddieWordmark } from './EddieLogo';

const GPS_CHIP = {
  granted: ['GPS · ACTIVO', 'on'],
  requesting: ['GPS · BUSCANDO', 'warn'],
  denied: ['GPS · DENEGADO', 'bad'],
  unsupported: ['GPS · N/D', 'bad'],
  idle: ['GPS · —', ''],
};

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export default function Header({ section }) {
  const { user, loading, login, logout } = useAuth();
  const { settings, updateSettings, updateVoiceSettings } = useSettings();
  const { ttsSupported, stopSpeaking } = useVoice();
  const { status: gpsStatus } = useLocation();
  const online = useOnline();
  const voiceOn = settings.voice.autoRead;
  const [gpsLabel, gpsClass] = GPS_CHIP[gpsStatus] || GPS_CHIP.idle;

  function toggleVoice() {
    if (voiceOn) stopSpeaking();
    updateVoiceSettings({ autoRead: !voiceOn });
  }

  return (
    <header className="header">
      <div className="chips">
        <span className="chip on header__clock-chip">
          <LiveClock />
        </span>
        <span className={`chip ${online ? 'on' : 'bad'}`}>RED · {online ? 'EN LÍNEA' : 'SIN RED'}</span>
        <span className={`chip ${gpsClass}`}>{gpsLabel}</span>
      </div>

      <div className="header__brand">
        <h1 className="header__title">
          <EddieWordmark height={64} title="Eddie" />
        </h1>
        <p className="header__section">{section}</p>
      </div>

      <div className="chips chips--right">
        {!loading &&
          (user ? (
            <button type="button" className="chip chip--button on" onClick={logout} title="Cerrar sesión">
              {user.name?.split(' ')[0] || 'Cuenta'} · SALIR
            </button>
          ) : (
            <button type="button" className="chip chip--button" onClick={login}>
              Iniciar sesión
            </button>
          ))}
        <button
          type="button"
          className={`chip chip--button ${voiceOn ? 'on' : ''}`}
          role="switch"
          aria-checked={voiceOn}
          onClick={toggleVoice}
          disabled={!ttsSupported}
          title={ttsSupported ? 'Eddie habla sus respuestas en voz alta' : 'Este navegador no admite síntesis de voz'}
        >
          VOZ · {voiceOn ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className="chip chip--button"
          onClick={() => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title="Cambiar tema"
        >
          {settings.theme === 'dark' ? 'Modo claro' : 'Modo HUD'}
        </button>
      </div>
    </header>
  );
}
