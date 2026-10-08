// Where things sit on the third brain's picture (pure, so it can be tested in Node):
// a dotted sphere in the middle, six arms (one per area) that reach outward, a
// bright anchor at the end of each arm that names the area, and the items of
// that area as dots along the arm. Deterministic from the ids: a new item only
// adds its own dot.
import { AREAS } from '../services/business.js';

export const MAP_ASPECT = 1.6; // width over height of the picture
const ARM_BEND = 0.14; // how much an arm curves (radians)
const SPREAD = 0.42; // how wide the items fan around their arm (radians)

export const AREA_COLORS = {
  clientes: '#6ab8ff',
  negocios: '#9d7bff',
  estilo: '#5ff0ff',
  contexto: '#7b8cff',
  precios: '#c08bff',
  trabajo: '#58a6ff',
};

// FNV-1a: the same id always gives the same number.
export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A point along an arm: t in [0, 1] from the middle outward, the arm of `area`. Unit coordinates
// (x in [-1, 1] across the picture, y scaled by the aspect), relative to the middle.
export function armPoint(area, t) {
  const base = AREAS.find((a) => a.id === area)?.angle ?? 0;
  const theta = (base * Math.PI) / 180;
  const bend = Math.sin(t * 3.1) * ARM_BEND * t;
  const a = theta + bend;
  return { x: Math.cos(a) * t, y: (Math.sin(a) * t) / MAP_ASPECT };
}

// How far along its arm an item sits: the newest closest to the anchor's side, older ones further in.
export function itemT(index) {
  return 0.3 + 0.5 * (1 - 1 / (index + 2));
}

// The place of one item: its arm, its distance and a fan around the arm.
export function itemPlace(item, index) {
  const t = itemT(index);
  const base = AREAS.find((a) => a.id === item.area)?.angle ?? 0;
  const fan = ((hash(String(item.id)) % 1000) / 1000 - 0.5) * SPREAD;
  const theta = (base * Math.PI) / 180 + fan;
  const bend = Math.sin(t * 3.1) * ARM_BEND * t;
  const a = theta + bend;
  return { x: Math.cos(a) * t, y: (Math.sin(a) * t) / MAP_ASPECT, t };
}

// All of it at once: the six anchors and every item's place, grouped by area (newest first).
export function layoutBusiness(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const anchors = AREAS.map((a) => ({ area: a.id, label: a.label, color: AREA_COLORS[a.id], ...armPoint(a.id, 0.93) }));
  const byArea = new Map(AREAS.map((a) => [a.id, []]));
  for (const node of list) if (byArea.has(node.area)) byArea.get(node.area).push(node);
  const items = [];
  for (const [area, group] of byArea) {
    const sorted = [...group].sort((x, y) => Date.parse(y.updatedAt || 0) - Date.parse(x.updatedAt || 0) || (x.id < y.id ? -1 : 1));
    sorted.forEach((node, index) => items.push({ id: node.id, area, index, color: AREA_COLORS[area], ...itemPlace(node, index) }));
  }
  return { anchors, items };
}

// The item under the pointer (in CSS pixels, within `hit`), or null.
export function pickItem(points, px, py, hit = 14) {
  let best = null;
  let bestDist = hit;
  for (const p of points) {
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}
