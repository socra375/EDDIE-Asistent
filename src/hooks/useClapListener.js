import { useEffect, useRef, useState } from 'react';
import { SPECTRUM_FROM, createClapDetector, highBandShare } from '../services/clap';

export const clapSupported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== 'undefined' && Boolean(window.AudioContext || window.webkitAudioContext);

const FRAME_MS = 20;

// A short, soft two-note chime so the user knows Eddie heard them.
export function playWakeChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
    window.setTimeout(() => ctx.close().catch(() => {}), 900);
  } catch {
    // No chime: waking up still works.
  }
}

// Listens to the microphone for two claps and calls onDouble(). The microphone
// is released while `paused` (Eddie listening, thinking or speaking: his own
// voice must not wake him and two users of the mic get in each other's way).
//
// status: off | unsupported | starting | listening | paused | denied | error
export function useClapListener({ enabled, paused, sensitivity, onDouble }) {
  const [state, setState] = useState({ status: 'off', attempt: 0 });
  const [retryKey, setRetryKey] = useState(0);
  const onDoubleRef = useRef(onDouble);
  const sensitivityRef = useRef(sensitivity);
  // What the card's level meter reads (a ref: updating it never re-renders the app).
  const meterRef = useRef({ listening: false, level: 0, floor: 0, threshold: 0, claps: 0, doubles: 0, reason: '', silentMs: 0, sampleRate: 0 });
  useEffect(() => {
    onDoubleRef.current = onDouble;
    sensitivityRef.current = sensitivity;
  });

  const active = enabled && clapSupported && !paused;

  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let stream = null;
    let ctx = null;
    let timer = null;
    const cleanup = () => {
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      ctx?.close().catch(() => {});
    };
    const fail = (status) => {
      if (!stopped) setState((s) => ({ ...s, status }));
    };

    (async () => {
      try {
        // Echo cancellation and noise suppression would smooth a clap away.
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        } catch (err) {
          // A device that cannot turn those off still hears claps, just less well.
          if (err?.name !== 'OverconstrainedError' && err?.name !== 'ConstraintNotSatisfiedError') throw err;
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        if (stopped) return cleanup();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        ctx = new Ctx();
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const spectrum = new Float32Array(analyser.frequencyBinCount);
        const detector = createClapDetector({ sensitivity: sensitivityRef.current });
        const origin = performance.now();
        let lastSound = origin;
        timer = window.setInterval(() => {
          detector.setSensitivity(sensitivityRef.current);
          analyser.getFloatTimeDomainData(samples);
          let peak = 0;
          for (let i = 0; i < samples.length; i += 1) {
            const v = Math.abs(samples[i]);
            if (v > peak) peak = v;
          }
          let high = 0;
          if (peak >= SPECTRUM_FROM) {
            analyser.getFloatFrequencyData(spectrum);
            high = highBandShare(spectrum, ctx.sampleRate);
          }
          const now = performance.now();
          if (peak > 0.0005) lastSound = now;
          const result = detector.push({ t: now - origin, peak, highShare: high });
          meterRef.current = { ...detector.snapshot(), listening: true, silentMs: now - lastSound, sampleRate: ctx.sampleRate };
          if (result === 'double') {
            detector.reset();
            onDoubleRef.current?.();
          }
        }, FRAME_MS);
        stream.getAudioTracks()[0]?.addEventListener('ended', () => fail('error'));
        setState((s) => ({ ...s, status: ctx.state === 'running' ? 'listening' : 'starting' }));
        // A browser may keep the audio engine asleep until the page is touched.
        if (ctx.state !== 'running') {
          const wake = () => {
            ctx?.resume().then(() => !stopped && setState((s) => ({ ...s, status: 'listening' }))).catch(() => {});
            window.removeEventListener('pointerdown', wake);
            window.removeEventListener('keydown', wake);
          };
          window.addEventListener('pointerdown', wake, { once: true });
          window.addEventListener('keydown', wake, { once: true });
        }
      } catch (err) {
        cleanup();
        fail(err?.name === 'NotAllowedError' || err?.name === 'SecurityError' ? 'denied' : 'error');
      }
    })();

    return () => {
      stopped = true;
      cleanup();
      meterRef.current = { ...meterRef.current, listening: false };
    };
  }, [active, retryKey]);

  let status = 'off';
  if (enabled) status = !clapSupported ? 'unsupported' : paused ? 'paused' : state.status === 'off' ? 'starting' : state.status;
  return {
    status,
    getMeter: () => meterRef.current,
    retry: () => {
      setState({ status: 'starting', attempt: 0 });
      setRetryKey((k) => k + 1);
    },
  };
}
