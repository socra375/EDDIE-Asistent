import { createContext, useContext, useMemo } from 'react';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { useSettings } from './SettingsContext';

const VoiceContext = createContext(null);

const STT_LANG_MAP = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };

export function VoiceProvider({ children }) {
  const { settings } = useSettings();
  const sttLang = STT_LANG_MAP[settings.language] || 'es-ES';

  const recognition = useSpeechRecognition({ lang: sttLang });
  const synthesis = useSpeechSynthesis();

  const speakWithSettings = (text, onEnd) => {
    synthesis.speak(text, { lang: sttLang, onEnd });
  };

  // Named explicitly rather than spread — both hooks return a `supported`
  // key (and synthesis also returns `stop`), so a flat spread silently let
  // synthesis's values shadow recognition's: useVoice().stop ended up
  // cancelling speech instead of stopping the microphone.
  const value = useMemo(
    () => ({
      sttSupported: recognition.supported,
      listening: recognition.listening,
      transcript: recognition.transcript,
      interimTranscript: recognition.interimTranscript,
      sttError: recognition.error,
      start: recognition.start,
      stop: recognition.stop,
      reset: recognition.reset,
      ttsSupported: synthesis.supported,
      speaking: synthesis.speaking,
      speak: synthesis.speak,
      stopSpeaking: synthesis.stop,
      speakWithSettings,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recognition, synthesis, sttLang],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice debe usarse dentro de <VoiceProvider>');
  return ctx;
}
