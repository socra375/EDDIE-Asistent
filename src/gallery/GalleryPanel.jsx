import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import Icon from '../layout/Icon';
import { ASPECT_OPTIONS, createMedia, deleteMedia, editMedia, listMedia, mediaUrl } from '../services/media';
import { getCenterImage, setCenterImage } from '../services/centerImage';
import './Gallery.css';

const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtMb = (bytes) => `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;

// Galería: every picture Eddie made or edited. Create one from a description,
// open one to edit it with an instruction, show it in the middle of Inicio,
// download it or delete it. (Eddie does the same from the chat: «dibújame…».)
const SOURCE_NAMES = { pexels: 'Pexels', openverse: 'Openverse', wikimedia: 'Wikimedia Commons', web: 'la web' };
// A picture Eddie found (not made) carries where it came from.
const isFound = (item) => Boolean(item.sourceUrl || item.credit);

export default function GalleryPanel() {
  const { user, login } = useAuth();
  const { settings } = useSettings();
  const [state, setState] = useState({ status: 'loading', items: [], limits: null, configured: true });
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });
  const [openId, setOpenId] = useState(null);
  const [instruction, setInstruction] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [centerId, setCenterId] = useState(() => getCenterImage()?.id || null);
  const alive = useRef(true);
  const mirror = Boolean(user) && settings.telegramMirror !== false;

  const refresh = useCallback(async () => {
    try {
      const data = await listMedia();
      if (alive.current) setState({ status: 'ready', items: data.items || [], limits: data.limits || null, configured: data.configured !== false });
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

  const open = state.items.find((m) => m.id === openId) || null;
  const closeViewer = useCallback(() => {
    setOpenId(null);
    setInstruction('');
    setConfirmDelete(false);
  }, []);

  useEffect(() => {
    if (!openId) return undefined;
    const onKey = (e) => e.key === 'Escape' && closeViewer();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, closeViewer]);

  function take(result, text) {
    setState((s) => ({ ...s, items: [result.item, ...s.items.filter((m) => m.id !== result.item.id)], limits: result.limits || s.limits }));
    setCenterImage(result.item);
    setCenterId(result.item.id);
    setMessage({ tone: 'ok', text: result.usedFallback ? `${text} (Gemini no tenía cupo y usé un servicio de respaldo.)` : text });
  }

  async function create(e) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy('create');
    setMessage({ tone: 'wait', text: 'Creando la imagen… tarda unos 10 a 30 segundos.' });
    try {
      const result = await createMedia({ prompt: prompt.trim(), aspect, mirror });
      if (!alive.current) return;
      take(result, 'Lista: está en la galería y en el centro de Inicio.');
      setPrompt('');
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy('');
    }
  }

  async function edit(e) {
    e.preventDefault();
    if (!open || !instruction.trim() || busy) return;
    setBusy('edit');
    setMessage({ tone: 'wait', text: 'Editando la imagen… tarda unos 10 a 30 segundos.' });
    try {
      const result = await editMedia({ id: open.id, instruction: instruction.trim(), mirror });
      if (!alive.current) return;
      take(result, 'Listo: guardé la edición como una imagen nueva (la original sigue ahí).');
      setOpenId(result.item.id);
      setInstruction('');
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy('');
    }
  }

  async function remove() {
    if (!open || busy) return;
    setBusy('delete');
    try {
      await deleteMedia(open.id);
      if (!alive.current) return;
      if (getCenterImage()?.id === open.id) {
        setCenterImage(null);
        setCenterId(null);
      }
      setState((s) => ({ ...s, items: s.items.filter((m) => m.id !== open.id), limits: s.limits ? { ...s.limits, count: Math.max(0, s.limits.count - 1) } : s.limits }));
      closeViewer();
      setMessage({ tone: 'ok', text: 'Imagen eliminada.' });
    } catch (err) {
      if (alive.current) setMessage({ tone: 'bad', text: err.message });
    } finally {
      if (alive.current) setBusy('');
    }
  }

  function toCenter(item) {
    setCenterImage(item);
    setCenterId(item.id);
    setMessage({ tone: 'ok', text: 'Quedó en el centro de Inicio.' });
  }

  if (!user) {
    return (
      <section className="gallery" aria-label="Galería de imágenes">
        <div className="glass-panel gallery__card">
          <h3>Galería</h3>
          <p className="gallery__note">Inicia sesión con Google para que Eddie cree, edite y guarde tus imágenes.</p>
          <button type="button" className="btn btn-primary" onClick={login}>
            Iniciar sesión con Google
          </button>
        </div>
      </section>
    );
  }

  const { limits } = state;
  return (
    <section className="gallery" aria-label="Galería de imágenes">
      <form className="glass-panel gallery__card" onSubmit={create} aria-label="Crear una imagen">
        <header className="gallery__head">
          <h3>Crear una imagen</h3>
          {limits && (
            <span className="chip" title={`Tope de ${limits.dailyLimit || 'sin límite'} por día · ${fmtMb(limits.bytes)} de ${fmtMb(limits.maxBytes)}`}>
              {limits.count} de {limits.maxItems} guardadas · {limits.last24h}
              {limits.dailyLimit ? ` de ${limits.dailyLimit}` : ''} hoy
            </span>
          )}
        </header>
        {!state.configured && <p className="gallery__note gallery__note--bad">Falta configurar GEMINI_API_KEY (y la base de datos) en Vercel.</p>}
        <label className="gallery__field">
          <span>Descríbela</span>
          <textarea className="input" rows={3} maxLength={800} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Un faro al amanecer, estilo acuarela, colores suaves…" />
        </label>
        <div className="gallery__row">
          <label className="gallery__field gallery__field--inline">
            <span>Forma</span>
            <select className="input" value={aspect} onChange={(e) => setAspect(e.target.value)}>
              {ASPECT_OPTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={!prompt.trim() || Boolean(busy) || !state.configured}>
            <Icon name="image" size={14} /> {busy === 'create' ? 'Creando…' : 'Crear imagen'}
          </button>
        </div>
        {message.text && (
          <p className={`gallery__msg gallery__msg--${message.tone}`} role="status">
            {message.text}
          </p>
        )}
      </form>

      <div className="glass-panel gallery__card">
        <header className="gallery__head">
          <h3>Mis imágenes</h3>
        </header>
        {state.status === 'loading' && <p className="gallery__note">Cargando…</p>}
        {state.status !== 'loading' && state.items.length === 0 && <p className="gallery__note">Todavía no hay imágenes. Crea una arriba o dile a Eddie «dibújame…» en el chat.</p>}
        <ul className="gallery__grid">
          {state.items.map((m) => (
            <li key={m.id}>
              <button type="button" className="gallery__tile" onClick={() => setOpenId(m.id)} title={m.prompt} aria-label={`Abrir: ${m.prompt}`}>
                <img src={mediaUrl(m.id)} alt={m.prompt} loading="lazy" />
                {centerId === m.id && <span className="gallery__badge">En el centro</span>}
                {m.parentId && <span className="gallery__badge gallery__badge--edit">Edición</span>}
                {isFound(m) && <span className="gallery__badge gallery__badge--found">Encontrada</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {open && (
        <div className="gallery__overlay" role="dialog" aria-modal="true" aria-label="Imagen" onClick={(e) => e.target === e.currentTarget && closeViewer()}>
          <div className="glass-panel gallery__viewer">
            <button type="button" className="gallery__close" onClick={closeViewer} aria-label="Cerrar">
              <Icon name="close" size={16} />
            </button>
            <img src={mediaUrl(open.id)} alt={open.prompt} />
            <p className="gallery__prompt">{open.prompt}</p>
            <p className="gallery__meta">
              {fmtDate(open.createdAt)} · {fmtMb(open.bytes)}
              {isFound(open) ? ` · encontrada en ${SOURCE_NAMES[open.provider] || 'internet'}` : open.provider !== 'gemini' ? ' · servicio de respaldo' : ''}
              {open.parentId ? ' · edición de otra imagen' : ''}
            </p>
            {isFound(open) && (
              <p className="gallery__credit">
                {[open.credit && `📷 ${open.credit}`, open.license].filter(Boolean).join(' · ')}
                {/^https?:\/\//i.test(open.sourceUrl || '') && (
                  <>
                    {' · '}
                    <a href={open.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      Ver la fuente
                    </a>
                  </>
                )}
              </p>
            )}
            <form className="gallery__edit" onSubmit={edit}>
              <input className="input" value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={800} placeholder="Qué cambiar: «quítale el fondo», «hazla de noche»…" aria-label="Instrucción para editar" />
              <button type="submit" className="btn btn-primary" disabled={!instruction.trim() || Boolean(busy)}>
                {busy === 'edit' ? 'Editando…' : 'Editar'}
              </button>
            </form>
            <div className="gallery__actions">
              <button type="button" className="btn" onClick={() => toCenter(open)}>
                Mostrar en el centro de Inicio
              </button>
              <a className="btn" href={mediaUrl(open.id)} download={`eddie-${open.id.slice(0, 8)}.${open.mime === 'image/jpeg' ? 'jpg' : open.mime === 'image/webp' ? 'webp' : 'png'}`}>
                Descargar
              </a>
              {confirmDelete ? (
                <>
                  <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={remove}>
                    Sí, eliminar
                  </button>
                  <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                    No
                  </button>
                </>
              ) : (
                <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
                  <Icon name="trash" size={14} /> Eliminar
                </button>
              )}
            </div>
            {message.text && (
              <p className={`gallery__msg gallery__msg--${message.tone}`} role="status">
                {message.text}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
