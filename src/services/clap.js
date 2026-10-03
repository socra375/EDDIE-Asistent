// Double-clap detection ("Eddie, wake up" like Tony Stark). Pure logic, fed
// with one reading of the microphone every ~20 ms: the peak level (0–1) and
// how much of the sound sits in the high band (a clap is a short, sudden
// burst with plenty of energy above 2 kHz; a voice is mostly low and lasts).

export const SENSITIVITY = {
  low: { minPeak: 0.3, label: 'Baja (solo aplausos fuertes)' },
  medium: { minPeak: 0.18, label: 'Media' },
  high: { minPeak: 0.1, label: 'Alta (aplausos suaves)' },
};
export const DEFAULT_SENSITIVITY = 'medium';
export const cleanSensitivity = (value) => (Object.hasOwn(SENSITIVITY, value) ? value : DEFAULT_SENSITIVITY);

const ONSET_RATIO = 4; // a clap is at least this many times louder than the room
const SUDDEN_RATIO = 3; // ...and than the last ~60 ms (a voice ramps up)
const MIN_HIGH_SHARE = 0.3; // share of the energy above HIGH_HZ
export const HIGH_HZ = 2000;
const MAX_CLAP_MS = 220; // louder for longer than this is speech or music, not a clap
const RELEASE = 0.5; // the clap is over when the level falls under this share of its threshold
const MIN_GAP_MS = 130; // closer than this is the same clap (its echo)
const MAX_GAP_MS = 900; // the second clap must come within this time
const COOLDOWN_MS = 2500; // after waking Eddie, ignore claps for a while
const NOISE_ALPHA = 0.02;
const MIN_FLOOR = 0.008;

// Share of the spectrum energy above `hz`, from getFloatFrequencyData() (dB per bin).
export function highBandShare(freqDb, sampleRate, hz = HIGH_HZ) {
  const bins = freqDb.length;
  const binHz = sampleRate / 2 / bins;
  let high = 0;
  let total = 0;
  for (let i = 1; i < bins; i += 1) {
    const db = freqDb[i];
    if (!Number.isFinite(db)) continue;
    const power = 10 ** (db / 10);
    total += power;
    if (i * binHz >= hz) high += power;
  }
  return total > 0 ? high / total : 0;
}

export function createClapDetector({ sensitivity = DEFAULT_SENSITIVITY } = {}) {
  let minPeak = SENSITIVITY[cleanSensitivity(sensitivity)].minPeak;
  let floor = MIN_FLOOR;
  let recent = [0, 0, 0]; // levels of the last frames
  let active = null; // { start, threshold } while a clap burst is going
  let firstClapAt = 0;
  let refractoryUntil = 0;
  let cooldownUntil = 0;

  return {
    setSensitivity(value) {
      minPeak = SENSITIVITY[cleanSensitivity(value)].minPeak;
    },
    reset() {
      active = null;
      firstClapAt = 0;
      recent = [0, 0, 0];
    },
    // One reading. Returns 'clap' on a single clap and 'double' when the second one completes the pair.
    push({ t, peak, highShare }) {
      const before = Math.max(...recent);
      recent = [...recent.slice(1), peak];
      let result = null;

      if (active) {
        if (peak < active.threshold * RELEASE) {
          active = null;
        } else if (t - active.start > MAX_CLAP_MS) {
          // Sustained: speech, music, a fan. Not a clap, and not a first one either.
          active = null;
          firstClapAt = 0;
          refractoryUntil = t + 400;
        }
        return null;
      }

      const threshold = Math.max(minPeak, floor * ONSET_RATIO);
      const onset = peak >= threshold && peak >= before * SUDDEN_RATIO && highShare >= MIN_HIGH_SHARE && t >= refractoryUntil && t >= cooldownUntil;
      if (onset) {
        active = { start: t, threshold };
        refractoryUntil = t + MIN_GAP_MS;
        if (firstClapAt && t - firstClapAt <= MAX_GAP_MS) {
          firstClapAt = 0;
          cooldownUntil = t + COOLDOWN_MS;
          result = 'double';
        } else {
          firstClapAt = t;
          result = 'clap';
        }
        return result;
      }

      if (firstClapAt && t - firstClapAt > MAX_GAP_MS) firstClapAt = 0;
      // The room's noise level only learns from quiet frames.
      if (peak < threshold * RELEASE) floor = Math.max(MIN_FLOOR, floor + (peak - floor) * NOISE_ALPHA);
      return null;
    },
  };
}
