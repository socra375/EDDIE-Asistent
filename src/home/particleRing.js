// Pure maths of the home ring (no React or canvas, so it can be tested in
// Node): thousands of points laid along a handful of undulating ribbons that
// wind around a circle, like a luminous flow of particles, with a dark empty
// disc in the middle. Coordinates are normalised: the canvas half-size is 1.
//
// The empty disc (SLOT) is kept clear on purpose: later on it is where an image
// Eddie is asked for will appear, so no particle may ever enter it.
import { hashString, seeded } from './orbMathShared.js';

export const SLOT = 0.5; // radius of the clear centre (half the orb: room for an image)
export const OUTER = 1; // nothing is drawn beyond this
export const RING_RADIUS = 0.77; // where the ribbons run on average
const MARGIN = 0.02; // the particles stay this far from the slot and the edge
const BANDS = 5;
const TWO_PI = Math.PI * 2;

// What each state of Eddie does to the flow. `speed` scales every motion, `amp` the waviness,
// `glow` the brightness; `tint` picks the colour the screen resolves ('ring' or 'soft').
export const STATE_PARAMS = {
  idle: { speed: 1, amp: 1, glow: 0.85, tint: 'ring', beat: 0 },
  listening: { speed: 1.7, amp: 1.2, glow: 1.15, tint: 'ring', beat: 0.14 },
  processing: { speed: 3.4, amp: 0.85, glow: 1.1, tint: 'soft', beat: 0 },
  speaking: { speed: 1.35, amp: 1.05, glow: 1.1, tint: 'ring', beat: 0.2 },
  error: { speed: 0.5, amp: 1.1, glow: 1, tint: 'ring', beat: 0 },
  disabled: { speed: 0, amp: 0.55, glow: 0.35, tint: 'ring', beat: 0 },
};

export const paramsFor = (state) => STATE_PARAMS[state] || STATE_PARAMS.idle;

// Moves the current parameters a step toward the target ones (so a change of state flows, not jumps).
export function blendParams(current, target, k = 0.08) {
  const out = { ...target };
  for (const key of ['speed', 'amp', 'glow', 'beat']) out[key] = current[key] + (target[key] - current[key]) * k;
  return out;
}

// One ribbon: how it waves, how fast, how it folds.
function makeBands() {
  return Array.from({ length: BANDS }, (_, b) => {
    const rand = seeded(hashString(`ring-band:${b}`));
    return {
      amp: 0.07 + rand() * 0.05,
      k: [2, 3, 3, 4, 5][b],
      wave: (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.11), // rad/s the undulation travels
      drift: (rand() < 0.5 ? -1 : 1) * (0.015 + rand() * 0.04), // rad/s the whole ribbon turns
      phase: rand() * TWO_PI,
      phase2: rand() * TWO_PI,
      offset: (rand() * 2 - 1) * 0.05, // its radius against the mean
      half: 0.03 + rand() * 0.03, // half-width of the ribbon
      fold: 0.3 + rand() * 0.6, // how much it seems to turn toward and away from the eye
    };
  });
}

export const BAND_SET = makeBands();

// `count` particles. Any prefix is a fair sample, so a lighter machine just draws fewer.
export function createParticles(count, seed = 'home-ring') {
  const rand = seeded(hashString(seed));
  return Array.from({ length: count }, () => {
    const mist = rand() < 0.2;
    return {
      band: Math.floor(rand() * BANDS),
      u: rand() * TWO_PI,
      // Triangular: dense on the spine of the ribbon, thin toward its edges.
      w: rand() + rand() - 1,
      mist,
      // The haze drifts a little further out and in than the ribbon itself.
      haze: mist ? (rand() < 0.6 ? 1 : -1) * (0.025 + rand() * 0.055) : 0,
      size: mist ? 0.8 + rand() * 0.5 : 1 + rand() * 1,
      twinkle: rand() * TWO_PI,
    };
  });
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// How far from the ring radius a particle may stray each way. Beyond that the excursion is squeezed
// smoothly (tanh), so big waves never pile up against the free centre or the edge of the canvas.
const ROOM_IN = RING_RADIUS - (SLOT + MARGIN) - 0.005;
const ROOM_OUT = OUTER - MARGIN - RING_RADIUS - 0.005;
const squash = (dev) => (dev >= 0 ? ROOM_OUT * Math.tanh(dev / ROOM_OUT) : ROOM_IN * Math.tanh(dev / ROOM_IN));

// Where a particle is at time `t` (seconds) under `params`: { x, y, alpha, r }.
export function particleAt(p, t, params) {
  const band = BAND_SET[p.band];
  const flow = t * params.speed;
  const beat = params.beat ? 1 + params.beat * Math.sin(t * TWO_PI * 2.4) * (0.6 + 0.4 * Math.sin(t * TWO_PI * 0.7)) : 1;
  const theta = p.u + band.drift * flow;
  const wave = Math.sin(band.k * theta + band.phase + band.wave * flow) + 0.4 * Math.sin((band.k + 2) * theta - band.phase * 1.7 + band.wave * 0.6 * flow);
  const z = Math.sin(Math.max(1, Math.floor(band.k / 2)) * theta + band.phase2 + 0.4 * flow); // a whole number of turns, so the ribbon closes without a seam // −1 away … 1 toward the eye
  let r = RING_RADIUS + band.offset + band.amp * params.amp * beat * wave + p.w * band.half + p.haze;
  r *= 1 + 0.03 * band.fold * z;
  r = RING_RADIUS + squash(r - RING_RADIUS);
  r = clamp(r, SLOT + MARGIN, OUTER - MARGIN);
  const spine = 1 - Math.abs(p.w);
  const depth = 0.65 + 0.35 * z;
  const twinkle = 0.88 + 0.12 * Math.sin(p.twinkle + t * 1.3 * params.speed);
  const base = p.mist ? 0.1 + 0.16 * depth : 0.28 + 0.72 * spine * spine * depth;
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), alpha: clamp(base * twinkle * params.glow, 0, 1), r };
}

// The thread of light along one ribbon (w = across: −1 … 1 from one edge to the other): `n` points
// around the circle at time `t`, for drawing as a fine line.
export function spineLine(bandIndex, across, t, params, n = 96) {
  const out = [];
  for (let i = 0; i <= n; i += 1) {
    const q = particleAt({ band: bandIndex, u: (i / n) * TWO_PI, w: across, haze: 0, mist: false, size: 1, twinkle: 0 }, t, params);
    out.push(q);
  }
  return out;
}
