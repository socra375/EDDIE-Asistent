import { useEffect, useMemo, useRef, useState } from 'react';
import { ORB_COLORS, growth, layoutOrb, pickNode, project } from './orbMath.js';

const AUTO_SPIN = 0.18; // radians per second
const FRAME_MS = 48; // ~20 fps while turning on its own: it is decoration
const LITE_FRAME_MS = 100; // ~10 fps in Modo ligero
const BIRTH_MS = 700;
const INTRO_STAGGER_MS = 35;
const INTRO_MAX_MS = 1400;

// Only "reduce motion" keeps the orb still. Modo ligero (which the browser may
// turn on by itself on a slow screen) just makes it turn more slowly, with
// fewer frames: it must not make the orb look dead.
function isCalm() {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

const isLite = () => document.documentElement.dataset.perf === 'lite';

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// What Eddie remembers as a sphere of points: every memory is a bright node
// with a few small points around it, linked to its neighbours. New memories
// grow in. Point at one to read it; click to pin it (and forget it);
// drag to turn the sphere.
// items: [{ id, category, label, text, meta?, title?, rows?: [{ label, value }], forgettable, editable }]
export default function MemoryOrb({ items, categories, onForget, onEdit }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const layout = useMemo(() => layoutOrb(items), [items]);
  const [hover, setHover] = useState(null); // { index, x, y }
  const [selectedId, setSelectedId] = useState(null);
  const [focus, setFocus] = useState(null); // category id the legend isolates

  // Everything the draw loop needs lives in one ref so handlers and the loop
  // never see stale values and React doesn't re-render per frame.
  const live = useRef({
    layout,
    rot: { yaw: 0.6, pitch: -0.25 },
    drag: null,
    hoverIndex: -1,
    selectedId: null,
    focus: null,
    projected: [],
    born: new Map(),
    size: { w: 0, h: 0, dpr: 1 },
    visible: true,
    running: false,
    last: 0,
    request: () => {},
  });

  // Keep the loop's view of the data and the interaction state current, and
  // time the birth of memories it hasn't seen yet.
  useEffect(() => {
    const s = live.current;
    const now = performance.now();
    const calm = isCalm();
    const first = s.born.size === 0;
    const ids = new Set(layout.nodes.map((n) => n.id));
    layout.nodes.forEach((n, i) => {
      if (s.born.has(n.id)) return;
      s.born.set(n.id, calm ? -Infinity : first ? now + Math.min(i * INTRO_STAGGER_MS, INTRO_MAX_MS) : now);
    });
    for (const id of [...s.born.keys()]) if (!ids.has(id)) s.born.delete(id);
    s.layout = layout;
    s.selectedId = selectedId;
    s.focus = focus;
    s.request();
  }, [layout, selectedId, focus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const ctx = canvas.getContext('2d');
    const s = live.current;

    function resize() {
      const w = wrap.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.size = { w, h: w, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
      s.request();
    }

    function draw(now) {
      const { w, dpr } = s.size;
      if (!w) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, w);
      const c = w / 2;
      const radius = w * 0.42;
      const { nodes, links, dust } = s.layout;
      const rot = s.rot;

      // The faint shell.
      ctx.fillStyle = '#7fd8ff';
      for (const p of dust) {
        const q = project(p, rot, c, c, radius);
        ctx.globalAlpha = 0.06 + q.depth * 0.22;
        ctx.fillRect(q.x - 0.8, q.y - 0.8, 1.6, 1.6);
      }

      const proj = nodes.map((n) => project(n, rot, c, c, radius));
      s.projected = proj;
      const dim = (n) => (s.focus && s.focus !== n.category ? 0.18 : 1);

      // Links between neighbours.
      ctx.lineWidth = 1;
      links.forEach(([i, j]) => {
        const a = nodes[i];
        const b = nodes[j];
        const g = Math.min(growth(now, s.born.get(a.id) ?? -Infinity, BIRTH_MS), growth(now, s.born.get(b.id) ?? -Infinity, BIRTH_MS));
        if (g <= 0) return;
        const hot = s.hoverIndex === i || s.hoverIndex === j;
        ctx.strokeStyle = hot ? '#b9f7ff' : '#3fe8ff';
        ctx.globalAlpha = (hot ? 0.85 : 0.1 + ((proj[i].depth + proj[j].depth) / 2) * 0.28) * g * Math.min(dim(a), dim(b));
        ctx.beginPath();
        ctx.moveTo(proj[i].x, proj[i].y);
        ctx.lineTo(proj[j].x, proj[j].y);
        ctx.stroke();
      });

      // Back to front: points around each memory, then the memory itself.
      const order = proj.map((_, i) => i).sort((p, q) => proj[p].depth - proj[q].depth);
      for (const i of order) {
        const n = nodes[i];
        const q = proj[i];
        const color = ORB_COLORS[n.category] || '#3fe8ff';
        const g = growth(now, s.born.get(n.id) ?? -Infinity, BIRTH_MS);
        if (g <= 0) continue;
        const d = dim(n);
        ctx.fillStyle = color;
        for (const sat of n.sats) {
          const sp = project({ x: sat.x * g, y: sat.y * g, z: sat.z * g }, rot, c, c, radius);
          ctx.globalAlpha = (0.2 + sp.depth * 0.7) * d;
          const size = 1.6 + sp.depth * 1.9;
          ctx.fillRect(sp.x - size / 2, sp.y - size / 2, size, size);
        }
        const hot = s.hoverIndex === i || s.selectedId === n.id;
        const r = (3.2 + q.depth * 3.2 + (hot ? 2 : 0)) * g;
        ctx.globalAlpha = (0.4 + q.depth * 0.6) * d;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (hot) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(q.x, q.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (g < 1) {
          // Birth ring.
          ctx.globalAlpha = (1 - g) * 0.8;
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 4 + (1 - g) * 22, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      s.running = false;
      const spinning = !isCalm() && s.visible && !document.hidden && !s.drag && s.hoverIndex < 0 && !s.selectedId;
      const growing = [...s.born.values()].some((b) => now - b < BIRTH_MS);
      if (now - s.last >= (isLite() ? LITE_FRAME_MS : FRAME_MS) || !spinning) {
        const dt = Math.min((now - (s.last || now)) / 1000, 0.2);
        if (spinning) s.rot.yaw += AUTO_SPIN * dt;
        s.last = now;
        draw(now);
      }
      if ((spinning || growing) && s.visible) request();
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
      if (s.visible) request();
    });
    seen.observe(wrap);
    // Turning Modo ligero off lets the sphere start turning again.
    const mode = new MutationObserver(() => request());
    mode.observe(document.documentElement, { attributes: true, attributeFilter: ['data-perf'] });
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

  function onPointerMove(event) {
    const s = live.current;
    const p = local(event);
    if (s.drag) {
      s.rot.yaw += (event.clientX - s.drag.x) * 0.008;
      s.rot.pitch = Math.max(-1.2, Math.min(1.2, s.rot.pitch - (event.clientY - s.drag.y) * 0.008));
      s.drag.x = event.clientX;
      s.drag.y = event.clientY;
      s.drag.moved += Math.abs(event.movementX || 0) + Math.abs(event.movementY || 0);
      if (s.hoverIndex !== -1) {
        s.hoverIndex = -1;
        setHover(null);
      }
      s.request();
      return;
    }
    const index = pickNode(s.projected, p.x, p.y, 13);
    if (index !== s.hoverIndex) {
      s.hoverIndex = index;
      setHover(index < 0 ? null : { index, x: Math.max(110, Math.min(p.width - 110, s.projected[index].x)), y: s.projected[index].y });
      s.request();
    }
  }

  function onPointerDown(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    live.current.drag = { x: event.clientX, y: event.clientY, moved: 0 };
  }

  function onPointerUp(event) {
    const s = live.current;
    const moved = s.drag?.moved ?? 0;
    s.drag = null;
    if (moved < 4) {
      // A click (or tap): pin what is under the pointer.
      const p = local(event);
      const index = pickNode(s.projected, p.x, p.y, 16);
      setSelectedId(index < 0 ? null : s.layout.nodes[index].id === selectedId ? null : s.layout.nodes[index].id);
      if (index >= 0) {
        s.hoverIndex = index;
        setHover({ index, x: Math.max(110, Math.min(p.width - 110, s.projected[index].x)), y: s.projected[index].y });
      }
    }
    s.request();
  }

  function onPointerLeave() {
    const s = live.current;
    if (s.drag) return;
    s.hoverIndex = -1;
    setHover(null);
    s.request();
  }

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const hovered = hover ? byId.get(layout.nodes[hover.index]?.id) : null;
  const selected = selectedId ? byId.get(selectedId) : null;
  const counts = useMemo(() => {
    const out = {};
    for (const i of items) out[i.category] = (out[i.category] || 0) + 1;
    return out;
  }, [items]);

  return (
    <section className="glass-panel memory-orb" aria-label="Mapa de lo que Eddie recuerda">
      <header className="memory-card__head">
        <h3>Mapa de memoria</h3>
        <span className="chip">{items.length} {items.length === 1 ? 'recuerdo' : 'recuerdos'}</span>
      </header>

      <div className="memory-orb__stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="memory-orb__canvas"
          role="img"
          aria-label={`Esfera con ${items.length} recuerdos. La lista completa está debajo.`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerLeave}
          onPointerLeave={onPointerLeave}
        />
        {items.length === 0 && <p className="memory-orb__empty">Todavía no recuerdo nada. Cada cosa que me cuentes aparecerá aquí como un punto nuevo.</p>}
        {hovered && (
          <div className="memory-orb__tip" style={{ left: hover.x, top: hover.y }} role="status">
            <span style={{ color: ORB_COLORS[hovered.category] }}>{hovered.label}</span>
            {hovered.title && <b>{hovered.title}</b>}
            <p>{clip(hovered.text, 160)}</p>
          </div>
        )}
      </div>

      <ul className="memory-orb__legend" aria-label="Categorías">
        {categories
          .filter((c) => counts[c.id])
          .map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`memory-orb__key ${focus === c.id ? 'memory-orb__key--on' : ''}`}
                aria-pressed={focus === c.id}
                onClick={() => setFocus(focus === c.id ? null : c.id)}
              >
                <i style={{ background: ORB_COLORS[c.id] }} aria-hidden="true" />
                {c.label} · {counts[c.id]}
              </button>
            </li>
          ))}
      </ul>

      {selected ? (
        <div className="memory-orb__detail">
          <span style={{ color: ORB_COLORS[selected.category] }}>
            {selected.label}
            {selected.meta ? ` · ${selected.meta}` : ''}
          </span>
          {selected.title && <strong>{selected.title}</strong>}
          {selected.rows?.length ? (
            <dl className="memory-orb__rows">
              {selected.rows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p>{selected.text}</p>
          )}
          <div className="memory-orb__detail-actions">
            {selected.editable && (
              <button type="button" className="btn" onClick={() => onEdit(selected)}>
                Editar
              </button>
            )}
            {selected.forgettable && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setSelectedId(null);
                  onForget(selected);
                }}
              >
                Olvidar este recuerdo
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSelectedId(null)}>
              Cerrar
            </button>
          </div>
        </div>
      ) : (
        <p className="memory-orb__hint">Pasa el mouse sobre un punto para ver qué recuerdo es. Haz clic para fijarlo y arrastra para girar la esfera.</p>
      )}
    </section>
  );
}
