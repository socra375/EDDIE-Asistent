// The thinking part of "Modo Vigilancia", with no browser APIs so it can be
// tested on its own: when a camera frame is worth sending, what changed
// between two analyses, and when Eddie may say something out loud.

// ---- Motion: is the scene different enough to look at again? ----
export const MOTION_W = 32;
export const MOTION_H = 24;
export const MOTION_THRESHOLD = 0.04; // mean grey difference, 0..1
export const MAX_IDLE_MS = 30_000; // look again at least this often, even if nothing moved

// Mean absolute difference between two grey frames (0..255 each), as 0..1.
export function motionScore(prev, next) {
  if (!prev || !next || prev.length !== next.length || !next.length) return 1;
  let sum = 0;
  for (let i = 0; i < next.length; i += 1) sum += Math.abs(next[i] - prev[i]);
  return sum / next.length / 255;
}

// `force`: something is waiting to be confirmed (see createEventTracker.hasPending),
// so look again right away even if the scene is still.
export function shouldAnalyze({ score, sinceLastMs, hasPrevious = true, force = false, threshold = MOTION_THRESHOLD, maxIdleMs = MAX_IDLE_MS }) {
  if (!hasPrevious || force) return true;
  return score >= threshold || sinceLastMs >= maxIdleMs;
}

// ---- What changed: appearances and departures, without flicker ----
export const keyOf = (object) => `${object.category}:${String(object.label).toLowerCase()}`;

// A label counts as "there" after it shows up in CONFIRM analyses in a row and
// as "gone" after it is missing from CONFIRM in a row, so one blurry frame
// can't make a person flicker in and out.
export function createEventTracker({ confirm = 2 } = {}) {
  const items = new Map(); // key → { object, present, seen, missed }
  return {
    // `objects` of the latest analysis → events [{ type: 'appeared' | 'left', key, label, category }]
    update(objects) {
      const events = [];
      const now = new Set();
      for (const object of objects) {
        const key = keyOf(object);
        now.add(key);
        const item = items.get(key) || { object, present: false, seen: 0, missed: 0 };
        item.object = object;
        item.seen += 1;
        item.missed = 0;
        if (!item.present && item.seen >= confirm) {
          item.present = true;
          events.push({ type: 'appeared', key, label: object.label, category: object.category });
        }
        items.set(key, item);
      }
      for (const [key, item] of items) {
        if (now.has(key)) continue;
        item.seen = 0;
        item.missed += 1;
        if (item.present && item.missed >= confirm) {
          item.present = false;
          events.push({ type: 'left', key, label: item.object.label, category: item.object.category });
        }
        if (!item.present && item.missed >= confirm) items.delete(key);
      }
      return events;
    },
    // Is a sighting (or a disappearance) still waiting for its confirmation?
    hasPending() {
      for (const item of items.values()) {
        if (!item.present && item.seen > 0 && item.seen < confirm) return true;
        if (item.present && item.missed > 0 && item.missed < confirm) return true;
      }
      return false;
    },
    reset() {
      items.clear();
    },
  };
}

const capitalize = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// The line shown in the event log.
export function describeEvent(event) {
  const label = capitalize(event.label);
  return event.type === 'appeared' ? `${label} detectado` : `${label}: ya no está`;
}

// ---- What Eddie says: only people and animals, and not too often ----
export const ANNOUNCE_GAP_MS = 15_000;
export const ANNOUNCE_SAME_MS = 60_000;

const SPOKEN = new Set(['persona', 'animal']);

export function createAnnouncer({ gapMs = ANNOUNCE_GAP_MS, sameMs = ANNOUNCE_SAME_MS } = {}) {
  let lastAt = -Infinity;
  const byKey = new Map();
  return {
    // The sentence to say for this event now, or '' to stay quiet.
    next(event, now) {
      if (!SPOKEN.has(event.category)) return '';
      if (now - lastAt < gapMs) return '';
      if (now - (byKey.get(event.key) ?? -Infinity) < sameMs) return '';
      lastAt = now;
      byKey.set(event.key, now);
      const label = event.label.toLowerCase();
      const article = event.category === 'persona' ? 'una' : 'un';
      if (event.type === 'appeared') return event.category === 'persona' ? 'Detecto una persona.' : `Detecto ${article} ${label}.`;
      return event.category === 'persona' ? 'La persona ya no está.' : `El ${label} ya no está.`;
    },
    reset() {
      lastAt = -Infinity;
      byKey.clear();
    },
  };
}
