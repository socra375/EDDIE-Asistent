// Double-clap detection ("Eddie, wake up" like Tony Stark). Pure logic, fed
// with one reading of the microphone every ~20 ms: the peak level (0–1) and
// how much of the sound sits in the high band (a clap is a short, sudden
// burst with plenty of energy above 2 kHz; a voice is mostly low and lasts).

// minPeak: the quietest clap that counts (the room's own noise raises it: a clap must also be 4× the noise).
// Laptop and Chromebook microphones are quiet, so these are low.
export const SENSITIVITY = {
  low: { minPeak: 0.14, label: 'Baja (solo aplausos fuertes)' },
  medium: { minPeak: 0.07, label: 'Media' },
  high: { minPeak: 0.035, label: 'Alta (aplausos suaves o lejanos)' },
};
// Below this level a frame is not worth looking at in the spectrum (the hook uses the same number).
export const SPECTRUM_FROM = 0.02;
export const DEFAULT_SENSITIVITY = 'medium';
export const cleanSensitivity = (value) => (Object.hasOwn(SENSITIVITY, value) ? value : DEFAULT_SENSITIVITY);

const ONSET_RATIO = 4; // a clap is at least this many times louder than the room
const SUDDEN_RATIO = 3; // ...and than the last ~60 ms (a voice ramps up)
const MIN_HIGH_SHARE = 0.2; // share of the energy above HIGH_HZ (small laptop microphones roll the treble off)
export const HIGH_HZ = 2000;
const MAX_CLAP_MS = 700; // louder for longer than this is speech or music, not a clap (a room's echo tail can last 300 ms)
const RELEASE = 0.4; // the clap is over when the level falls under this share of its threshold
const MIN_GAP_MS = 130; // closer than this is the same clap (its echo)
const MAX_GAP_MS = 900; // the second clap must come within this time
const COOLDOWN_MS = 2500; // after waking Eddie, ignore claps for a while
const WARMUP_MS = 300; // listening to the room before anything can count
const NOISE_UP = 0.01; // the noise estimate rises slowly (a clap must not raise it)...
const NOISE_DOWN = 0.05; // ...and falls faster
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
  let started = null;
  // What the screen shows to help tune it: the level, what was heard and why a loud sound did not count.
  const stats = { level: 0, floor: MIN_FLOOR, threshold: minPeak, claps: 0, doubles: 0, reason: '', reasonAt: 0 };

  return {
    setSensitivity(value) {
      minPeak = SENSITIVITY[cleanSensitivity(value)].minPeak;
    },
    reset() {
      active = null;
      firstClapAt = 0;
      recent = [0, 0, 0];
    },
    snapshot: () => ({ ...stats }),
    // One reading. Returns 'clap' on a single clap and 'double' when the second one completes the pair.
    push({ t, peak, highShare }) {
      if (started == null) started = t;
      const warming = t - started < WARMUP_MS;
      const before = Math.max(...recent);
      recent = [...recent.slice(1), peak];
      if (warming) floor = Math.max(MIN_FLOOR, floor + (peak - floor) * 0.3);
      const threshold = Math.max(minPeak, floor * ONSET_RATIO);
      stats.level = peak;
      stats.floor = floor;
      stats.threshold = threshold;

      const loud = peak >= threshold;
      const sudden = peak >= before * SUDDEN_RATIO;
      const sharp = highShare >= MIN_HIGH_SHARE;
      if (!warming && loud && sudden && sharp && t >= refractoryUntil && t >= cooldownUntil) {
        active = { start: t, threshold };
        refractoryUntil = t + MIN_GAP_MS;
        if (firstClapAt && t - firstClapAt <= MAX_GAP_MS) {
          firstClapAt = 0;
          cooldownUntil = t + COOLDOWN_MS;
          stats.doubles += 1;
          stats.reason = '';
          return 'double';
        }
        firstClapAt = t;
        stats.claps += 1;
        stats.reason = '';
        return 'clap';
      }

      if (active) {
        // A burst still ringing (a clap's echo tail). A new sudden clap on top of it was handled above.
        if (peak < active.threshold * RELEASE) {
          active = null;
        } else if (t - active.start > MAX_CLAP_MS) {
          // Sustained: speech, music, a fan. It was not a clap after all, so it cannot be the first of a pair.
          if (firstClapAt === active.start) firstClapAt = 0;
          active = null;
          refractoryUntil = t + 400;
          stats.reason = 'sonido largo (voz o música, no un aplauso)';
          stats.reasonAt = t;
        }
        return null;
      }

      // A sound that was nearly loud enough: say what kept it out.
      if (peak >= threshold * 0.6 && t >= refractoryUntil && t >= cooldownUntil) {
        const reason = !loud ? 'muy suave' : !sharp ? 'poco agudo (no suena a aplauso)' : !sudden ? 'no fue repentino' : '';
        if (reason) {
          stats.reason = reason;
          stats.reasonAt = t;
        }
      }
      if (firstClapAt && t - firstClapAt > MAX_GAP_MS) {
        firstClapAt = 0;
        if (stats.claps > stats.doubles * 2) stats.reason = stats.reason || 'solo oí un aplauso (hacen falta dos seguidos)';
      }
      // The room's noise level follows every frame that is not a clap burst (slowly up, faster down).
      if (!warming) floor = Math.max(MIN_FLOOR, floor + (peak - floor) * (peak > floor ? NOISE_UP : NOISE_DOWN));
      return null;
    },
  };
}
