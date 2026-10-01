import { createContext, useContext, useMemo } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useWhisperRecognition, whisperSupported } from '../hooks/useWhisperRecognition';
import { useProviderHealth } from '../hooks/useProviderHealth';
import { useSettings } from './SettingsContext';

const VoiceContext = createContext(null);

const STT_LANG_MAP = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };

export function VoiceProvider({ children }) {
  const { settings } = useSettings();
  const health = useProviderHealth();
  const language = settings.language || 'es';
  const sttLang = STT_LANG_MAP[language] || 'es-ES';

  const browser = useSpeechRecognition({ lang: sttLang });
  const whisper = useWhisperRecognition({ language });
  const synthesis = useSpeechSynthesis();

  // Whisper (Groq) is the default whenever the server has GROQ_API_KEY and
  // the browser can record; the browser's own recognizer is the fallback,
  // or the user's choice in Configuración.
  const whisperAvailable = whisperSupported && Boolean(health?.groq);
  const sttEngine = settings.voice.stt !== 'browser' && whisperAvailable ? 'whisper' : 'browser';
  const whisperActive = sttEngine === 'whisper';

  // Eddie's ElevenLabs voice is the default whenever the server has
  // ELEVENLABS_API_KEY; the browser's voices are the fallback or the
  // user's choice.
  const cloudVoiceAvailable = Boolean(health?.elevenlabs);
  const ttsEngine = settings.voice.tts !== 'browser' && cloudVoiceAvailable ? 'elevenlabs' : 'browser';

  const speakWithSettings = (text, onEnd) => {
    synthesis.speak(text, { lang: sttLang, voiceURI: settings.voice.voiceURI || undefined, engine: ttsEngine, onEnd });
  };

  // Named explicitly rather than spread — the hooks share key names
  // (`supported`, `stop`), and a flat spread once let synthesis's `stop`
  // shadow recognition's. `listening` stays true until the final transcript
  // is in (with Whisper that includes the upload), so consumers can act on
  // its falling edge; `recording`/`transcribing` tell the two phases apart.
  const value = useMemo(
    () => ({
      sttEngine,
      whisperAvailable,
      sttSupported: whisperActive ? whisper.supported : browser.supported,
      listening: whisperActive ? whisper.recording || whisper.transcribing : browser.listening,
      recording: whisperActive ? whisper.recording : browser.listening,
      transcribing: whisperActive ? whisper.transcribing : false,
      transcript: whisperActive ? whisper.transcript : browser.transcript,
      interimTranscript: whisperActive ? '' : browser.interimTranscript,
      // Has the user started talking in this listen? (Whisper has no live text, so it says so itself.)
      speechDetected: whisperActive ? whisper.heard : Boolean(browser.transcript || browser.interimTranscript),
      sttError: whisperActive ? whisper.error : browser.error,
      start: whisperActive ? whisper.start : browser.start,
      stop: whisperActive ? whisper.stop : browser.stop,
      reset: whisperActive ? whisper.reset : browser.reset,
      ttsSupported: synthesis.supported || ttsEngine === 'elevenlabs',
      ttsEngine,
      cloudVoiceAvailable,
      cloudVoiceError: synthesis.cloudError,
      voices: synthesis.voices,
      speaking: synthesis.speaking,
      speak: synthesis.speak,
      stopSpeaking: synthesis.stop,
      speakWithSettings,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [browser, whisper, synthesis, sttLang, sttEngine, whisperAvailable, settings.voice.voiceURI, ttsEngine, cloudVoiceAvailable],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice debe usarse dentro de <VoiceProvider>');
  return ctx;
}
