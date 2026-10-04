// "Has the user finished talking?" for the microphone, from the loudness of the
// audio (pure, so it can be tested in Node). Fed with one reading of the volume
// (RMS, 0–1) every ~50 ms; says when to stop recording.
//
// What it has to get right:
//  - a normal pause to think (a second or more) must not cut the sentence;
//  - the quiet end of a word, soft speech and trailing syllables still count as voice
//    once the user has started (a lower bar to keep going than to start);
//  - the room's noise is measured from the QUIETEST moment of the first instant, not the
//    average, so a voice or a clap already ringing at that point does not set the bar
//    so high that speech is never heard.
export const DEFAULTS = {
  silenceMs: 1500, // quiet after speech that ends the recording
  noSpeechMs: 8000, // give up if nobody speaks
  maxMs: 60000, // the server's limit
  calibrationMs: 300,
};
export const MIN_SILENCE_MS = 800;
export const MAX_SILENCE_MS = 3000;

const START_MIN = 0.012; // quietest level that starts a sentence
const KEEP_MIN = 0.006; // quietest level that keeps it going
const START_RATIO = 3; // × the room's noise to start
const KEEP_RATIO = 1.7; // × the room's noise to keep going
const LEVEL_SHARE = 0.15; // × the usual voice level: below this is not voice
const FLOOR_START = 0.01; // what a quiet room is assumed to be until it has been measured
const FLOOR_CAP = 0.03; // a room louder than this cannot be told apart from speech

export const cleanSilenceMs = (value, fallback = DEFAULTS.silenceMs) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(MIN_SILENCE_MS, Math.min(MAX_SILENCE_MS, Math.round(n))) : fallback;
};

export function createEndpointer(options = {}) {
  const cfg = { ...DEFAULTS, ...options, silenceMs: cleanSilenceMs(options.silenceMs) };
  let started = null;
  let floor = FLOOR_START;
  let heard = false;
  let lastVoiceAt = 0;
  let level = 0; // how loud this person's voice usually is (smoothed, from the voice frames)

  return {
    // → { heard, stop, reason }  (`t` in ms, any origin)
    push({ t, rms }) {
      if (started == null) {
        started = t;
        lastVoiceAt = t;
      }
      if (t - started < cfg.calibrationMs) {
        floor = Math.min(floor, Math.max(rms, 0.0005));
        return { heard, stop: false, reason: '' };
      }
      const startBar = Math.max(START_MIN, floor * START_RATIO);
      const keepBar = Math.max(KEEP_MIN, floor * KEEP_RATIO);
      // Once talking, a frame is still voice above the keep bar AND above a share of how loud the person
      // talks: in a noisy room the noise alone must not keep the recording open for ever.
      const voice = rms > (heard ? Math.max(keepBar, level * LEVEL_SHARE) : startBar);
      if (voice) {
        level = level ? level + (rms - level) * 0.1 : rms;
        heard = true;
        lastVoiceAt = t;
      } else if (!heard) {
        // Before anyone speaks the estimate follows the room (down quickly, up a bit slower).
        floor = Math.min(FLOOR_CAP, floor + (rms - floor) * (rms < floor ? 0.2 : 0.06));
      }
      const quietFor = t - lastVoiceAt;
      if (heard && quietFor > cfg.silenceMs) return { heard, stop: true, reason: 'silence' };
      if (!heard && quietFor > cfg.noSpeechMs) return { heard, stop: true, reason: 'no-speech' };
      if (t - started > cfg.maxMs) return { heard, stop: true, reason: 'max' };
      return { heard, stop: false, reason: '' };
    },
    snapshot: () => ({ floor, heard, lastVoiceAt }),
  };
}
