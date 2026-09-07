import { useState } from 'react';
import { useVoice } from '../../context/VoiceContext';
import { useSettings } from '../../context/SettingsContext';
import EddieCore from '../Core/EddieCore';
import './Voice.css';

const LANGUAGES = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
];

export default function VoicePanel() {
  const { supported: sttSupported, listening, transcript, interimTranscript, start, stop, error: sttError, reset } = useVoice();
  const { supported: ttsSupported, voices, speaking, speak, stop: stopSpeaking } = useVoice();
  const { settings, updateSettings, updateVoiceSettings } = useSettings();
  const [sampleText, setSampleText] = useState('Hola. Soy Eddie, tu asistente de estudio. ¿En qué puedo ayudarte hoy?');

  const coreState = listening ? 'listening' : speaking ? 'responding' : 'idle';

  return (
    <section className="voice-panel">
      <div className="voice-panel__core">
        <EddieCore state={coreState} />
      </div>

      <div className="voice-grid">
        <div className="glass-panel voice-card">
          <h2>Reconocimiento de voz (STT)</h2>
          {!sttSupported && <p className="voice-warning">Este navegador no admite reconocimiento de voz. Prueba con Chrome o Edge.</p>}
          <div className="voice-card__row">
            <button type="button" className={`btn ${listening ? 'btn-danger' : 'btn-primary'}`} onClick={listening ? stop : start} disabled={!sttSupported}>
              {listening ? '⏹ Detener' : '🎙️ Escuchar'}
            </button>
            <button type="button" className="btn" onClick={reset} disabled={!transcript && !interimTranscript}>
              Limpiar
            </button>
          </div>
          <p className="voice-card__transcript">
            {transcript || interimTranscript ? (
              <>
                {transcript}
                <span className="voice-card__interim">{interimTranscript}</span>
              </>
            ) : (
              <span className="voice-card__placeholder">La transcripción aparecerá aquí en tiempo real…</span>
            )}
          </p>
          {sttError && <p className="voice-warning">{sttError}</p>}
        </div>

        <div className="glass-panel voice-card">
          <h2>Síntesis de voz (TTS)</h2>
          {!ttsSupported && <p className="voice-warning">Este navegador no admite síntesis de voz.</p>}
          <textarea className="textarea" rows={3} value={sampleText} onChange={(e) => setSampleText(e.target.value)} />
          <div className="voice-card__row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ttsSupported}
              onClick={() => speak(sampleText, { ...settings.voice, lang: settings.language })}
            >
              🔊 Probar voz
            </button>
            <button type="button" className="btn" onClick={stopSpeaking} disabled={!speaking}>
              ⏹ Detener
            </button>
          </div>
        </div>

        <div className="glass-panel voice-card voice-card--wide">
          <h2>Controles de voz</h2>
          <div className="voice-controls-grid">
            <label>
              <span className="field-label">Voz</span>
              <select
                className="select"
                value={settings.voice.voiceURI}
                onChange={(e) => updateVoiceSettings({ voiceURI: e.target.value })}
              >
                <option value="">Automática (según idioma)</option>
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </label>

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
              <span className="field-label">Velocidad ({settings.voice.rate.toFixed(1)}x)</span>
              <input
                type="range"
                min="0.5"
                max="1.8"
                step="0.1"
                value={settings.voice.rate}
                onChange={(e) => updateVoiceSettings({ rate: Number(e.target.value) })}
              />
            </label>

            <label>
              <span className="field-label">Tono ({settings.voice.pitch.toFixed(1)})</span>
              <input
                type="range"
                min="0.4"
                max="1.6"
                step="0.1"
                value={settings.voice.pitch}
                onChange={(e) => updateVoiceSettings({ pitch: Number(e.target.value) })}
              />
            </label>

            <label>
              <span className="field-label">Volumen ({Math.round(settings.voice.volume * 100)}%)</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.voice.volume}
                onChange={(e) => updateVoiceSettings({ volume: Number(e.target.value) })}
              />
            </label>

            <label className="voice-toggle">
              <input
                type="checkbox"
                checked={settings.voice.autoRead}
                onChange={(e) => updateVoiceSettings({ autoRead: e.target.checked })}
              />
              <span>Leer respuestas de Eddie en voz alta automáticamente</span>
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
