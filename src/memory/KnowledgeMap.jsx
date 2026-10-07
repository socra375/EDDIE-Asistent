import { useEffect, useMemo, useRef, useState } from 'react';
import { growth } from './orbMath.js';
import { MAP_ASPECT, colorOf, ellipseLength, layoutMap, nodePoint, pickMapNode, trailPoints } from './knowledgeMap.js';
import { KNOWLEDGE_CATEGORIES, categoryLabel } from '../services/knowledgeCategories.js';

const FRAME_MS = 50; // ~20 fps: it is decoration
const LITE_FRAME_MS = 100;
const BIRTH_MS = 1100;
const INTRO_STAGGER_MS = 90;
const INTRO_MAX_MS = 1600;

// Only "reduce motion" freezes the map; Modo ligero just halves the frames.
const isCalm = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLite = () => document.documentElement.dataset.perf === 'lite';
const themeName = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
const NEUTRAL = { dark: '127,180,200', light: '70,85,105' };
const TWO_PI = Math.PI * 2;

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

// What Eddie learned as a star chart of orbits: every topic is a ringed node
// drifting along its own ellipse with one small point per note trailing behind
// it, coloured by the kind of knowledge (empresarial, cotidiana, personal,
// única…). While Eddie is learning something new a signal pulses from the
// middle until the new orbit is drawn in. Point at a node to read it; click to
// pin it.
// topics: [{ id, title, summary, kind, category, noteCount, sourceCount, updatedAt }]
export default function KnowledgeMap({ topics, learning, selectedId, onSelect, onOpen, onCategory }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
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

    const ellipsePath = (e, w, from = 0, to = TWO_PI, px = 0, py = 0) => {
      ctx.beginPath();
      ctx.ellipse((e.cx + 1) * (w / 2) + px, s.size.h / 2 + e.cy * (w / 2) + py, e.rx * (w / 2), e.ry * (w / 2), e.rot, from, to);
    };
    const toScreen = (p, w, px = 0, py = 0) => ({ x: (p.x + 1) * (w / 2) + px, y: s.size.h / 2 + p.y * (w / 2) + py });

    function draw(now) {
      const { w, h, dpr } = s.size;
      if (!w) return;
      const th = themeName();
      const neutral = NEUTRAL[th];
      const calm = isCalm();
      const t = s.clock;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const { nodes, links, decor } = s.layout;
      const par = s.par;
      const dim = (category) => (s.focus && s.focus !== category ? 0.14 : 1);
      ctx.lineCap = 'round';

      // 1. The long faint sweeps between (deepest layer: moves most with the pointer).
      for (const d of decor) {
        const rgb = d.category ? hexRgb(colorOf(d.category, th)) : neutral;
        const k = d.category ? dim(d.category) : s.focus ? 0.3 : 1;
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = `rgba(${rgb},${0.17 * k})`;
        ellipsePath(d.orbit, w, d.start, d.start + d.sweep, par.x * 7, par.y * 7);
        ctx.stroke();
        ctx.fillStyle = `rgba(${rgb},${0.4 * k})`;
        for (let i = 0; i <= d.ticks; i += 1) {
          const q = toScreen(pointOn(d.orbit, d.start + (d.sweep * i) / d.ticks), w, par.x * 7, par.y * 7);
          ctx.fillRect(q.x - 0.9, q.y - 0.9, 1.8, 1.8);
        }
        if (d.marker) {
          const end = toScreen(pointOn(d.orbit, d.start + d.sweep), w, par.x * 7, par.y * 7);
          ctx.strokeStyle = `rgba(${rgb},${0.45 * k})`;
          ctx.beginPath();
          ctx.arc(end.x, end.y, 4.5, 0, TWO_PI);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(end.x, end.y, 1.6, 0, TWO_PI);
          ctx.fillStyle = `rgba(${rgb},${0.6 * k})`;
          ctx.fill();
        }
        // A small comet runs along the arc.
        if (!calm) {
          const u = (t * d.comet.speed + d.comet.offset) % 1;
          for (let tail = 0; tail < 4; tail += 1) {
            const q = toScreen(pointOn(d.orbit, d.start + d.sweep * Math.max(0, u - tail * 0.012)), w, par.x * 7, par.y * 7);
            ctx.fillStyle = `rgba(${rgb},${(0.85 - tail * 0.2) * k})`;
            ctx.beginPath();
            ctx.arc(q.x, q.y, 1.9 - tail * 0.35, 0, TWO_PI);
            ctx.fill();
          }
        }
      }

      // 2. The orbit of each topic (drawn in when it is born).
      nodes.forEach((n) => {
        const g = s.grown(n.id, now);
        if (g <= 0) return;
        const rgb = hexRgb(colorOf(n.category, th));
        const hot = s.selectedId === n.id;
        ctx.lineWidth = hot ? 1.3 : 0.9;
        ctx.strokeStyle = `rgba(${rgb},${(hot ? 0.7 : 0.26) * dim(n.category)})`;
        if (g < 1) {
          const len = ellipseLength(n.orbit) * (w / 2);
          ctx.setLineDash([len * g, len]);
        }
        ellipsePath(n.orbit, w, 0, TWO_PI, par.x * 3.5, par.y * 3.5);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // 3. Where the nodes are now.
      const here = nodes.map((n) => toScreen(nodePoint(n, t), w, par.x * 3.5, par.y * 3.5));
      s.points = here;

      // 4. Curved links between neighbours.
      links.forEach(([i, j], k) => {
        const a = nodes[i];
        const b = nodes[j];
        const g = Math.min(s.grown(a.id, now), s.grown(b.id, now));
        if (g <= 0) return;
        const p = here[i];
        const q = here[j];
        const bend = (((i + j + k) % 2) * 2 - 1) * 0.2;
        const cx = (p.x + q.x) / 2 - (q.y - p.y) * bend;
        const cy = (p.y + q.y) / 2 + (q.x - p.x) * bend;
        const hot = s.hoverIndex === i || s.hoverIndex === j;
        const grad = ctx.createLinearGradient(p.x, p.y, q.x, q.y);
        const alpha = (hot ? 0.8 : 0.3) * g * Math.min(dim(a.category), dim(b.category));
        grad.addColorStop(0, `rgba(${hexRgb(colorOf(a.category, th))},${alpha})`);
        grad.addColorStop(1, `rgba(${hexRgb(colorOf(b.category, th))},${alpha})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = hot ? 1.3 : 0.8;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.quadraticCurveTo(cx, cy, q.x, q.y);
        ctx.stroke();
      });

      // 5. The notes: one small point per note strung out behind each node.
      nodes.forEach((n) => {
        const g = s.grown(n.id, now);
        if (g <= 0) return;
        const rgb = hexRgb(colorOf(n.category, th));
        const pts = trailPoints(n, t);
        pts.forEach((pt, k) => {
          const q = toScreen(pt, w, par.x * 3.5, par.y * 3.5);
          const fade = 1 - k / (pts.length + 2);
          ctx.fillStyle = `rgba(${rgb},${(0.35 + fade * 0.55) * g * dim(n.category)})`;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1 + fade * 1.4, 0, TWO_PI);
          ctx.fill();
        });
      });

      // 6. The nodes: two rings and a core, with a slow pulse going out.
      nodes.forEach((n, i) => {
        const g = s.grown(n.id, now);
        if (g <= 0) return;
        const q = here[i];
        const rgb = hexRgb(colorOf(n.category, th));
        const d = dim(n.category);
        const hot = s.hoverIndex === i || s.selectedId === n.id;
        const r = (n.size + (hot ? 2 : 0)) * g * Math.min(1.25, Math.max(0.8, w / 640));
        if (!calm && g >= 1) {
          const u = ((t + n.pulse.offset) % n.pulse.period) / n.pulse.period;
          if (u < 0.55) {
            ctx.strokeStyle = `rgba(${rgb},${(1 - u / 0.55) * 0.5 * d})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(q.x, q.y, r + (u / 0.55) * 26, 0, TWO_PI);
            ctx.stroke();
          }
        }
        ctx.lineWidth = n.kind === 'habilidad' ? 2 : 1.4;
        ctx.strokeStyle = `rgba(${rgb},${0.95 * d})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, TWO_PI);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = `rgba(${rgb},${0.55 * d})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 0.68, 0, TWO_PI);
        ctx.stroke();
        ctx.fillStyle = `rgba(${rgb},${0.18 * d})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 0.68, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = `rgba(${rgb},${d})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(1.8, r * 0.3), 0, TWO_PI);
        ctx.fill();
        if (hot) {
          ctx.strokeStyle = th === 'light' ? 'rgba(20,30,45,0.85)' : 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(q.x, q.y, r + 5, 0, TWO_PI);
          ctx.stroke();
        }
        if (g < 1) {
          // Birth burst.
          ctx.strokeStyle = `rgba(${rgb},${(1 - g) * 0.9})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 6 + (1 - g) * 60, 0, TWO_PI);
          ctx.stroke();
        }
      });

      // 7. Eddie is learning something: a signal pulses from the middle.
      if (s.learning) {
        const c = { x: w / 2 + par.x * 3.5, y: h / 2 + par.y * 3.5 };
        const rgb = th === 'light' ? '0,127,153' : '63,232,255';
        const clock = now / 1000;
        for (let k = 0; k < 3; k += 1) {
          const u = calm ? 0.4 + k * 0.2 : ((clock / 2.4 + k / 3) % 1);
          ctx.strokeStyle = `rgba(${rgb},${(1 - u) * 0.75})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 8 + u * Math.min(w, h) * 0.34, 0, TWO_PI);
          ctx.stroke();
        }
        const spin = calm ? 0 : clock * 0.9;
        ctx.setLineDash([5, 7]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = `rgba(${rgb},0.8)`;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, w * 0.13, w * 0.07, 0.45, 0, TWO_PI);
        ctx.stroke();
        ctx.setLineDash([]);
        const comet = { x: c.x + Math.cos(spin) * w * 0.13 * Math.cos(0.45) - Math.sin(spin) * w * 0.07 * Math.sin(0.45), y: c.y + Math.cos(spin) * w * 0.13 * Math.sin(0.45) + Math.sin(spin) * w * 0.07 * Math.cos(0.45) };
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.beginPath();
        ctx.arc(comet.x, comet.y, 3.2, 0, TWO_PI);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5, 0, TWO_PI);
        ctx.fill();
      }
    }

    function pointOn(e, theta) {
      const x = e.rx * Math.cos(theta);
      const y = e.ry * Math.sin(theta);
      const c = Math.cos(e.rot);
      const sn = Math.sin(e.rot);
      return { x: e.cx + x * c - y * sn, y: e.cy + x * sn + y * c };
    }

    function frame(now) {
      s.running = false;
      const calm = isCalm();
      const moving = !calm && s.visible && !document.hidden;
      const growing = [...s.born.keys()].some((id) => s.grown(id, now) < 1);
      const easing = Math.abs(s.par.tx - s.par.x) > 0.002 || Math.abs(s.par.ty - s.par.y) > 0.002;
      const animating = moving;
      if (now - s.last >= (isLite() ? LITE_FRAME_MS : FRAME_MS) || !animating) {
        const dt = Math.min((now - (s.last || now)) / 1000, 0.2);
        // The nodes stand still while one is being read.
        if (animating && s.hoverIndex < 0) s.clock += dt;
        // The parallax eases toward the pointer and then stops for good (no endless sub-pixel redraws).
        s.par.x = Math.abs(s.par.tx - s.par.x) < 0.002 ? s.par.tx : s.par.x + (s.par.tx - s.par.x) * 0.12;
        s.par.y = Math.abs(s.par.ty - s.par.y) < 0.002 ? s.par.ty : s.par.y + (s.par.ty - s.par.y) * 0.12;
        s.last = now;
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
          aria-label={`Mapa de órbitas con ${topics.length} temas aprendidos. La lista completa está debajo.`}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerLeave}
          onPointerLeave={onPointerLeave}
        />
        {learning ? (
          <p className="knowledge-map__learning" role="status">
            Aprendiendo «{clip(learning, 60)}»…
          </p>
        ) : (
          topics.length === 0 && <p className="knowledge-map__empty">Todavía no aprendí nada. Dime «Investiga y aprende…» y cada tema aparecerá aquí con su propia órbita.</p>
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
              <i style={{ background: colorOf(c.id, theme) }} aria-hidden="true" />
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
        <p className="memory-orb__hint">Pasa el mouse sobre un anillo para ver qué aprendí; haz clic para abrirlo. Cada punto pequeño es una nota y el color es el tipo de conocimiento.</p>
      )}
    </section>
  );
}
