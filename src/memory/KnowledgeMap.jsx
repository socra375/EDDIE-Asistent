import { useEffect, useMemo, useRef, useState } from 'react';
import { growth, hashString } from './orbMath.js';
import { CORE_RGB, MAP_ASPECT, MAP_SHAPES, bendPoint, bezierPoint, catchUp, chainOf, clampOffset, colorOf, followFactor, layoutMap, nodePoint, pickMapNode, shapeOf, shapeVertices, somaMesh, turnSoma } from './knowledgeMap.js';
import { KNOWLEDGE_CATEGORIES, categoryLabel } from '../services/knowledgeCategories.js';

const FRAME_MS = 33; // ~30 fps: the light has to run smoothly
const LITE_FRAME_MS = 100;
const BIRTH_MS = 1100;
const INTRO_STAGGER_MS = 90;
const INTRO_MAX_MS = 1600;
const RECALL_EVERY_S = 6; // every so often Eddie "recalls" a topic: a pulse goes out from the core
const RECALL_TRAVEL_S = 2.4;

// Only "reduce motion" freezes the map; Modo ligero drops the glow and halves the frames.
const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';
const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const NEUTRAL = { dark: '127,180,200', light: '70,85,105' };
const TWO_PI = Math.PI * 2;
const SOMA = somaMesh(30);

const hexRgb = (hex) => `${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)}`;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

export function CategorySelect({ value, onChange, label = 'Tipo' }) {
  return (
    <label className="knowledge-map__select">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {KNOWLEDGE_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// What Eddie learned drawn as a neuron: a glowing core (the brain), one arm of
// branches per kind of knowledge (coloured like the legend), and every topic a
// node on its arm with one tiny point per note circling it. Light runs along the
// branches toward the core (what is learned flowing in); every few seconds a
// brighter pulse goes out from the core to one topic (Eddie recalling it). While
// Eddie is learning something new the flow quickens and rings spread from the
// core. Point at a node to read it (its whole branch lights up); click to pin it.
// topics: [{ id, title, summary, kind, category, noteCount, sourceCount, createdAt, updatedAt }]
export default function KnowledgeMap({ topics, learning, selectedId, onSelect, onOpen, onCategory }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const handleRef = useRef(null);
  const layout = useMemo(() => layoutMap(topics), [topics]);
  const [hover, setHover] = useState(null); // { index, x, y }
  const [focus, setFocus] = useState(null); // category the legend isolates
  const [theme, setTheme] = useState(themeName);

  const live = useRef({
    layout,
    hoverIndex: -1,
    selectedId: null,
    focus: null,
    learning: false,
    points: [],
    born: new Map(),
    clock: 0,
    flow: 0,
    off: { x: 0, y: 0 }, // where the core is now (map units): dragging it moves the whole neuron
    offTarget: { x: 0, y: 0 },
    lag: [], // each node's own catching-up offset
    dragging: false,
    grab: { x: 0, y: 0 },
    spin: 0, // extra turn of the core ball while it is dragged
    handle: null,
    last: 0,
    t0: 0,
    par: { x: 0, y: 0, tx: 0, ty: 0 },
    size: { w: 0, h: 0, dpr: 1 },
    visible: true,
    shownAt: null, // when the map first came into view: the intro starts then, not at page load
    running: false,
    request: () => {},
  });

  // Keep the loop's view of the data current and time the birth of nodes it hasn't seen.
  useEffect(() => {
    const s = live.current;
    const now = performance.now();
    const calm = isCalm();
    const first = s.born.size === 0;
    const ids = new Set(layout.nodes.map((n) => n.id));
    layout.nodes.forEach((n, i) => {
      if (s.born.has(n.id)) return;
      // The first batch draws itself in one after another; later ones appear at once.
      s.born.set(n.id, calm ? { at: -Infinity, delay: 0 } : { at: now, delay: first ? Math.min(i * INTRO_STAGGER_MS, INTRO_MAX_MS) : 0 });
    });
    for (const id of [...s.born.keys()]) if (!ids.has(id)) s.born.delete(id);
    s.layout = layout;
    s.selectedId = selectedId;
    s.focus = focus;
    s.learning = Boolean(learning);
    s.request();
  }, [layout, selectedId, focus, learning]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const s = live.current;
    s.handle = handleRef.current;
    s.t0 = performance.now();
    // How far along a topic's birth is (0 → 1). It starts once the map has been seen.
    s.grown = (id, now) => {
      const b = s.born.get(id);
      if (!b) return 0;
      if (b.at === -Infinity) return 1;
      if (s.shownAt == null) return 0;
      return growth(now, Math.max(b.at, s.shownAt) + b.delay, BIRTH_MS);
    };

    function resize() {
      const w = wrap.clientWidth;
      if (!w) return;
      const h = Math.round(w / MAP_ASPECT);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.size = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      s.request();
    }

    const toScreen = (p, w, px = 0, py = 0) => ({ x: (p.x + 1) * (w / 2) + px, y: s.size.h / 2 + p.y * (w / 2) + py });
    const curve = (p, c, q, upTo = 1) => {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const steps = 18;
      for (let i = 1; i <= steps; i += 1) {
        const pt = bezierPoint(p, c, q, (upTo * i) / steps);
        ctx.lineTo(pt.x, pt.y);
      }
    };
    const dot = (x, y, r, fill) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TWO_PI);
      ctx.fill();
    };

    function draw(now) {
      const { w, h, dpr } = s.size;
      if (!w) return;
      const th = themeName();
      const dark = th === 'dark';
      const lite = isLite();
      const calm = isCalm();
      const neutral = NEUTRAL[th];
      const coreRgb = CORE_RGB[th];
      const t = s.clock;
      const fl = s.flow;
      const learning = s.learning;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { nodes, links, filaments, dust } = s.layout;
      const par = s.par;
      const unit = w / 2;
      const dim = (category) => (s.focus && s.focus !== category ? 0.14 : 1);
      const scale = Math.min(1.25, Math.max(0.8, w / 640));
      const P = (p, k) => toScreen(p, w, par.x * k, par.y * k);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      // 1. Specks of light in the dark (deepest layer: moves most with the pointer).
      for (const d of dust) {
        const q = P(d, 7);
        const a = calm ? 0.26 : 0.1 + 0.3 * (0.5 + 0.5 * Math.sin(t * d.rate + d.tw));
        ctx.fillStyle = `rgba(${neutral},${a * (s.focus ? 0.5 : 1)})`;
        ctx.fillRect(q.x - d.size / 2, q.y - d.size / 2, d.size, d.size);
      }

      // 2. Faint far dendrites with a small light running in along each.
      const off = s.off;
      const coreP = P(off, 3);
      for (const f of filaments) {
        const end = P({ x: off.x + Math.cos(f.angle) * f.length, y: off.y + (Math.sin(f.angle) * f.length) / MAP_ASPECT }, 7);
        const from = P(off, 7);
        const c = bendPoint(from, end, f.bend);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(${neutral},${s.focus ? 0.06 : 0.16})`;
        curve(from, c, end);
        ctx.stroke();
        if (!calm) {
          const u = (fl * f.flow.speed + f.flow.offset) % 1;
          const q = bezierPoint(from, c, end, 1 - u);
          dot(q.x, q.y, 1.5, `rgba(${neutral},${(s.focus ? 0.25 : 0.55) * Math.sin(u * Math.PI)})`);
        }
      }

      // 3. Where the nodes are now (they sway a little around their place on the branch).
      const here = nodes.map((n, i) => {
        const p = nodePoint(n, t);
        const lag = s.lag[i] || { x: 0, y: 0 };
        return P({ x: p.x + lag.x, y: p.y + lag.y }, 3.5);
      });
      s.points = here;
      const hotIndex = s.hoverIndex >= 0 ? s.hoverIndex : nodes.findIndex((n) => n.id === s.selectedId);
      const hotSet = hotIndex >= 0 ? new Set(chainOf(nodes, hotIndex).map((c) => c.from)) : null;
      const chains = nodes.map((_, i) =>
        chainOf(nodes, i).map(({ from, to, bend }) => {
          const p = to >= 0 ? here[to] : coreP;
          const q = here[from];
          return { p, q, c: bendPoint(p, q, bend), from };
        }),
      );
      const somaR = Math.min(w, h) * 0.085 * (calm ? 1 : 1 + 0.035 * Math.sin(fl * 1.7));

      // The invisible handle that lets the core be grabbed sits right on top of it.
      if (s.handle) {
        const size = somaR * 2.4;
        s.handle.style.width = `${size}px`;
        s.handle.style.height = `${size}px`;
        s.handle.style.transform = `translate(${coreP.x - size / 2}px, ${coreP.y - size / 2}px)`;
      }

      // 4. The glow of the core.
      {
        const reach = somaR * (learning || s.dragging ? 4.6 : 3.6);
        const g = ctx.createRadialGradient(coreP.x, coreP.y, somaR * 0.4, coreP.x, coreP.y, reach);
        g.addColorStop(0, `rgba(${coreRgb},${dark ? 0.4 : 0.2})`);
        g.addColorStop(1, `rgba(${coreRgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(coreP.x, coreP.y, reach, 0, TWO_PI);
        ctx.fill();
      }

      // 5. The branches (drawn out from the core when a topic is born).
      nodes.forEach((n, i) => {
        const g = s.grown(n.id, now);
        if (g <= 0) return;
        const seg = chains[i][0];
        const rgb = hexRgb(colorOf(n.category, th));
        const parentRgb = n.parent >= 0 ? hexRgb(colorOf(nodes[n.parent].category, th)) : coreRgb;
        const hot = hotSet ? hotSet.has(i) : false;
        const d = dim(n.category);
        const taper = Math.max(0.9, 1.7 - n.depth * 0.18);
        if (!lite) {
          ctx.lineWidth = taper * 3.2;
          ctx.strokeStyle = `rgba(${rgb},${(hot ? 0.2 : 0.06) * g * d})`;
          curve(seg.p, seg.c, seg.q, g);
          ctx.stroke();
        }
        const grad = ctx.createLinearGradient(seg.p.x, seg.p.y, seg.q.x, seg.q.y);
        const alpha = (hot ? 0.9 : 0.42) * g * d;
        grad.addColorStop(0, `rgba(${parentRgb},${alpha})`);
        grad.addColorStop(1, `rgba(${rgb},${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = taper + (hot ? 0.7 : 0);
        curve(seg.p, seg.c, seg.q, g);
        ctx.stroke();
        // Beads along the branch, like the swellings of a real dendrite.
        if (g >= 1) {
          n.beads.forEach((u, k) => {
            const b = bezierPoint(seg.p, seg.c, seg.q, u);
            const twinkle = calm ? 0.6 : 0.45 + 0.4 * Math.sin(fl * 1.3 + i + k * 2);
            dot(b.x, b.y, 1.5, `rgba(${rgb},${(hot ? 0.95 : twinkle) * d})`);
          });
        }
        // Twigs that end in a dot.
        if (!lite && g >= 1) {
          for (const tw of n.twigs) {
            const base = bezierPoint(seg.p, seg.c, seg.q, tw.u);
            const dir = Math.atan2(seg.q.y - seg.p.y, seg.q.x - seg.p.x) + tw.side * tw.tilt;
            const reachPx = tw.len * unit;
            const end = { x: base.x + Math.cos(dir) * reachPx, y: base.y + Math.sin(dir) * reachPx };
            ctx.lineWidth = 0.7;
            ctx.strokeStyle = `rgba(${rgb},${(hot ? 0.6 : 0.24) * d})`;
            ctx.beginPath();
            ctx.moveTo(base.x, base.y);
            ctx.quadraticCurveTo((base.x + end.x) / 2 - Math.sin(dir) * reachPx * 0.25, (base.y + end.y) / 2 + Math.cos(dir) * reachPx * 0.25, end.x, end.y);
            ctx.stroke();
            dot(end.x, end.y, 1.3, `rgba(${rgb},${(hot ? 0.9 : 0.5) * d})`);
          }
        }
      });

      // 6. Synapses between neighbouring kinds of knowledge.
      ctx.setLineDash([2, 4]);
      links.forEach(([i, j], k) => {
        const a = nodes[i];
        const b = nodes[j];
        const g = Math.min(s.grown(a.id, now), s.grown(b.id, now));
        if (g <= 0) return;
        const p = here[i];
        const q = here[j];
        const hot = hotIndex === i || hotIndex === j;
        const c = bendPoint(p, q, (((i + j + k) % 2) * 2 - 1) * 0.18);
        ctx.lineWidth = hot ? 1.2 : 0.7;
        ctx.strokeStyle = `rgba(${hexRgb(colorOf(a.category, th))},${(hot ? 0.7 : 0.16) * g * Math.min(dim(a.category), dim(b.category))})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(c.x, c.y, q.x, q.y);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // 7. The flow: light running along every branch, in toward the core.
      const onChain = (chain, sigma) => {
        const k = Math.min(chain.length - 1, Math.floor(sigma));
        const u = sigma - k;
        const seg = chain[k];
        return bezierPoint(seg.p, seg.c, seg.q, 1 - u); // chains start at the node, so u runs from the node toward its parent
      };
      if (!calm) {
        ctx.globalCompositeOperation = dark && !lite ? 'lighter' : 'source-over';
        nodes.forEach((n, i) => {
          if (s.grown(n.id, now) < 1) return;
          const chain = chains[i];
          const m = chain.length;
          const rgb = hexRgb(colorOf(n.category, th));
          const d = dim(n.category);
          const count = (lite ? 1 : 2) + (learning && !lite ? 1 : 0);
          const speed = (0.3 + n.flow.speed * 1.4) * (learning ? 2.5 : 1);
          for (let k = 0; k < count; k += 1) {
            const sigma = (fl * speed + (n.flow.offset + k / count) * m) % m;
            for (let tail = 0; tail < 5; tail += 1) {
              const at = sigma - tail * 0.05;
              if (at < 0) break;
              const q = onChain(chain, at);
              const a = (0.95 - tail * 0.18) * d * (learning ? 1 : 0.8);
              if (tail === 0) {
                dot(q.x, q.y, 5.2, `rgba(${rgb},${0.24 * d})`);
                dot(q.x, q.y, 2.2, `rgba(255,255,255,${0.9 * d})`);
              } else {
                dot(q.x, q.y, 1.7 - tail * 0.25, `rgba(${rgb},${a})`);
              }
            }
          }
        });
        // Eddie recalls a topic: a brighter pulse leaves the core and ends in a ring on the node.
        if (nodes.length) {
          const slot = Math.floor(fl / RECALL_EVERY_S);
          const idx = hashString(`r${slot}`) % nodes.length;
          const local = (fl % RECALL_EVERY_S) / RECALL_TRAVEL_S;
          const n = nodes[idx];
          if (local < 1.4 && s.grown(n.id, now) >= 1 && dim(n.category) === 1) {
            const chain = chains[idx];
            const m = chain.length;
            const rgb = hexRgb(colorOf(n.category, th));
            if (local < 1) {
              for (let tail = 0; tail < 9; tail += 1) {
                const at = (1 - Math.max(0, local - tail * 0.018)) * m;
                const q = onChain(chain, Math.min(m - 1e-6, at));
                dot(q.x, q.y, tail === 0 ? 3.4 : 2.6 - tail * 0.22, tail === 0 ? 'rgba(255,255,255,0.95)' : `rgba(${rgb},${0.85 - tail * 0.09})`);
              }
            }
            if (local > 0.95) {
              const u = Math.min(1, (local - 0.95) / 0.45);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = `rgba(${rgb},${(1 - u) * 0.9})`;
              ctx.beginPath();
              ctx.arc(here[idx].x, here[idx].y, n.size * scale + 4 + u * 22, 0, TWO_PI);
              ctx.stroke();
            }
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // 8. The core: a mesh ball turning slowly, with rings spreading from it while Eddie learns.
      {
        const pts = turnSoma(SOMA.points, calm ? 0.6 + s.spin : fl * (learning ? 0.8 : 0.28) + s.spin);
        ctx.fillStyle = `rgba(${coreRgb},0.1)`;
        ctx.beginPath();
        ctx.arc(coreP.x, coreP.y, somaR, 0, TWO_PI);
        ctx.fill();
        ctx.lineWidth = 0.8;
        for (const [i, j] of SOMA.edges) {
          const depth = (pts[i].z + pts[j].z) / 2;
          ctx.strokeStyle = `rgba(${coreRgb},${0.16 + 0.5 * ((depth + 1) / 2)})`;
          ctx.beginPath();
          ctx.moveTo(coreP.x + pts[i].x * somaR, coreP.y + pts[i].y * somaR);
          ctx.lineTo(coreP.x + pts[j].x * somaR, coreP.y + pts[j].y * somaR);
          ctx.stroke();
        }
        for (const p of pts) dot(coreP.x + p.x * somaR, coreP.y + p.y * somaR, 0.9 + 1.3 * ((p.z + 1) / 2), `rgba(${coreRgb},${0.45 + 0.5 * ((p.z + 1) / 2)})`);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(${coreRgb},0.5)`;
        ctx.beginPath();
        ctx.arc(coreP.x, coreP.y, somaR * 1.06, 0, TWO_PI);
        ctx.stroke();
        if (learning) {
          for (let k = 0; k < 3; k += 1) {
            const u = calm ? 0.4 + k * 0.2 : (fl / 2.4 + k / 3) % 1;
            ctx.strokeStyle = `rgba(${coreRgb},${(1 - u) * 0.7})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(coreP.x, coreP.y, somaR * 1.2 + u * Math.min(w, h) * 0.38, 0, TWO_PI);
            ctx.stroke();
          }
        }
      }

      // 9. The nodes: every kind of knowledge has its own shape; a skill wears a toothed ring, a topic an
      // orbiting bead; one arc segment per note; a small chip per source; recent ones glow brighter.
      const nowMs = Date.now();
      const labels = [];
      const bracket = (x, y, sx, sy, len) => {
        ctx.beginPath();
        ctx.moveTo(x + sx * len, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * len);
        ctx.stroke();
      };
      const trace = (shape, x, y, r, rot = 0) => {
        ctx.beginPath();
        if (shape === 'circle' || shape === 'ring') {
          ctx.arc(x, y, r, 0, TWO_PI);
          return;
        }
        shapeVertices(shape, r, rot).forEach((v, k) => (k ? ctx.lineTo(x + v.x, y + v.y) : ctx.moveTo(x + v.x, y + v.y)));
        ctx.closePath();
      };
      nodes.forEach((n, i) => {
        const g = s.grown(n.id, now);
        if (g <= 0) return;
        const q = here[i];
        const rgb = hexRgb(colorOf(n.category, th));
        const d = dim(n.category);
        const hot = s.hoverIndex === i || s.selectedId === n.id;
        const shape = shapeOf(n.category);
        const fresh = nowMs - n.updated < 36 * 3600 * 1000;
        const r = (n.size + (hot ? 2 : 0)) * g * (g < 1 ? 1 + 0.25 * Math.sin(g * Math.PI) : 1) * scale * 0.95;
        const dir = n.speed > 0 ? 1 : -1;
        const spin = calm ? 0 : fl * 0.5 * dir;
        ctx.lineJoin = 'round';

        // The aura (a recent topic glows more and breathes).
        if (dark && !lite) {
          const breathe = fresh && !calm ? 0.8 + 0.2 * Math.sin(fl * 2.2 + i) : 1;
          const gr = ctx.createRadialGradient(q.x, q.y, r * 0.4, q.x, q.y, r * (fresh ? 3.4 : 2.6));
          gr.addColorStop(0, `rgba(${rgb},${(hot ? 0.55 : fresh ? 0.42 : 0.24) * d * breathe})`);
          gr.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = gr;
          ctx.beginPath();
          ctx.arc(q.x, q.y, r * (fresh ? 3.4 : 2.6), 0, TWO_PI);
          ctx.fill();
        }
        // A slow pulse going out.
        if (!calm && g >= 1) {
          const u = ((t + n.pulse.offset) % n.pulse.period) / n.pulse.period;
          if (u < 0.55) {
            ctx.strokeStyle = `rgba(${rgb},${(1 - u / 0.55) * 0.4 * d})`;
            ctx.lineWidth = 1;
            trace(shape === 'ring' ? 'circle' : shape, q.x, q.y, r * 1.9 + (u / 0.55) * 18, 0);
            ctx.stroke();
          }
        }

        // One arc segment per note; a light runs around them.
        if (n.notes) {
          const seg = TWO_PI / n.notes;
          const gap = Math.min(0.2, seg * 0.32);
          ctx.lineWidth = 2.2;
          ctx.lineCap = 'butt';
          for (let k = 0; k < n.notes; k += 1) {
            const lit = calm ? 0.6 : 0.5 + 0.5 * Math.cos((k * TWO_PI) / n.notes - fl * 1.8 * dir);
            ctx.strokeStyle = `rgba(${rgb},${(0.28 + 0.62 * lit) * g * d})`;
            const a0 = -Math.PI / 2 + k * seg + gap / 2;
            ctx.beginPath();
            ctx.arc(q.x, q.y, r * 1.58, a0, a0 + seg - gap);
            ctx.stroke();
          }
          ctx.lineCap = 'round';
        }

        // A skill wears a ring of teeth that turns; a topic has a bead circling its own orbit.
        if (g >= 1) {
          if (n.kind === 'habilidad') {
            ctx.fillStyle = `rgba(${rgb},${0.55 * d})`;
            for (let k = 0; k < 10; k += 1) {
              const a = (k * TWO_PI) / 10 + spin * 0.6;
              const r1 = r * 1.82;
              const r2 = r * 2.04;
              ctx.beginPath();
              ctx.moveTo(q.x + Math.cos(a - 0.085) * r1, q.y + Math.sin(a - 0.085) * r1);
              ctx.lineTo(q.x + Math.cos(a - 0.05) * r2, q.y + Math.sin(a - 0.05) * r2);
              ctx.lineTo(q.x + Math.cos(a + 0.05) * r2, q.y + Math.sin(a + 0.05) * r2);
              ctx.lineTo(q.x + Math.cos(a + 0.085) * r1, q.y + Math.sin(a + 0.085) * r1);
              ctx.closePath();
              ctx.fill();
            }
          } else {
            ctx.setLineDash([2, 5]);
            ctx.lineWidth = 0.8;
            ctx.strokeStyle = `rgba(${rgb},${0.3 * d})`;
            ctx.beginPath();
            ctx.arc(q.x, q.y, r * 1.95, 0, TWO_PI);
            ctx.stroke();
            ctx.setLineDash([]);
            const ba = n.phase + (calm ? 0 : fl * 0.8 * dir);
            dot(q.x + Math.cos(ba) * r * 1.95, q.y + Math.sin(ba) * r * 1.95, 2.3, `rgba(${rgb},${0.95 * d})`);
          }
          // One small chip per source, along the top.
          for (let k = 0; k < n.sources; k += 1) {
            const a = -Math.PI / 2 + (k - (n.sources - 1) / 2) * 0.3;
            const cx = q.x + Math.cos(a) * r * 2.3;
            const cy = q.y + Math.sin(a) * r * 2.3;
            ctx.fillStyle = `rgba(${rgb},${0.8 * d})`;
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(a + Math.PI / 4);
            ctx.fillRect(-1.6, -1.6, 3.2, 3.2);
            ctx.restore();
          }
        }

        // The body: faceted, with a highlight, in the shape of its kind.
        ctx.globalAlpha = d;
        const bodyRot = shape === 'spark' && !calm ? fl * 0.25 * dir : 0;
        const bg = ctx.createRadialGradient(q.x - r * 0.35, q.y - r * 0.35, r * 0.08, q.x, q.y, r * 1.1);
        bg.addColorStop(0, dark ? `rgba(${rgb},0.6)` : 'rgba(255,255,255,0.98)');
        bg.addColorStop(0.55, dark ? 'rgba(8,16,28,0.94)' : 'rgba(236,246,250,0.92)');
        bg.addColorStop(1, `rgba(${rgb},0.28)`);
        ctx.fillStyle = bg;
        trace(shape, q.x, q.y, r, bodyRot);
        ctx.fill();
        ctx.lineWidth = n.kind === 'habilidad' ? 2.2 : 1.6;
        ctx.strokeStyle = `rgba(${rgb},0.96)`;
        ctx.stroke();
        // The inner shape, turned half a step, and facet lines to its corners.
        const inner = shape === 'spark' ? 'circle' : shape === 'ring' ? 'circle' : shape;
        const innerR = r * (shape === 'ring' ? 0.7 : 0.6);
        const sides = shapeVertices(inner, 1).length || 0;
        const innerRot = (sides ? Math.PI / sides : 0) + bodyRot;
        trace(inner, q.x, q.y, innerR, innerRot);
        ctx.fillStyle = `rgba(${rgb},0.16)`;
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${rgb},0.55)`;
        ctx.stroke();
        if (!lite) {
          ctx.lineWidth = 0.7;
          ctx.strokeStyle = `rgba(${rgb},0.38)`;
          const corners = sides ? shapeVertices(inner, innerR, innerRot) : Array.from({ length: 3 }, (_, k) => ({ x: Math.cos(spin + (k * TWO_PI) / 3) * innerR, y: Math.sin(spin + (k * TWO_PI) / 3) * innerR }));
          corners.forEach((v, k) => {
            if (sides >= 5 && k % 2) return;
            ctx.beginPath();
            ctx.moveTo(q.x, q.y);
            ctx.lineTo(q.x + v.x, q.y + v.y);
            ctx.stroke();
          });
          if (shape === 'ring') {
            ctx.setLineDash([1.5, 3]);
            ctx.strokeStyle = `rgba(${rgb},0.7)`;
            ctx.beginPath();
            ctx.arc(q.x, q.y, r * 0.84, spin, spin + TWO_PI);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        // The nucleus with a spark of light.
        dot(q.x, q.y, Math.max(1.8, r * 0.26), `rgba(${rgb},1)`);
        if (!lite) dot(q.x - r * 0.1, q.y - r * 0.1, Math.max(0.8, r * 0.09), 'rgba(255,255,255,0.85)');
        ctx.globalAlpha = 1;

        // Pointed at or pinned: a targeting frame around it.
        if (hot) {
          const f = r * 2.5;
          const len = 6 + r * 0.25;
          ctx.lineWidth = 1.3;
          ctx.strokeStyle = dark ? 'rgba(255,255,255,0.92)' : 'rgba(20,30,45,0.88)';
          bracket(q.x - f * 0.78, q.y - f * 0.78, 1, 1, len);
          bracket(q.x + f * 0.78, q.y - f * 0.78, -1, 1, len);
          bracket(q.x - f * 0.78, q.y + f * 0.78, 1, -1, len);
          bracket(q.x + f * 0.78, q.y + f * 0.78, -1, -1, len);
        }

        // The name goes in a later pass, so labels can avoid one another.
        if (g >= 1 && n.title) labels.push({ n, q, r, d, hot, rgb });

        if (g < 1) {
          // Birth burst.
          ctx.strokeStyle = `rgba(${rgb},${(1 - g) * 0.9})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 6 + (1 - g) * 60, 0, TWO_PI);
          ctx.stroke();
        }
      });

      // The names: the one pointed at first, then the nearest to the core and the richest in notes. A name that
      // would land on another one (or on a node) is left out, so the map never turns into a pile of text.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const taken = nodes.map((_, i) => ({ x: here[i].x - 14, y: here[i].y - 14, w: 28, h: 28 }));
      labels
        .sort((a, b) => Number(b.hot) - Number(a.hot) || a.n.depth - b.n.depth || b.n.notes - a.n.notes)
        .forEach(({ n, q, r, d, hot }) => {
          ctx.font = `${hot ? 600 : 500} ${Math.round(10 * scale)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
          const text = clip(n.title, hot ? 42 : 20).toUpperCase();
          const width = ctx.measureText(text).width;
          const ty = q.y + r * 2.45 + 4;
          const box = { x: q.x - width / 2 - 3, y: ty - 2, w: width + 6, h: 14 * scale };
          const clash = taken.some((o) => box.x < o.x + o.w && box.x + box.w > o.x && box.y < o.y + o.h && box.y + box.h > o.y);
          if (clash && !hot) return;
          taken.push(box);
          ctx.lineWidth = 3;
          ctx.strokeStyle = dark ? `rgba(2,6,14,${0.85 * d})` : `rgba(255,255,255,${0.85 * d})`;
          ctx.strokeText(text, q.x, ty);
          ctx.fillStyle = dark ? `rgba(225,240,250,${(hot ? 1 : 0.74) * d})` : `rgba(20,30,45,${(hot ? 1 : 0.74) * d})`;
          ctx.fillText(text, q.x, ty);
        });
    }

    // The core goes where it is dragged; every node follows it, the far ones a little later.
    function step(dt) {
      const k = s.dragging ? 0.6 : 0.16;
      s.off.x = catchUp(s.off.x, s.offTarget.x, k, dt);
      s.off.y = catchUp(s.off.y, s.offTarget.y, k, dt);
      s.layout.nodes.forEach((n, i) => {
        const lag = s.lag[i] || (s.lag[i] = { x: s.off.x, y: s.off.y });
        lag.x = catchUp(lag.x, s.off.x, followFactor(n.depth), dt);
        lag.y = catchUp(lag.y, s.off.y, followFactor(n.depth), dt);
      });
      s.lag.length = s.layout.nodes.length;
      s.spin *= 0.94 ** (dt * 60);
    }
    const settling = () =>
      Math.abs(s.offTarget.x - s.off.x) > 0.0008 ||
      Math.abs(s.offTarget.y - s.off.y) > 0.0008 ||
      s.layout.nodes.some((_, i) => s.lag[i] && (Math.abs(s.lag[i].x - s.off.x) > 0.0008 || Math.abs(s.lag[i].y - s.off.y) > 0.0008)) ||
      s.spin > 0.002;

    function frame(now) {
      s.running = false;
      const calm = isCalm();
      const moving = !calm && s.visible && !document.hidden;
      const growing = [...s.born.keys()].some((id) => s.grown(id, now) < 1);
      const easing = Math.abs(s.par.tx - s.par.x) > 0.002 || Math.abs(s.par.ty - s.par.y) > 0.002;
      const animating = moving || settling();
      if (now - s.last >= (isLite() ? LITE_FRAME_MS : FRAME_MS) || !animating) {
        const dt = Math.min((now - (s.last || now)) / 1000, 0.2);
        // The nodes stand still while one is being read; the light keeps running.
        if (animating) s.flow += dt;
        if (animating && s.hoverIndex < 0) s.clock += dt;
        // The parallax eases toward the pointer and then stops for good (no endless sub-pixel redraws).
        s.par.x = Math.abs(s.par.tx - s.par.x) < 0.002 ? s.par.tx : s.par.x + (s.par.tx - s.par.x) * 0.12;
        s.par.y = Math.abs(s.par.ty - s.par.y) < 0.002 ? s.par.ty : s.par.y + (s.par.ty - s.par.y) * 0.12;
        s.last = now;
        step(dt);
        draw(now);
      }
      if ((animating || growing || easing) && s.visible) request();
    }

    function request() {
      if (s.running) return;
      s.running = true;
      requestAnimationFrame(frame);
    }
    s.request = request;

    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    const seen = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      if (s.visible) {
        if (s.shownAt == null) s.shownAt = performance.now();
        request();
      }
    });
    seen.observe(wrap);
    // A theme or Modo ligero change redraws at once.
    const mode = new MutationObserver(() => {
      setTheme(themeName());
      request();
    });
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-perf', 'data-theme'] });
    const onVisibility = () => !document.hidden && request();
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    request();

    return () => {
      observer.disconnect();
      seen.disconnect();
      mode.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      s.request = () => {};
      s.running = true; // a frame already queued does nothing more
    };
  }, []);

  const local = (event) => {
    const box = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width };
  };
  const tipPlace = (point, width) => ({ x: Math.max(110, Math.min(width - 110, point.x)), y: point.y });

  function onPointerMove(event) {
    const s = live.current;
    const p = local(event);
    s.par.tx = (p.x / p.width - 0.5) * 2;
    s.par.ty = (p.y / (p.width / MAP_ASPECT) - 0.5) * 2;
    const index = pickMapNode(s.points, p.x, p.y, 18);
    if (index !== s.hoverIndex) {
      s.hoverIndex = index;
      setHover(index < 0 ? null : { index, ...tipPlace(s.points[index], p.width) });
    }
    s.request();
  }

  function onPointerUp(event) {
    const s = live.current;
    const p = local(event);
    const index = pickMapNode(s.points, p.x, p.y, 20);
    const id = index < 0 ? null : s.layout.nodes[index].id;
    onSelect(id === selectedId ? null : id);
    if (index >= 0) {
      s.hoverIndex = index;
      setHover({ index, ...tipPlace(s.points[index], p.width) });
    }
    s.request();
  }

  // The core can be grabbed and dragged: the whole neuron goes with it (see step() in the loop).
  const toMap = (event) => {
    const box = canvasRef.current.getBoundingClientRect();
    return { x: ((event.clientX - box.left) / box.width) * 2 - 1, y: (event.clientY - box.top - box.height / 2) / (box.width / 2) };
  };

  function onCoreDown(event) {
    const s = live.current;
    const m = toMap(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    s.grab = { x: m.x - s.offTarget.x, y: m.y - s.offTarget.y };
    s.dragging = true;
    s.hoverIndex = -1;
    setHover(null);
    s.request();
  }

  function onCoreMove(event) {
    const s = live.current;
    if (!s.dragging) return;
    const m = toMap(event);
    const next = clampOffset(m.x - s.grab.x, m.y - s.grab.y);
    s.spin += Math.hypot(next.x - s.offTarget.x, next.y - s.offTarget.y) * 9;
    s.offTarget = next;
    s.request();
  }

  function onCoreUp(event) {
    const s = live.current;
    s.dragging = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    s.request();
  }

  function recenter() {
    const s = live.current;
    s.offTarget = { x: 0, y: 0 };
    s.request();
  }

  function onCoreKey(event) {
    const s = live.current;
    const step = 0.04;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (move) {
      event.preventDefault();
      s.offTarget = clampOffset(s.offTarget.x + move[0], s.offTarget.y + move[1]);
      s.spin += step * 9;
      s.request();
    } else if (event.key === 'Home' || event.key === 'Escape') {
      event.preventDefault();
      recenter();
    }
  }

  function onPointerLeave() {
    const s = live.current;
    s.hoverIndex = -1;
    s.par.tx = 0;
    s.par.ty = 0;
    setHover(null);
    s.request();
  }

  const byId = useMemo(() => new Map(topics.map((tp) => [tp.id, tp])), [topics]);
  const hovered = hover ? byId.get(layout.nodes[hover.index]?.id) : null;
  const selected = selectedId ? byId.get(selectedId) : null;
  const counts = useMemo(() => {
    const out = {};
    for (const tp of topics) out[tp.category] = (out[tp.category] || 0) + 1;
    return out;
  }, [topics]);

  return (
    <section className="glass-panel knowledge-map" aria-label="Mapa del segundo cerebro">
      <header className="memory-card__head">
        <h3>Mapa del segundo cerebro</h3>
        <span className="chip">
          {topics.length} {topics.length === 1 ? 'tema' : 'temas'}
        </span>
      </header>

      <div className="knowledge-map__stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="knowledge-map__canvas"
          role="img"
          aria-label={`Mapa en forma de neurona con ${topics.length} temas aprendidos, agrupados por tipo de conocimiento.`}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerLeave}
          onPointerLeave={onPointerLeave}
        />
        <button
          type="button"
          ref={handleRef}
          className="knowledge-map__core"
          aria-label="Núcleo del segundo cerebro: arrástralo para mover toda la neurona, o usa las flechas; doble clic o la tecla Inicio lo vuelve a centrar"
          onPointerDown={onCoreDown}
          onPointerMove={onCoreMove}
          onPointerUp={onCoreUp}
          onPointerCancel={onCoreUp}
          onDoubleClick={recenter}
          onKeyDown={onCoreKey}
        />
        {learning ? (
          <p className="knowledge-map__learning" role="status">
            Aprendiendo «{clip(learning, 60)}»…
          </p>
        ) : (
          topics.length === 0 && <p className="knowledge-map__empty">Todavía no aprendí nada. Dime «Investiga y aprende…» y cada tema crecerá aquí como una rama de la neurona.</p>
        )}
        {hovered && (
          <div className="knowledge-map__tip" style={{ left: hover.x, top: hover.y }} role="status">
            <span style={{ color: colorOf(hovered.category, theme) }}>{categoryLabel(hovered.category)}</span>
            <b>{hovered.title}</b>
            <p>
              {hovered.kind === 'habilidad' ? 'Habilidad' : 'Tema'} · {hovered.noteCount} nota{hovered.noteCount === 1 ? '' : 's'} · {hovered.sourceCount} fuente{hovered.sourceCount === 1 ? '' : 's'}
            </p>
          </div>
        )}
      </div>

      <ul className="knowledge-map__legend" aria-label="Tipos de conocimiento">
        {KNOWLEDGE_CATEGORIES.filter((c) => counts[c.id]).map((c) => (
          <li key={c.id}>
            <button type="button" className={`memory-orb__key ${focus === c.id ? 'memory-orb__key--on' : ''}`} aria-pressed={focus === c.id} onClick={() => setFocus(focus === c.id ? null : c.id)}>
              <i style={{ background: colorOf(c.id, theme), color: colorOf(c.id, theme) }} data-shape={MAP_SHAPES[c.id]} aria-hidden="true" />
              {c.label} · {counts[c.id]}
            </button>
          </li>
        ))}
      </ul>

      {selected ? (
        <div className="memory-orb__detail knowledge-map__detail">
          <span style={{ color: colorOf(selected.category, theme) }}>
            {categoryLabel(selected.category)} · {selected.kind === 'habilidad' ? 'Habilidad' : 'Tema'} · {fmtDate(selected.updatedAt)}
          </span>
          <strong>{selected.title}</strong>
          <p>{selected.summary}</p>
          <p className="knowledge-map__facts">
            {selected.noteCount} nota{selected.noteCount === 1 ? '' : 's'} de {selected.sourceCount} fuente{selected.sourceCount === 1 ? '' : 's'}
          </p>
          <div className="memory-orb__detail-actions">
            <CategorySelect value={selected.category} onChange={(category) => onCategory(selected, category)} />
            {onOpen && (
              <button type="button" className="btn btn-primary" onClick={() => onOpen(selected)}>
                Ver las notas
              </button>
            )}
            <button type="button" className="btn" onClick={() => onSelect(null)}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <p className="memory-orb__hint">Cada rama es un tipo de conocimiento y la luz que corre hacia el núcleo es lo aprendido llegando. Pasa el mouse sobre un nodo para ver qué aprendí (se ilumina su rama) y haz clic para abrirlo. Cada punto pequeño es una nota. Arrastra el núcleo para mover toda la neurona; con doble clic vuelve al centro.</p>
      )}
    </section>
  );
}
