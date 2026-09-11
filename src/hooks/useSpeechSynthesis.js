import { useCallback, useMemo, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Wraps Web Speech API TTS. No voice/rate/pitch/volume picker — always the
// browser's own default voice for the given language, at its default
// rate/pitch/volume, so there's nothing to configure beyond on/off.
export function useSpeechSynthesis() {
  const supported = Boolean(synth);
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback(
    (text, { lang = 'es-ES', onEnd } = {}) => {
      if (!supported || !text) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        onEnd?.();
      };
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
    },
    [supported],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    synth.cancel();
    setSpeaking(false);
  }, [supported]);

  return useMemo(() => ({ supported, speaking, speak, stop }), [supported, speaking, speak, stop]);
}
