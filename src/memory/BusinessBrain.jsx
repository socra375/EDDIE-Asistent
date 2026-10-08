import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { AREAS, areaOf, cleanTitle } from '../services/business';
import { listBusiness, saveBusiness, deleteBusiness, removeBusinessNote, BUSINESS_CHANGED_EVENT } from '../services/businessApi';
import { AREA_COLORS, MAP_ASPECT, armPoint, hash, layoutBusiness, pickItem } from './businessMap';

// The third brain: a dotted sphere with six arms, one per thing worth keeping
// about the business (clients, deals, how he talks, the context, prices and how
// he works). Each dot is one client, deal or price. Tap a dot or an arm to read
// it; the list and the form below do the same without the picture.
const SPHERE_POINTS = Array.from({ length: 170 }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / 170;
  const r = Math.sqrt(1 - y * y);
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
});
const CALM = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const LITE = () => document.documentElement.dataset.perf === 'lite';
const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
const money = (n) => (n == null ? '' : Number(n).toLocaleString('es', { maximumFractionDigits: 2 }));

export default function BusinessBrain() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', configured: true, missing: [], nodes: [], error: '' });
  const [selected, setSelected] = useState({ kind: null, id: null }); // kind: 'node' | 'area'
  const [hover, setHover] = useState(null); // { id, x, y }
  const [area, setArea] = useState('clientes');
  const [draft, setDraft] = useState({ title: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = async () => {
    try {
      const data = await listBusiness();
      setState({ status: 'ready', configured: data.configured !== false, missing: data.missing || [], nodes: data.nodes || [], error: '' });
    } catch (err) {
      setState((s) => ({ ...s, status: 'ready', error: err.message }));
    }
  };

  useEffect(() => {
    if (user) refresh();
    else setState((s) => ({ ...s, status: 'ready' }));
  }, [user]);

  // Eddie filed something from a chat: reload the picture.
  useEffect(() => {
    if (!user) return undefined;
    const onChange = () => refresh();
    window.addEventListener(BUSINESS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(BUSINESS_CHANGED_EVENT, onChange);
  }, [user]);

  const nodes = state.nodes;
  const layout = useMemo(() => layoutBusiness(nodes), [nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const current = selected.kind === 'node' ? byId.get(selected.id) : null;
  const currentArea = selected.kind === 'area' ? selected.id : current?.area || area;
  const inArea = nodes.filter((n) => n.area === currentArea);

  // ---- the picture ----
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const live = useRef({ layout, selected, hover: null, visible: true, size: { w: 0, h: 0, dpr: 1 }, points: [], anchors: [] });

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const ctx = canvas.getContext('2d');
    const s = live.current;
    let frame = 0;
    let running = true;

    const resize = () => {
      const w = wrap.clientWidth;
      if (!w) return;
      const h = Math.round(Math.min(w / 1.3, 520));
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      s.size = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.height = `${h}px`;
    };

    const toScreen = (p) => {
      const { w, h } = s.size;
      return { x: w / 2 + p.x * (w / 2) * 0.92, y: h / 2 + p.y * MAP_ASPECT * (h / 2) * 0.92 };
    };

    const draw = (now) => {
      const { w, h, dpr } = s.size;
      if (!w) return;
      const t = now / 1000;
      const calm = CALM();
      const lite = LITE();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const c = { x: w / 2, y: h / 2 };
      const core = Math.min(w, h) * 0.075;

      // 1. The glow behind the sphere.
      const glow = ctx.createRadialGradient(c.x, c.y, core * 0.5, c.x, c.y, Math.min(w, h) * 0.6);
      glow.addColorStop(0, 'rgba(90, 140, 255, 0.34)');
      glow.addColorStop(0.45, 'rgba(120, 90, 255, 0.12)');
      glow.addColorStop(1, 'rgba(10, 14, 40, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.min(w, h) * 0.6, 0, Math.PI * 2);
      ctx.fill();

      // 2. The arms: dotted curves from the sphere out to each area's anchor, with light running along them.
      const anchors = layout.anchors.map((a) => ({ ...a, s: toScreen(a) }));
      s.anchors = anchors;
      anchors.forEach((a, k) => {
        const hot = s.selected.kind === 'area' && s.selected.id === a.area;
        for (let lane = -1; lane <= 1; lane += 1) {
          for (let i = 0; i <= 56; i += 1) {
            const u = 0.12 + (i / 56) * 0.82;
            const drift = lane * 0.022 * (1 - u * 0.4);
            const p = armPoint(a.area, u);
            const q = { x: p.x + Math.cos(hash(a.area) + u) * drift, y: p.y + Math.sin(hash(a.area) + u) * drift * MAP_ASPECT };
            const sp = toScreen(q);
            const alpha = (0.5 - u * 0.32) * (hot ? 1.4 : 1);
            ctx.fillStyle = hexA(a.color, Math.max(0.08, alpha));
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, lane === 0 ? 1.1 : 0.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if (!calm && !lite) {
          for (let i = 0; i < 4; i += 1) {
            const u = (t * 0.09 + i / 4 + k * 0.13) % 1;
            const p = toScreen(armPoint(a.area, 0.14 + u * 0.8));
            ctx.fillStyle = hexA(a.color, 0.9 - u * 0.6);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // 3. The sphere: a turning dotted ball.
      const angle = calm ? 0.6 : t * 0.22;
      const tilt = 0.32;
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const ct = Math.cos(tilt);
      const st = Math.sin(tilt);
      const pts = SPHERE_POINTS.map((p) => {
        const x = p.x * ca + p.z * sa;
        const z = -p.x * sa + p.z * ca;
        return { x, y: p.y * ct - z * st, z: p.y * st + z * ct };
      });
      for (const p of pts) {
        const depth = (p.z + 1) / 2;
        ctx.fillStyle = `rgba(150, 190, 255, ${0.25 + 0.7 * depth})`;
        ctx.beginPath();
        ctx.arc(c.x + p.x * core, c.y + p.y * core, Math.max(0.6, core * 0.035 * (0.8 + 0.2 * depth)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(205, 225, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, core * 0.16, 0, Math.PI * 2);
      ctx.fill();

      // 4. The items: one dot per client, deal or price along its arm.
      const points = [];
      layout.items.forEach((item) => {
        const p = toScreen(item);
        const node = byId.get(item.id);
        const isSelected = s.selected.kind === 'node' && s.selected.id === item.id;
        const isHover = s.hover === item.id;
        const value = node?.area === 'clientes' ? (node.analysis?.level || 'bajo') : null;
        const size = value === 'alto' ? 6 : value === 'medio' ? 4.6 : 3.4;
        const sold = node?.area === 'negocios' && node.status === 'vendido';
        if (isSelected || isHover) {
          ctx.fillStyle = hexA(item.color, 0.22);
          ctx.beginPath();
          ctx.arc(p.x, p.y, size * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = sold ? item.color : hexA(item.color, 0.25);
        ctx.strokeStyle = hexA(item.color, 0.95);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        if (isSelected) {
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, size + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
        points.push({ id: item.id, x: p.x, y: p.y });
      });
      s.points = points;

      // 5. The six anchors: a bright point and the name of the area.
      anchors.forEach((a) => {
        const hot = s.selected.kind === 'area' && s.selected.id === a.area;
        const r = hot ? 9 : 7;
        const g = ctx.createRadialGradient(a.s.x, a.s.y, 0, a.s.x, a.s.y, r * 3);
        g.addColorStop(0, hexA(a.color, 0.55));
        g.addColorStop(1, hexA(a.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(a.s.x, a.s.y, r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.arc(a.s.x, a.s.y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = hexA(a.color, 0.9);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(a.s.x, a.s.y, r, 0, Math.PI * 2);
        ctx.stroke();
        const label = a.label.toUpperCase();
        ctx.font = `600 ${Math.round(Math.min(12, Math.max(10, w / 58)))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
        const width = ctx.measureText(label).width;
        // The name goes on the side of the anchor that has room for it (a long name never runs off the picture).
        let right = a.s.x >= c.x;
        if (right && a.s.x + 12 + width > w - 6) right = false;
        if (!right && a.s.x - 12 - width < 6) right = true;
        ctx.textAlign = right ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = hot ? '#ffffff' : 'rgba(215, 232, 255, 0.92)';
        ctx.fillText(label, a.s.x + (right ? 12 : -12), a.s.y + (a.s.y > c.y ? 6 : -6));
      });
    };

    const loop = (now) => {
      frame = 0;
      if (s.visible) draw(now);
      const animate = s.visible && !CALM();
      if (running && (animate || !s.drawnOnce)) {
        s.drawnOnce = true;
        frame = requestAnimationFrame(loop);
      }
    };
    const kick = () => {
      if (!running) return;
      if (!frame) frame = requestAnimationFrame(loop);
    };
    live.current.kick = kick;

    const ro = new ResizeObserver(() => {
      resize();
      kick();
    });
    ro.observe(wrap);
    const io = new IntersectionObserver(([entry]) => {
      s.visible = entry.isIntersecting;
      kick();
    });
    io.observe(wrap);
    resize();
    kick();
    return () => {
      running = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, [byId, layout]);

  // Redraw when the selection or the hover changes (also when the animation is paused).
  useEffect(() => {
    live.current.layout = layout;
    live.current.selected = selected;
    live.current.hover = hover?.id || null;
    live.current.kick?.();
  }, [hover, selected, layout]);

  const local = (event) => {
    const box = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top, width: box.width, height: box.height };
  };

  function pick(p) {
    const s = live.current;
    const item = pickItem(s.points, p.x, p.y, 14);
    if (item) return { kind: 'node', id: item.id, x: item.x, y: item.y };
    const anchor = s.anchors?.find((a) => Math.hypot(a.s.x - p.x, a.s.y - p.y) <= 16);
    if (anchor) return { kind: 'area', id: anchor.area, x: anchor.s.x, y: anchor.s.y };
    return null;
  }

  function onMove(event) {
    const p = local(event);
    const hit = pick(p);
    canvasRef.current.style.cursor = hit ? 'pointer' : 'default';
    if (hit?.kind === 'node') {
      if (hover?.id !== hit.id) setHover({ id: hit.id, x: Math.max(90, Math.min(p.width - 90, hit.x)), y: hit.y });
    } else if (hover) setHover(null);
  }

  function onClick(event) {
    const p = local(event);
    const hit = pick(p);
    setConfirm(false);
    setNotice('');
    if (!hit) return setSelected({ kind: null, id: null });
    if (hit.kind === 'area') {
      setArea(hit.id);
      return setSelected({ kind: 'area', id: hit.id });
    }
    setArea(byId.get(hit.id)?.area || area);
    setSelected((s) => (s.kind === 'node' && s.id === hit.id ? { kind: null, id: null } : { kind: 'node', id: hit.id }));
  }

  // ---- actions ----
  const save = async (event) => {
    event?.preventDefault();
    const title = cleanTitle(draft.title);
    if (!title || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const out = await saveBusiness({ area, title, note: draft.note.trim() });
      setDraft({ title: '', note: '' });
      setNotice(out.created ? `Añadido a ${areaOf(area).label}.` : `Actualizado en ${areaOf(area).label}.`);
      setSelected({ kind: 'node', id: out.node.id });
      await refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!current || !noteDraft.trim() || busy) return;
    setBusy(true);
    try {
      await saveBusiness({ area: current.area, title: current.title, note: noteDraft.trim() });
      setNoteDraft('');
      await refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  };

  const removeNote = async (index) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await removeBusinessNote(current.id, index);
      await refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await deleteBusiness(current.id);
      setSelected({ kind: null, id: null });
      setConfirm(false);
      await refresh();
    } catch (err) {
      setNotice(err.message);
    } finally {
      setBusy(false);
    }
  };

  const areaInfo = areaOf(currentArea) || AREAS[0];
  const counts = Object.fromEntries(AREAS.map((a) => [a.id, nodes.filter((n) => n.area === a.id).length]));
  const hoverNode = hover ? byId.get(hover.id) : null;

  return (
    <section className="glass-panel business-brain" aria-label="Negocios y clientes">
      <header className="memory-card__head">
        <h3>Negocios y clientes</h3>
        <span className="chip">
          {nodes.length} {nodes.length === 1 ? 'cosa' : 'cosas'}
        </span>
      </header>

      {!user ? (
        <p className="business-brain__note">Inicia sesión con Google (Configuración → Cuenta de Google) para guardar tus negocios y clientes.</p>
      ) : !state.configured ? (
        <p className="business-brain__note business-brain__note--bad">Este cerebro necesita DATABASE_URL en Vercel ({state.missing.join(', ')}).</p>
      ) : (
        <>
          <div className="business-brain__stage" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              className="business-brain__canvas"
              role="img"
              aria-label={`Mapa de negocios: ${nodes.length} cosas guardadas en seis áreas. La lista completa está debajo.`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              onClick={onClick}
            />
            {hoverNode && (
              <div className="business-brain__tip" style={{ left: hover.x, top: hover.y }} role="status">
                <span style={{ color: AREA_COLORS[hoverNode.area] }}>{areaOf(hoverNode.area)?.label}</span>
                <b>{hoverNode.title}</b>
                {hoverNode.area === 'clientes' && hoverNode.analysis && <p>valor {hoverNode.analysis.level}</p>}
              </div>
            )}
            {nodes.length === 0 && state.status === 'ready' && (
              <p className="business-brain__empty">Aún no hay nada aquí. Cuéntale a Eddie de un cliente, una venta o un precio, o añádelo abajo.</p>
            )}
          </div>

          <ul className="business-brain__areas" aria-label="Áreas">
            {AREAS.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`business-brain__area ${currentArea === a.id ? 'business-brain__area--on' : ''}`}
                  aria-pressed={currentArea === a.id}
                  onClick={() => {
                    setArea(a.id);
                    setSelected({ kind: 'area', id: a.id });
                  }}
                  style={{ '--area': AREA_COLORS[a.id] }}
                >
                  <i aria-hidden="true" />
                  {a.label} · {counts[a.id]}
                </button>
              </li>
            ))}
          </ul>

          {current ? (
            <article className="business-brain__detail" aria-label={`Detalle: ${current.title}`}>
              <span style={{ color: AREA_COLORS[current.area] }}>
                {areaOf(current.area)?.label}
                {current.status ? ` · ${current.status}` : ''}
                {current.amount != null ? ` · ${money(current.amount)}` : ''}
              </span>
              <strong>{current.title}</strong>
              {current.related && <p className="business-brain__meta">Con: {current.related}</p>}
              {current.summary && <p>{current.summary}</p>}
              {current.analysis && (
                <div className="business-brain__value">
                  <b>Valor: {current.analysis.level}</b>
                  <ul>
                    {current.analysis.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              <h4>Notas</h4>
              {current.notes.length === 0 && <p className="business-brain__meta">Todavía no hay notas.</p>}
              <ul className="business-brain__notes">
                {current.notes.map((n, i) => (
                  <li key={`${n.at}-${i}`}>
                    <span>
                      {n.text} <em>· {fmtDate(n.at)}</em>
                    </span>
                    <button type="button" className="business-brain__x" onClick={() => removeNote(i)} aria-label={`Quitar la nota: ${n.text}`}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="business-brain__row"
                onSubmit={(e) => {
                  e.preventDefault();
                  addNote();
                }}
              >
                <input className="input" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} maxLength={300} placeholder="Añadir una nota…" aria-label="Nueva nota" />
                <button type="submit" className="btn" disabled={!noteDraft.trim() || busy}>
                  Añadir nota
                </button>
              </form>
              <div className="business-brain__actions">
                {confirm ? (
                  <span className="memory__confirm">
                    ¿Olvidar «{current.title}» con sus notas?
                    <button type="button" className="btn btn-danger" onClick={forget} disabled={busy}>
                      Sí, olvidar
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirm(false)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
                    Olvidar
                  </button>
                )}
              </div>
            </article>
          ) : (
            <div className="business-brain__list">
              <p className="business-brain__meta">{areaInfo.hint}</p>
              {inArea.length === 0 && <p className="business-brain__meta">Nada en esta área todavía.</p>}
              <ul>
                {inArea.map((n) => (
                  <li key={n.id}>
                    <button type="button" className="business-brain__pick" onClick={() => setSelected({ kind: 'node', id: n.id })}>
                      <b>{n.title}</b>
                      <span>
                        {n.area === 'clientes' && n.analysis ? `valor ${n.analysis.level}` : n.status || ''}
                        {n.amount != null ? ` · ${money(n.amount)}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form className="business-brain__add" onSubmit={save} aria-label="Añadir a negocios">
            <label>
              <span className="field-label">Área</span>
              <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
                {AREAS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <input className="input" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} placeholder="Nombre (cliente, negocio, precio…)" aria-label="Nombre" />
            <input className="input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} maxLength={300} placeholder="Nota (opcional)" aria-label="Nota" />
            <button type="submit" className="btn btn-primary" disabled={!draft.title.trim() || busy}>
              Añadir
            </button>
          </form>
          {notice && (
            <p className="business-brain__note" role="status">
              {notice}
            </p>
          )}
          {state.error && (
            <p className="business-brain__note business-brain__note--bad" role="alert">
              {state.error}
            </p>
          )}
          <p className="business-brain__note">
            Eddie guarda aquí lo que le cuentas de tus clientes, negocios, precios y forma de trabajar, y calcula el valor de cada cliente con las
            ventas y lo que se ha hablado de él. Puedes corregirlo o borrarlo aquí.
          </p>
        </>
      )}
    </section>
  );
}

// "#rrggbb" + alpha → rgba().
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
