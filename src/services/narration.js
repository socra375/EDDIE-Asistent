// What Eddie says, every few seconds, about the camera of another device he is
// watching ("PC: aparece 1 persona", "Ya no hay nadie a la vista", "PC: sin
// novedades, veo 1 laptop"). Pure (no browser APIs), so it can be tested in Node.
//
// The viewer pushes each new picture's objects (about one a second); the
// narrator turns that into confirmed changes — something must hold for a few
// pictures in a row before it counts, so one blurry frame doesn't make a
// person come and go — and `report()` says what changed since the last report.
import { plural } from './localScene.js';

const MAJOR = new Set(['persona', 'animal', 'vehículo']);
const FEMININE_O = new Set(['moto', 'foto', 'mano']);

const keyOf = (o) => `${o.category}:${String(o.label).toLowerCase()}`;
const feminine = (label) => {
  const word = String(label).split(' ')[0].toLowerCase();
  return FEMININE_O.has(word) || /a$/.test(word) || word === 'señal';
};
// "una persona", "un perro", "3 sillas"
export function countPhrase(label, count) {
  if (count === 1) return `${feminine(label) ? 'una' : 'un'} ${label}`;
  return `${count} ${plural(label, count)}`;
}

const listOf = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}` : parts[0] || '');

export function createNarrator({ confirm = 2 } = {}) {
  const items = new Map(); // key → { label, category, shown, cand, streak }
  let started = false; // the first picture sets the baseline
  let announcedStart = false;
  let pending = []; // confirmed changes not yet said
  let lastSpokenAt = 0;

  const current = () => [...items.values()].filter((i) => i.shown > 0).sort((a, b) => Number(MAJOR.has(b.category)) - Number(MAJOR.has(a.category)));

  return {
    // objects: [{ label, category, count }] of the latest picture.
    push(objects) {
      const seen = new Map();
      for (const o of Array.isArray(objects) ? objects : []) if (o?.label) seen.set(keyOf(o), { label: String(o.label), category: o.category || 'objeto', count: Math.max(1, Number(o.count) || 1) });
      if (!started) {
        started = true;
        for (const [key, o] of seen) items.set(key, { label: o.label, category: o.category, shown: o.count, cand: o.count, streak: 0 });
        return;
      }
      for (const [key, o] of seen) if (!items.has(key)) items.set(key, { label: o.label, category: o.category, shown: 0, cand: 0, streak: 0 });
      for (const [key, item] of items) {
        const count = seen.get(key)?.count || 0;
        if (count === item.shown) {
          item.cand = count;
          item.streak = 0;
        } else {
          item.streak = count === item.cand ? item.streak + 1 : 1;
          item.cand = count;
          // Objects are noisier than people: they need one more picture.
          if (item.streak >= confirm + (MAJOR.has(item.category) ? 0 : 1)) {
            pending.push({ key, label: item.label, category: item.category, from: item.shown, to: count });
            item.shown = count;
            item.streak = 0;
          }
        }
        if (item.shown === 0 && count === 0) items.delete(key);
      }
    },

    // → { text, kind: 'start' | 'change' | 'idle' } or null when there is nothing to say.
    // `name` is the device ("PC"); idleEveryMs 0 never reports "sin novedades".
    report({ now = Date.now(), name = 'El dispositivo', idleEveryMs = 30_000 } = {}) {
      if (!started) return null;
      const seenNow = current();
      const sightings = () => (seenNow.length ? `veo ${listOf(seenNow.map((i) => countPhrase(i.label, i.shown)))}` : 'no veo nada destacable');
      if (!announcedStart) {
        announcedStart = true;
        pending = [];
        lastSpokenAt = now;
        return { kind: 'start', text: `${name}: conectado, ${sightings()}.` };
      }
      if (pending.length) {
        const sentences = [];
        const appeared = pending.filter((c) => c.from === 0);
        const left = pending.filter((c) => c.to === 0);
        const changed = pending.filter((c) => c.from > 0 && c.to > 0);
        for (const c of appeared.filter((x) => x.category === 'persona')) sentences.push(c.to === 1 ? 'aparece una persona' : `aparecen ${c.to} personas`);
        const others = appeared.filter((x) => x.category !== 'persona').map((c) => countPhrase(c.label, c.to));
        if (others.length) sentences.push(`aparece ${listOf(others)}`);
        for (const c of left.filter((x) => x.category === 'persona')) sentences.push(c.from === 1 ? 'la persona ya no está' : 'ya no hay nadie a la vista');
        const gone = left.filter((x) => x.category !== 'persona').map((c) => countPhrase(c.label, c.from));
        if (gone.length) sentences.push(`ya no está ${listOf(gone)}`);
        for (const c of changed) sentences.push(`ahora hay ${countPhrase(c.label, c.to)}`);
        pending = [];
        lastSpokenAt = now;
        const text = sentences.join('; ');
        return { kind: 'change', text: `${name}: ${text}.` };
      }
      if (idleEveryMs > 0 && now - lastSpokenAt >= idleEveryMs) {
        lastSpokenAt = now;
        return { kind: 'idle', text: `${name}: sin novedades, ${sightings()}.` };
      }
      return null;
    },

    reset() {
      items.clear();
      pending = [];
      started = false;
      announcedStart = false;
      lastSpokenAt = 0;
    },
  };
}
