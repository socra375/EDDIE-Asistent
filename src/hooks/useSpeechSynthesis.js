import { useCallback, useEffect, useMemo, useState } from 'react';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;

// Wraps Web Speech API TTS. Voice quality/availability varies wildly across
// browsers, so we expose the actual installed voice list instead of assuming
// a specific "deep" voice exists, and let Settings pick the closest match.
export function useSpeechSynthesis() {
  const supported = Boolean(synth);
  const [voices, setVoices] = useState([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!supported) return undefined;

    function loadVoices() {
      setVoices(synth.getVoices());
    }
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => synth.removeEventListener('voiceschanged', loadVoices);
  }, [supported]);

  const pickVoice = useCallback(
    (voiceURI, lang) => {
      if (voiceURI) {
        const exact = voices.find((v) => v.voiceURI === voiceURI);
        if (exact) return exact;
      }
      const byLang = voices.find((v) => v.lang?.toLowerCase().startsWith(lang?.toLowerCase().slice(0, 2)));
      return byLang || voices[0] || null;
    },
    [voices],
  );

  const speak = useCallback(
    (text, { voiceURI, rate = 1, pitch = 0.9, volume = 1, lang = 'es-ES', onEnd } = {}) => {
      if (!supported || !text) return;
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice(voiceURI, lang);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      utterance.volume = volume;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => {
        setSpeaking(false);
        onEnd?.();
      };
      utterance.onerror = () => setSpeaking(false);
      synth.speak(utterance);
    },
    [supported, pickVoice],
  );

  const stop = useCallback(() => {
    if (!supported) return;
    synth.cancel();
    setSpeaking(false);
  }, [supported]);

  return useMemo(() => ({ supported, voices, speaking, speak, stop }), [supported, voices, speaking, speak, stop]);
}
