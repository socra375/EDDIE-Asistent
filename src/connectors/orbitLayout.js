// Pure layout of the connector orbit (no React, so it can be tested in Node).
const INNER_MAX = 8;

// Evenly spaced angles (degrees, 0 = top) for `count` nodes.
function angles(count, offset = 0) {
  return Array.from({ length: count }, (_, i) => offset + (360 / count) * i);
}

// Splits the nodes between an inner and an outer ring.
export function layoutRings(nodes) {
  const inner = nodes.length <= INNER_MAX ? nodes.length : INNER_MAX;
  const outer = nodes.length - inner;
  const innerAngles = angles(inner, outer ? 360 / inner / 2 : 0);
  const outerAngles = angles(outer);
  return nodes.map((node, i) => (i < inner ? { node, ring: 'inner', angle: innerAngles[i], order: i } : { node, ring: 'outer', angle: outerAngles[i - inner], order: i }));
}
