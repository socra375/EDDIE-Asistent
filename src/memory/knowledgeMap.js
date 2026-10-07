// Pure maths of the second brain's map (no React or canvas, so it can be tested
// in Node): a neuron. The glowing core in the middle is the brain; every kind of
// knowledge (empresarial, técnica, cotidiana…) is an arm of dendrites growing out
// of it, and every topic Eddie learned is a node on one of those branches: the
// oldest sit close to the core and each new topic grows the arm further out.
// Light travels along the branches toward the core (what is learned flowing in).
// Everything is deterministic from the topic ids, so the map looks the same every
// time and a new topic only adds its own branch.
import { hashString, seeded } from './orbMath.js';
import { KNOWLEDGE_CATEGORIES, cleanCategory } from '../services/knowledgeCategories.js';

// Width over height of the map. Map units: x in [-1, 1], y in ±1/ASPECT.
export const MAP_ASPECT = 1.7;
export const MAX_NOTES = 12;

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

// Each kind of knowledge has its own shape of node, so they can be told apart without the colour.
export const MAP_SHAPES = { empresarial: 'hex', tecnica: 'octa', cotidiana: 'circle', personal: 'diamond', salud: 'cross', academica: 'penta', creativa: 'spark', unica: 'ring' };
export const shapeOf = (category) => MAP_SHAPES[cleanCategory(category)];

// The corners of a node's shape, centred on (0, 0) with radius `r`, turned by `rot` (radians).
// circle and ring have no corners: they are drawn as arcs.
export function shapeVertices(shape, r, rot = 0) {
  const turn = (pts) => pts.map(([x, y]) => ({ x: x * Math.cos(rot) - y * Math.sin(rot), y: x * Math.sin(rot) + y * Math.cos(rot) }));
  const regular = (n, start = -Math.PI / 2) => Array.from({ length: n }, (_, k) => [Math.cos(start + (k * 2 * Math.PI) / n) * r, Math.sin(start + (k * 2 * Math.PI) / n) * r]);
  if (shape === 'hex') return turn(regular(6));
  if (shape === 'octa') return turn(regular(8, -Math.PI / 2 + Math.PI / 8));
  if (shape === 'penta') return turn(regular(5));
  if (shape === 'diamond') return turn([[0, -r * 1.12], [r * 0.82, 0], [0, r * 1.12], [-r * 0.82, 0]]);
  if (shape === 'cross') {
    const a = r * 0.36;
    const b = r * 0.98;
    return turn([[-a, -b], [a, -b], [a, -a], [b, -a], [b, a], [a, a], [a, b], [-a, b], [-a, a], [-b, a], [-b, -a], [-a, -a]]);
  }
  if (shape === 'spark') return turn(Array.from({ length: 8 }, (_, k) => [Math.cos(-Math.PI / 2 + (k * Math.PI) / 4) * r * (k % 2 ? 0.4 : 1.12), Math.sin(-Math.PI / 2 + (k * Math.PI) / 4) * r * (k % 2 ? 0.4 : 1.12)]));
  return [];
}

// The colour of the core (the brain itself).
export const CORE_RGB = { dark: '63,232,255', light: '0,127,153' };

const TWO_PI = Math.PI * 2;
const LANES = 3; // branches side by side on one arm
const ARM_SPAN = TWO_PI / KNOWLEDGE_CATEGORIES.length;
const ARM_ANGLE = Object.fromEntries(KNOWLEDGE_CATEGORIES.map((c, i) => [c.id, -Math.PI / 2 + i * ARM_SPAN + 0.25]));

// Distance from the core of the ring `depth` (0 = closest): it saturates so a long arm stays inside the map.
export const ringRadius = (depth) => 0.34 + 0.58 * (depth / (depth + 1.6));

// A point of an ellipse with centre (cx, cy), semi-axes (rx, ry), turned by `rot`, at angle `theta`.
export function ellipsePoint(e, theta) {
  const x = e.rx * Math.cos(theta);
  const y = e.ry * Math.sin(theta);
  const c = Math.cos(e.rot);
  const s = Math.sin(e.rot);
  return { x: e.cx + x * c - y * s, y: e.cy + x * s + y * c };
}

// Where a node is at time `t` (seconds): it sways a little around its place on the branch.
export function nodePoint(node, t) {
  return ellipsePoint(node.orbit, node.phase + node.speed * t);
}

// A point of the quadratic curve p → q bent by the control point c, at u in [0, 1].
export function bezierPoint(p, c, q, u) {
  const v = 1 - u;
  return { x: v * v * p.x + 2 * v * u * c.x + u * u * q.x, y: v * v * p.y + 2 * v * u * c.y + u * u * q.y };
}

// The control point that bends the branch p → q sideways by `bend` (a fraction of its length).
export function bendPoint(p, q, bend) {
  return { x: (p.x + q.x) / 2 - (q.y - p.y) * bend, y: (p.y + q.y) / 2 + (q.x - p.x) * bend };
}

// topics: [{ id, category, noteCount, kind, createdAt? }] → { nodes, links, filaments, dust }
// node.parent: index of the node it grows from, or -1 when it grows from the core.
export function layoutMap(topics) {
  const list = (Array.isArray(topics) ? topics : []).map((topic) => ({ topic, category: cleanCategory(topic.category) }));
  // Oldest first within an arm: a new topic always grows at the far end and never moves the others.
  const age = (t) => Date.parse(t.createdAt) || 0;
  const ordered = [...list].sort((a, b) => age(a.topic) - age(b.topic) || (a.topic.id < b.topic.id ? -1 : 1));
  const slots = new Map(); // category → how many it already holds
  const byPlace = new Map(); // `category:depth:lane` → index in `nodes`
  const placed = new Map(); // topic id → { category, depth, lane, k }
  for (const { topic, category } of ordered) {
    const k = slots.get(category) || 0;
    slots.set(category, k + 1);
    placed.set(topic.id, { category, depth: Math.floor(k / LANES), lane: k % LANES, k });
  }

  const nodes = list.map(({ topic, category }) => {
    const { depth, lane } = placed.get(topic.id);
    const rand = seeded(hashString(`k:${topic.id}`));
    const spreadAngle = (lane - 1) * (0.3 + depth * 0.045) + (rand() - 0.5) * 0.1;
    const angle = ARM_ANGLE[category] + spreadAngle;
    const radius = ringRadius(depth) + (rand() - 0.5) * 0.06;
    const base = { x: Math.cos(angle) * radius, y: (Math.sin(angle) * radius) / MAP_ASPECT };
    const sway = 0.008 + rand() * 0.014;
    const notes = Math.max(0, Math.min(MAX_NOTES, Number(topic.noteCount) || 0));
    return {
      id: topic.id,
      title: String(topic.title || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      sources: Math.max(0, Math.min(6, Number(topic.sourceCount) || 0)),
      updated: Date.parse(topic.updatedAt) || 0,
      category,
      kind: topic.kind === 'habilidad' ? 'habilidad' : 'tema',
      depth,
      lane,
      parent: -1,
      // A soft curve: some branches bow one way, some the other.
      bend: (rand() - 0.5) * 0.5,
      orbit: { cx: base.x, cy: base.y, rx: sway, ry: sway * (0.55 + rand() * 0.4), rot: rand() * Math.PI },
      phase: rand() * TWO_PI,
      // 10–25 s a sway, either way round: it should breathe, not wander.
      speed: (0.25 + rand() * 0.35) * (rand() < 0.5 ? -1 : 1),
      notes,
      size: 5 + notes * 0.5,
      pulse: { period: 5 + rand() * 5, offset: rand() * 8 },
      // Each branch's flow: where its light starts, how fast it runs.
      flow: { offset: rand(), speed: 0.1 + rand() * 0.08 },
      // Small twigs that end in a dot, like the ends of real dendrites.
      beads: [0.3 + rand() * 0.08, 0.62 + rand() * 0.1],
      twigs: Array.from({ length: 2 }, () => ({ u: 0.45 + rand() * 0.35, side: rand() < 0.5 ? -1 : 1, len: 0.045 + rand() * 0.05, tilt: 0.5 + rand() * 0.7 })),
    };
  });

  nodes.forEach((n, i) => {
    byPlace.set(`${n.category}:${n.depth}:${n.lane}`, i);
  });
  // Each node grows from the one before it on its own lane (or the middle lane, or the core).
  for (const n of nodes) {
    if (n.depth === 0) continue;
    const prev = byPlace.get(`${n.category}:${n.depth - 1}:${n.lane}`) ?? byPlace.get(`${n.category}:${n.depth - 1}:1`) ?? byPlace.get(`${n.category}:${n.depth - 1}:0`);
    n.parent = prev ?? -1;
  }

  // Synapses: each node reaches the nearest node of another kind, when it is close.
  const seen = new Set();
  const links = [];
  nodes.forEach((a, i) => {
    let best = -1;
    let bestDist = 0.34;
    nodes.forEach((b, j) => {
      if (i === j || a.category === b.category) return;
      const d = Math.hypot(a.orbit.cx - b.orbit.cx, (a.orbit.cy - b.orbit.cy) * MAP_ASPECT);
      if (d < bestDist) {
        best = j;
        bestDist = d;
      }
    });
    const key = i < best ? `${i}-${best}` : `${best}-${i}`;
    if (best >= 0 && !seen.has(key)) {
      seen.add(key);
      links.push([i, best]);
    }
  });

  // Faint far dendrites that fill the dark (fixed seeds: nothing moves when a topic is added).
  const filaments = Array.from({ length: 12 }, (_, k) => {
    const rand = seeded(hashString(`f:${k}`));
    return { angle: (k / 12) * TWO_PI + (rand() - 0.5) * 0.35, length: 0.7 + rand() * 0.26, bend: (rand() - 0.5) * 0.9, flow: { offset: rand(), speed: 0.05 + rand() * 0.05 } };
  });

  // Specks of light in the dark.
  const dust = Array.from({ length: 80 }, (_, k) => {
    const rand = seeded(hashString(`s:${k}`));
    return { x: (rand() * 2 - 1) * 0.97, y: ((rand() * 2 - 1) * 0.97) / MAP_ASPECT, size: 0.5 + rand() * 1.1, tw: rand() * TWO_PI, rate: 0.5 + rand() * 1.1 };
  });

  return { nodes, links, filaments, dust };
}

// The chain of branches from a node to the core: [{ from, to, bend }] with from/to
// as node indexes (-1 = core), starting at the node and ending at the core.
export function chainOf(nodes, index) {
  const chain = [];
  let at = index;
  for (let guard = 0; at >= 0 && guard < 64; guard += 1) {
    chain.push({ from: at, to: nodes[at].parent, bend: nodes[at].bend });
    at = nodes[at].parent;
  }
  return chain;
}

// The core: a small mesh ball (points of a sphere joined to their near neighbours)
// that turns slowly. Returns the unrotated points and the edges between them.
export function somaMesh(count = 30) {
  const points = Array.from({ length: count }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const theta = i * Math.PI * (3 - Math.sqrt(5));
    return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
  });
  const edges = [];
  const reach = 1.12 * Math.sqrt((4 * Math.PI) / count) * 1.1; // a little more than the typical gap
  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y, points[i].z - points[j].z);
      if (d < reach) edges.push([i, j]);
    }
  }
  return { points, edges };
}

// The mesh turned `angle` around its vertical axis and tipped by `tilt`: x, y in the unit disc, z (depth) in [-1, 1].
export function turnSoma(points, angle, tilt = 0.35) {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  return points.map((p) => {
    const x = p.x * ca + p.z * sa;
    const z = -p.x * sa + p.z * ca;
    return { x, y: p.y * ct - z * st, z: p.y * st + z * ct };
  });
}

// Dragging the core moves the whole neuron. The core may travel this far from the middle (map units).
export const CORE_REACH = { x: 0.55, y: 0.32 };
export const clampOffset = (x, y) => ({ x: Math.max(-CORE_REACH.x, Math.min(CORE_REACH.x, x)), y: Math.max(-CORE_REACH.y, Math.min(CORE_REACH.y, y)) });

// How quickly a node catches up with the core per frame at 60 fps (0–1): the ones close to the core follow
// tightly and the far ones lag behind, so the branches stretch and swing like something soft.
export const followFactor = (depth) => 0.42 - 0.07 * Math.min(Math.max(depth, 0), 4);

// One step of "catch up with the target": the same pace at any frame rate (`dt` in seconds).
export const catchUp = (current, target, k, dt) => current + (target - current) * (1 - (1 - k) ** (Math.max(dt, 0) * 60));

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
