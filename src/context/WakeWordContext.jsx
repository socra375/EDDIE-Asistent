import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSettings } from './SettingsContext';
import { useVoice } from './VoiceContext';
import { useChat } from './ChatContext';
import { useWakeWordListener, wakeWordSupported } from '../hooks/useWakeWordListener';
import { DEFAULT_WAKE_WORD } from '../services/wakeWord';
import { WakeWordContext } from './wakeWordState';

const STT_LANG_MAP = { es: 'es-ES', en: 'en-US', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT' };
// The aborted wake recognizer needs a moment to let go of the microphone.
const HANDOFF_MS = 250;

// Says "Eddie" -> Eddie wakes up, from any module. If a command follows in the
// same breath ("Eddie, ¿qué tengo hoy?") it is sent as it is; if only the word
// was said, the microphone opens for the command and what is heard is sent when
// the listen ends. The listener is paused while Eddie listens, works or speaks.
export function WakeWordProvider({ children }) {
  const { settings, updateVoiceSettings } = useSettings();
  const { listening, transcribing, transcript, interimTranscript, start, reset, speaking, sttSupported } = useVoice();
  const { status, sendMessage } = useChat();

  const enabled = Boolean(settings.wake?.enabled);
  const word = settings.wake?.word || DEFAULT_WAKE_WORD;
  const lang = STT_LANG_MAP[settings.language] || 'es-ES';
  const busy = listening || transcribing || speaking || status === 'processing' || status === 'responding';

  // A listen opened by the wake word sends itself when it ends.
  const wakeListenRef = useRef(false);
  const wasListeningRef = useRef(false);
  useEffect(() => {
    if (wasListeningRef.current && !listening && wakeListenRef.current) {
      wakeListenRef.current = false;
      const text = `${transcript} ${interimTranscript}`.trim();
      if (text) sendMessage(text);
      reset();
    }
    wasListeningRef.current = listening;
  }, [listening, transcript, interimTranscript, sendMessage, reset]);

  const autoRead = settings.voice.autoRead;
  const onWake = useCallback(
    (rest) => {
      // Like the ring: waking Eddie by voice means it answers by voice.
      if (!autoRead) updateVoiceSettings({ autoRead: true });
      if (rest) {
        sendMessage(rest);
        return;
      }
      if (!sttSupported) return;
      wakeListenRef.current = true;
      window.setTimeout(start, HANDOFF_MS);
    },
    [autoRead, updateVoiceSettings, sendMessage, sttSupported, start],
  );

  const listener = useWakeWordListener({ enabled, word, lang, paused: busy, onWake });
  const value = useMemo(
    () => ({ enabled, word, supported: wakeWordSupported, status: listener.status, heard: listener.heard, retry: listener.retry }),
    [enabled, word, listener.status, listener.heard, listener.retry],
  );

  return <WakeWordContext.Provider value={value}>{children}</WakeWordContext.Provider>;
}
