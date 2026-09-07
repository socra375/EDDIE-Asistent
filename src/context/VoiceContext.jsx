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
    synthesis.speak(text, { ...settings.voice, lang: sttLang, onEnd });
  };

  const value = useMemo(
    () => ({
      ...recognition,
      ...synthesis,
      speakWithSettings,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recognition, synthesis, settings.voice, sttLang],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice debe usarse dentro de <VoiceProvider>');
  return ctx;
}
