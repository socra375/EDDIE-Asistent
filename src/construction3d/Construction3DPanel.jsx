import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { deleteProject, fmtBytes, listProjects, updateProject, uploadProject } from '../services/construction3d';
import NeuralCore from './NeuralCore';
import './Construction3D.css';

const ModelViewer = lazy(() => import('./ModelViewer'));

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'en_proceso', label: 'En proceso' },
  { id: 'terminado', label: 'Terminados' },
];
const STATUS_LABEL = { en_proceso: 'En proceso', terminado: 'Terminado' };
const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Construction 3D: the 3D brain. The neural core in the middle with one
// satellite per project around it, the figures of the brain on the left, the
// project list on the right. Choosing a project opens it in the holographic
// viewer. Models (.glb, .stl or .obj) are kept in the private bucket (api/_lib/construction3d/).
export default function Construction3DPanel() {
  const { user, login } = useAuth();
  const [state, setState] = useState({ status: 'loading', items: [], limits: null, configured: true, missing: [] });
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [mode, setMode] = useState('holo');
  const [upload, setUpload] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const [noGl, setNoGl] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false); // the list is a drawer on narrow screens
  const alive = useRef(true);
  const fileInput = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listProjects();
      if (alive.current) setState({ status: 'ready', items: data.items || [], limits: data.limits || null, configured: data.configured !== false, missing: data.missing || [] });
    } catch (err) {
      if (alive.current) {
        setState((s) => ({ ...s, status: 'error' }));
        setMessage({ tone: 'bad', text: err.message });
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const first = user ? window.setTimeout(refresh, 0) : null;
    return () => {
      alive.current = false;
      window.clearTimeout(first);
    };
  }, [user, refresh]);

  const open = state.items.find((p) => p.id === openId) || null;
  const close = useCallback(() => {
    setOpenId(null);
    setConfirmDelete(false);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  const visible = filter === 'all' ? state.items : state.items.filter((p) => p.status === filter);
  const limits = state.limits;
  const used = limits ? Math.min(100, (limits.bytes / limits.maxBytes) * 100) : 0;
  const maxModel = limits?.maxModelBytes || 200 * 1048576;

  const send = async (file) => {
    if (!file || upload) return;
    if (!/\.(glb|stl|obj)$/i.test(file.name)) return setMessage({ tone: 'bad', text: 'Sube un modelo .glb, .stl u .obj (desde Blender: Exportar, y elige glTF Binary, STL o Wavefront).' });
    if (file.size > maxModel) return setMessage({ tone: 'bad', text: `Ese modelo pesa ${fmtBytes(file.size)}; el máximo es ${fmtBytes(maxModel)}.` });
    setMessage({ tone: '', text: '' });
    setUpload({ name: file.name, progress: 0 });
    try {
      const done = await uploadProject(file, { onProgress: (progress) => alive.current && setUpload({ name: file.name, progress }) });
      if (!alive.current) return;
      setState((s) => ({ ...s, items: [done.item, ...s.items], limits: done.limits || s.limits }));
      setMessage({ tone: 'ok', text: `«${done.item.name}» ya está en el cerebro 3D.` });
      setFilter('all');
      setOpenId(done.item.id);
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setUpload(null);
    }
  };

  const change = async (fields) => {
    if (!open) return;
    try {
      const { item } = await updateProject(open.id, fields);
      setState((s) => ({ ...s, items: s.items.map((p) => (p.id === item.id ? item : p)) }));
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
    }
  };

  const remove = async () => {
    if (!open) return;
    if (!confirmDelete) return setConfirmDelete(true);
    try {
      const done = await deleteProject(open.id);
      setState((s) => ({ ...s, items: s.items.filter((p) => p.id !== open.id), limits: done.limits || s.limits }));
      close();
      setMessage({ tone: 'ok', text: 'Proyecto borrado.' });
    } catch (err) {
      setMessage({ tone: 'bad', text: err.message });
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    send(e.dataTransfer?.files?.[0]);
  };

  const status = !user ? 'SIN SESIÓN' : state.status === 'loading' ? 'CARGANDO' : !state.configured ? 'SIN CONFIGURAR' : upload ? 'RECIBIENDO' : state.status === 'error' ? 'SIN CONEXIÓN' : 'ÓPTIMO';
  const statusTone = status === 'ÓPTIMO' || status === 'RECIBIENDO' ? 'ok' : 'warn';

  return (
    <section
      className={`c3d ${dragging ? 'c3d--drag' : ''}`}
      aria-label="Construction 3D"
      onDragOver={(e) => {
        if (user && state.configured) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {noGl ? (
        <p className="c3d-nogl">Este dispositivo no permite gráficos 3D (WebGL), así que no puedo dibujar el núcleo. Tus proyectos siguen guardados.</p>
      ) : (
        <NeuralCore projects={visible} activeId={openId} onSelect={setOpenId} onUnsupported={() => setNoGl(true)} />
      )}

      <div className="c3d-hud">
        <header className="c3d-title">
          <h2>Construction 3D</h2>
          <p>Cerebro de proyectos 3D</p>
        </header>

        <aside className="c3d-card c3d-stats" aria-label="Estado del cerebro 3D">
          <p className="c3d-card__kicker">J.A.R.V.I.S.</p>
          <p className="c3d-card__head">NÚCLEO NEURAL 3D · ACTIVO</p>
          <dl>
            <div>
              <dt>Capacidad</dt>
              <dd>{limits ? `${used.toFixed(used < 10 ? 1 : 0)}%` : '—'}</dd>
            </div>
            <div className="c3d-bar" role="progressbar" aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${Math.max(used, limits?.bytes ? 1.5 : 0)}%` }} />
            </div>
            <div>
              <dt>Almacenado</dt>
              <dd>{limits ? `${fmtBytes(limits.bytes)} de ${fmtBytes(limits.maxBytes)}` : '—'}</dd>
            </div>
            <div>
              <dt>Índice de objetos</dt>
              <dd>{state.items.length}</dd>
            </div>
            <div>
              <dt>Estado del sistema</dt>
              <dd className={`c3d-status c3d-status--${statusTone}`}>{status}</dd>
            </div>
          </dl>
          {upload && (
            <div className="c3d-upload">
              <p>Subiendo «{upload.name}» · {Math.round(upload.progress * 100)}%</p>
              <div className="c3d-bar"><span style={{ width: `${upload.progress * 100}%` }} /></div>
            </div>
          )}
        </aside>

        <aside className={`c3d-card c3d-assets ${assetsOpen ? 'is-open' : ''}`} aria-label="Proyectos 3D">
          <button type="button" className="c3d-card__head c3d-assets__toggle" aria-expanded={assetsOpen} onClick={() => setAssetsOpen((on) => !on)}>
            ACTIVOS 3D · {state.items.length}
            <span aria-hidden="true">{assetsOpen ? '▾' : '▴'}</span>
          </button>
          <div className="c3d-chips" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'is-on' : ''} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <ul>
            {visible.map((p) => (
              <li key={p.id}>
                <button type="button" className={p.id === openId ? 'is-on' : ''} onClick={() => setOpenId(p.id)}>
                  <span className="c3d-asset__name">{p.name}</span>
                  <span className={`c3d-asset__tag c3d-asset__tag--${p.status}`}>{STATUS_LABEL[p.status]}</span>
                  <span className="c3d-asset__meta">{fmtBytes(p.bytes)} · {fmtDate(p.updatedAt)}</span>
                </button>
              </li>
            ))}
            {user && state.status === 'ready' && state.configured && visible.length === 0 && (
              <li className="c3d-empty">{state.items.length ? 'Ningún proyecto con este estado.' : 'Aún no hay proyectos. Sube tu primer modelo (.glb, .stl o .obj).'}</li>
            )}
          </ul>
        </aside>

        <div className="c3d-actions">
          {!user ? (
            <div className="c3d-card c3d-login">
              <p>Inicia sesión con Google para guardar y ver tus proyectos 3D desde cualquier dispositivo.</p>
              <button type="button" className="btn btn-primary" onClick={login}>Iniciar sesión con Google</button>
            </div>
          ) : !state.configured && state.status === 'ready' ? (
            <div className="c3d-card c3d-login">
              <p>El almacenamiento 3D todavía no está configurado. Falta en Vercel: {state.missing.join(', ')}.</p>
            </div>
          ) : (
            <>
              <input ref={fileInput} type="file" accept=".glb,.stl,.obj,model/gltf-binary,model/stl" hidden onChange={(e) => { send(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn btn-primary c3d-upload-btn" disabled={Boolean(upload) || state.status === 'loading'} onClick={() => fileInput.current?.click()}>
                {upload ? 'Subiendo…' : 'Subir modelo'}
              </button>
              <span className="c3d-hint">o suelta el archivo aquí · hasta {fmtBytes(maxModel)}</span>
            </>
          )}
          {message.text && <p className={`c3d-message c3d-message--${message.tone}`} role="status">{message.text}</p>}
        </div>
      </div>

      {open && (
        <div className="c3d-detail" role="dialog" aria-modal="true" aria-label={`Proyecto ${open.name}`}>
          <Suspense fallback={<div className="c3d-viewer"><div className="c3d-viewer__note">Preparando visor…</div></div>}>
            <ModelViewer key={open.id} projectId={open.id} mode={mode} />
          </Suspense>
          <div className="c3d-side c3d-card">
            <button type="button" className="c3d-close" onClick={close} aria-label="Cerrar">×</button>
            <p className="c3d-card__head">PROYECTO</p>
            <label>
              Nombre
              <input key={`${open.id}-${open.updatedAt}`} defaultValue={open.name} maxLength={80} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== open.name && change({ name: e.target.value })} />
            </label>
            <div className="c3d-toggle" role="group" aria-label="Estado">
              {Object.entries(STATUS_LABEL).map(([id, label]) => (
                <button key={id} type="button" className={open.status === id ? 'is-on' : ''} onClick={() => open.status !== id && change({ status: id })}>{label}</button>
              ))}
            </div>
            <div className="c3d-toggle" role="group" aria-label="Vista">
              <button type="button" className={mode === 'holo' ? 'is-on' : ''} onClick={() => setMode('holo')}>Holograma</button>
              <button type="button" className={mode === 'original' ? 'is-on' : ''} onClick={() => setMode('original')}>Original</button>
            </div>
            <label>
              Notas
              <textarea key={`n-${open.id}-${open.updatedAt}`} defaultValue={open.notes} maxLength={500} rows={4} onBlur={(e) => e.target.value !== open.notes && change({ notes: e.target.value })} />
            </label>
            <p className="c3d-meta">{fmtBytes(open.bytes)} · actualizado {fmtDate(open.updatedAt)}{open.source === 'blender' ? ' · hecho con Blender' : ''}</p>
            <div className="c3d-side__row">
              <button type="button" className="btn" onClick={close}>Volver al núcleo</button>
              <button type="button" className="btn btn-danger" onClick={remove}>{confirmDelete ? 'Confirmar borrado' : 'Borrar'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
