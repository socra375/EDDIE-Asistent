// ElevenLabs clips carry a little silence at both ends (and the MP3 codec adds
// some more); played back to back they turn into a pause between sentences.
// Finds where the sound really starts and ends so the player can skip the rest.
// Pure (works on plain Float32Arrays), so it can be tested in Node.

const THRESHOLD = 0.012; // below this a sample counts as silence
const KEEP_S = 0.035; // a breath is left at each end so nothing is clipped
const MIN_KEEP_S = 0.15; // never trim a clip down to less than this

// channels: Float32Array[] → { start, end } in seconds (the whole clip if it is too short or all silent)
export function soundBounds(channels, sampleRate, { threshold = THRESHOLD, keep = KEEP_S } = {}) {
  const length = channels[0]?.length || 0;
  const duration = length / sampleRate;
  if (!length || duration <= MIN_KEEP_S * 2) return { start: 0, end: duration };
  const loud = (i) => channels.some((c) => Math.abs(c[i]) > threshold);
  let first = 0;
  while (first < length && !loud(first)) first += 1;
  if (first >= length) return { start: 0, end: duration };
  let last = length - 1;
  while (last > first && !loud(last)) last -= 1;
  const start = Math.max(0, first / sampleRate - keep);
  const end = Math.min(duration, (last + 1) / sampleRate + keep);
  return end - start < MIN_KEEP_S ? { start: 0, end: duration } : { start, end };
}
