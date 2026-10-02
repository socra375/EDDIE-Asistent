import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import { useLocation } from '../context/LocationContext';
import { useVision } from '../context/visionState';
import { useProbeConfig } from '../services/probe';
import { usePlaceAndWeather } from '../home/usePlaceAndWeather';
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
  const { status: gpsStatus, location } = useLocation();
  const { place, weather } = usePlaceAndWeather(location);
  const online = useOnline();
  const probe = useProbeConfig();
  const vision = useVision();
  const voiceOn = settings.voice.autoRead;
  const [gpsLabel, gpsClass] = GPS_CHIP[gpsStatus] || GPS_CHIP.idle;

  function toggleVoice() {
    if (voiceOn) stopSpeaking();
    updateVoiceSettings({ autoRead: !voiceOn });
  }

  return (
    <header className="header">
      <div className="header__left">
        <h1 className="header__title">
          <EddieWordmark height={44} title="Eddie" />
        </h1>
        <span className={`chip ${online ? 'on' : 'bad'}`}>{online ? 'EN LÍNEA' : 'SIN RED'}</span>
        <span className={`chip header__gps ${gpsClass}`}>{gpsLabel}</span>
        {probe.forced && <span className="chip warn" title="Lo que escribes en el chat va a la Sonda local, no a Eddie. Apágalo en el chat.">SONDA · ON</span>}
        {vision.busy && (
          <button type="button" className="chip chip--button bad header__vigilance" onClick={vision.toggle} title="La cámara está en Modo Vigilancia. Pulsa para apagarla.">
            ● VIGILANCIA · ON
          </button>
        )}
        <span className="header__section">{section}</span>
      </div>

      <div className="header__clockpill">
        <LiveClock />
      </div>

      <div className="chips chips--right">
        {weather && (
          <span className="chip on header__weather" title={place || undefined}>
            {weather.temperature}°C{place ? ` · ${place}` : ''}
          </span>
        )}
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
