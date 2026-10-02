// Pure maths of the memory orb (no React or canvas, so it can be tested in
// Node): where each memory sits on the sphere, its satellite points, the
// links between neighbours, and the projection to the screen.

export const ORB_COLORS = {
  profile: '#3fe8ff',
  preferences: '#7a8cff',
  projects: '#ff7ad9',
  decisions: '#ffb020',
  knowledge: '#4dffa6',
  context: '#c58bff',
  episodes: '#ff9a8a',
};

const SATELLITES = 11;
const DUST = 120;
const MIN_ANGLE = 0.3; // radians between two memories on the sphere
const LINK_MAX_ANGLE = 1.0;

// FNV-1a: the same id always gives the same number.
export function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small deterministic generator (mulberry32).
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (v) => {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
};

// A uniformly random point on the unit sphere.
function randomPoint(rand) {
  const y = 1 - 2 * rand();
  const r = Math.sqrt(1 - y * y);
  const t = 2 * Math.PI * rand();
  return { x: r * Math.cos(t), y, z: r * Math.sin(t) };
}

// The angle between two unit vectors.
export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

function satellitesOf(node, rand) {
  const helper = Math.abs(node.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const t1 = norm(cross(node, helper));
  const t2 = cross(node, t1);
  return Array.from({ length: SATELLITES }, () => {
    const spread = 0.05 + rand() * 0.3;
    const around = rand() * Math.PI * 2;
    const lift = 0.97 + rand() * 0.08;
    const p = norm({
      x: node.x * Math.cos(spread) + (t1.x * Math.cos(around) + t2.x * Math.sin(around)) * Math.sin(spread),
      y: node.y * Math.cos(spread) + (t1.y * Math.cos(around) + t2.y * Math.sin(around)) * Math.sin(spread),
      z: node.z * Math.cos(spread) + (t1.z * Math.cos(around) + t2.z * Math.sin(around)) * Math.sin(spread),
    });
    return { x: p.x * lift, y: p.y * lift, z: p.z * lift };
  });
}

// items: [{ id, category }] → { nodes, links, dust }.
// A memory keeps its place as others come and go (the spot comes from its
// id), except when two would land on top of each other: then the one that
// sorts later looks for another spot.
export function layoutOrb(items) {
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const nodes = [];
  for (const item of ordered) {
    let best = null;
    let bestGap = -1;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const p = randomPoint(seeded(hashString(`${item.id}:${attempt}`)));
      const gap = nodes.reduce((min, n) => Math.min(min, angleBetween(p, n)), Infinity);
      if (gap > bestGap) {
        best = p;
        bestGap = gap;
      }
      if (gap >= MIN_ANGLE) break;
    }
    const rand = seeded(hashString(`${item.id}:sat`));
    nodes.push({ id: item.id, category: item.category, ...best, sats: satellitesOf(best, rand) });
  }

  // Each memory links to its two nearest neighbours.
  const seen = new Set();
  const links = [];
  nodes.forEach((a, i) => {
    nodes
      .map((b, j) => ({ j, angle: i === j ? Infinity : angleBetween(a, b) }))
      .sort((p, q) => p.angle - q.angle)
      .slice(0, 2)
      .forEach(({ j, angle }) => {
        if (angle > LINK_MAX_ANGLE) return;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        links.push([i, j]);
      });
  });

  // A faint shell so the sphere is visible even before it remembers much.
  const dust = Array.from({ length: DUST }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / DUST;
    const r = Math.sqrt(1 - y * y);
    const t = i * 2.399963229728653; // golden angle
    return { x: r * Math.cos(t), y, z: r * Math.sin(t) };
  });
  return { nodes, links, dust };
}

// Turns a point by `yaw` (around the vertical axis) then `pitch`.
export function rotate(p, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x1 = p.x * cy + p.z * sy;
  const z1 = -p.x * sy + p.z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return { x: x1, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp };
}

// Screen position of a point; `depth` is 0 (back) to 1 (front).
export function project(p, rot, cx, cy, radius) {
  const r = rotate(p, rot.yaw, rot.pitch);
  const scale = 1 / (1.9 - r.z * 0.5);
  return { x: cx + r.x * radius * scale * 1.9, y: cy + r.y * radius * scale * 1.9, depth: (r.z + 1) / 2, scale };
}

// The memory under the pointer (the one in front wins), or -1.
export function pickNode(projected, px, py, hitRadius) {
  let best = -1;
  let bestDepth = -1;
  projected.forEach((p, i) => {
    if (p.depth < 0.35) return; // behind the sphere
    if (Math.hypot(p.x - px, p.y - py) <= hitRadius && p.depth > bestDepth) {
      best = i;
      bestDepth = p.depth;
    }
  });
  return best;
}

// Bring-in animation: 0 → 1 over `ms`, starting at `born`.
export function growth(now, born, ms = 700) {
  const g = Math.max(0, Math.min(1, (now - born) / ms));
  return 1 - (1 - g) ** 3;
}
