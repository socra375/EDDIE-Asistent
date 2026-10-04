// Pure maths of the second brain's map (no React or canvas, so it can be tested
// in Node): a tangle of orbits like a star chart. Every topic Eddie learned is a
// ringed node travelling along its own ellipse, with one small point per note
// trailing behind it; topics of the same kind gather in the same region and take
// the same colour; thin curves link neighbours and a few long faint arcs fill the
// space between. Everything is deterministic from the topic ids, so the map looks
// the same every time and a new topic only adds its own orbit.
import { hashString, seeded } from './orbMath.js';
import { KNOWLEDGE_CATEGORIES, cleanCategory } from '../services/knowledgeCategories.js';

// Width over height of the map. Map units: x in [-1, 1], y in ±1/ASPECT.
export const MAP_ASPECT = 1.7;
export const MAX_TRAIL = 12;

// One colour per kind of knowledge (neon on the dark HUD, deeper on the light theme).
export const MAP_COLORS = {
  dark: {
    empresarial: '#ffb020',
    tecnica: '#3fe8ff',
    cotidiana: '#4dffa6',
    personal: '#ff7ad9',
    salud: '#ff6b81',
    academica: '#7a8cff',
    creativa: '#c58bff',
    unica: '#f2f7ff',
  },
  light: {
    empresarial: '#b36b00',
    tecnica: '#007f99',
    cotidiana: '#0b8a55',
    personal: '#b8228e',
    salud: '#c0334b',
    academica: '#3d4fd6',
    creativa: '#7b3fc4',
    unica: '#3b4252',
  },
};

export const colorOf = (category, theme = 'dark') => (MAP_COLORS[theme] || MAP_COLORS.dark)[cleanCategory(category)];

// Where each kind gathers: eight regions around the middle.
const ANCHORS = Object.fromEntries(
  KNOWLEDGE_CATEGORIES.map((c, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / KNOWLEDGE_CATEGORIES.length + 0.25;
    return [c.id, { x: Math.cos(a) * 0.6, y: (Math.sin(a) * 0.62) / MAP_ASPECT }];
  }),
);

const TWO_PI = Math.PI * 2;
const EDGE = 0.95; // how close to the border of the map an orbit may reach (map width = 2)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const spread = (rand) => (rand() + rand() - 1) / 1; // −1…1, bunched around 0

// A point of an ellipse with centre (cx, cy), semi-axes (rx, ry), turned by `rot`, at angle `theta`.
export function ellipsePoint(e, theta) {
  const x = e.rx * Math.cos(theta);
  const y = e.ry * Math.sin(theta);
  const c = Math.cos(e.rot);
  const s = Math.sin(e.rot);
  return { x: e.cx + x * c - y * s, y: e.cy + x * s + y * c };
}

// Where a node is at time `t` (seconds), and where each of its note points trails behind it.
export function nodePoint(node, t) {
  return ellipsePoint(node.orbit, node.phase + node.speed * t);
}

export function trailPoints(node, t) {
  return node.trail.map((offset) => ellipsePoint(node.orbit, node.phase + node.speed * t - Math.sign(node.speed || 1) * offset));
}

// Rough length of an ellipse (Ramanujan), in map units: for the "drawing in" dash.
export const ellipseLength = (e) => Math.PI * (3 * (e.rx + e.ry) - Math.sqrt((3 * e.rx + e.ry) * (e.rx + 3 * e.ry)));

// topics: [{ id, category, noteCount, kind }] → { nodes, links, decor }
export function layoutMap(topics) {
  const nodes = (Array.isArray(topics) ? topics : []).map((topic) => {
    const rand = seeded(hashString(`k:${topic.id}`));
    const category = cleanCategory(topic.category);
    const anchor = ANCHORS[category];
    const rx = 0.13 + rand() * 0.3;
    const ry = rx * (0.32 + rand() * 0.5);
    const rot = rand() * Math.PI;
    // Half the width and height the turned ellipse takes up: it must fit inside the map (the node never gets cut off).
    const halfW = Math.hypot(rx * Math.cos(rot), ry * Math.sin(rot));
    const halfH = Math.hypot(rx * Math.sin(rot), ry * Math.cos(rot));
    const limitX = Math.max(0, EDGE - halfW);
    const limitY = Math.max(0, EDGE / MAP_ASPECT - halfH);
    const orbit = {
      cx: clamp(anchor.x + spread(rand) * 0.36, -limitX, limitX),
      cy: clamp(anchor.y + (spread(rand) * 0.3) / MAP_ASPECT, -limitY, limitY),
      rx,
      ry,
      rot,
    };
    const notes = Math.max(0, Math.min(MAX_TRAIL, Number(topic.noteCount) || 0));
    return {
      id: topic.id,
      category,
      kind: topic.kind === 'habilidad' ? 'habilidad' : 'tema',
      orbit,
      phase: rand() * TWO_PI,
      // 100–300 s a lap, either way round: it should drift, not race.
      speed: (0.02 + rand() * 0.045) * (rand() < 0.5 ? -1 : 1),
      // One point per note, strung out behind the node along its orbit.
      trail: Array.from({ length: notes }, (_, k) => 0.09 + k * 0.085),
      size: 5 + Math.min(notes, MAX_TRAIL) * 0.55,
      pulse: { period: 5 + rand() * 5, offset: rand() * 8 },
    };
  });

  // Each node is linked to its two nearest orbit centres (same-kind neighbours count as closer).
  const key = (i, j) => (i < j ? `${i}-${j}` : `${j}-${i}`);
  const seen = new Set();
  const links = [];
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, d: i === j ? Infinity : Math.hypot(a.orbit.cx - b.orbit.cx, (a.orbit.cy - b.orbit.cy) * MAP_ASPECT) * (a.category === b.category ? 0.55 : 1) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 2)
      .forEach(({ j, d }) => {
        if (!Number.isFinite(d) || seen.has(key(i, j))) return;
        seen.add(key(i, j));
        links.push([i, j]);
      });
  });

  // The long faint sweeps between (fixed seeds: a new topic adds some, never moves the others).
  const arcs = Math.max(6, Math.min(38, 6 + nodes.length * 2));
  const decor = Array.from({ length: arcs }, (_, k) => {
    const rand = seeded(hashString(`d:${k}`));
    const rx = 0.35 + rand() * 0.85;
    const orbit = { cx: (rand() * 2 - 1) * 0.9, cy: ((rand() * 2 - 1) * 0.9) / MAP_ASPECT, rx, ry: rx * (0.18 + rand() * 0.45), rot: rand() * Math.PI };
    // A few arcs borrow the colour of the topic whose orbit is nearest.
    let nearest = null;
    let best = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.orbit.cx - orbit.cx, (n.orbit.cy - orbit.cy) * MAP_ASPECT);
      if (d < best) {
        best = d;
        nearest = n;
      }
    }
    return {
      orbit,
      start: rand() * TWO_PI,
      sweep: 0.9 + rand() * 1.9,
      category: nearest && rand() < 0.45 ? nearest.category : null,
      marker: rand() < 0.4, // a small ring where the arc ends
      comet: { speed: 0.04 + rand() * 0.06, offset: rand() },
      ticks: 5 + Math.floor(rand() * 8),
    };
  });

  return { nodes, links, decor };
}

// The node under the pointer (the nearest within `hit` pixels), or -1.
export function pickMapNode(points, px, py, hit) {
  let best = -1;
  let bestDist = hit;
  points.forEach((p, i) => {
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= bestDist) {
      best = i;
      bestDist = d;
    }
  });
  return best;
}
