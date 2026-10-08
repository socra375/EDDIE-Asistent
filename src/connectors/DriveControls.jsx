import { useState } from 'react';
import Icon from '../layout/Icon';
import { BUSINESS_CHANGED_EVENT } from '../services/businessApi';
import { AREAS } from '../services/business';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

const PURPOSES = [
  { id: 'negocio', label: 'Negocio', hint: 'tus negocios, el contexto, la información y los planes' },
  { id: 'clientes', label: 'Servicio al cliente', hint: 'cómo hablas, tus clientes y su información' },
  { id: 'otro', label: 'Otra', hint: 'cualquier otra información' },
];

async function post(action, body) {
  const res = await fetch(`${API_BASE}/api/connectors/drive/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data;
}

const MAX_BATCHES = 80; // a safety net: a folder holds at most ~120 files, a batch reads several
const areaLabel = (id) => AREAS.find((a) => a.id === id)?.label || id;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const since = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return 'hace un momento';
  if (mins < 60) return `hace ${mins} minutos`;
  if (mins < 60 * 36) return `hace ${Math.round(mins / 60)} horas`;
  return `hace ${Math.round(mins / 1440)} días`;
};

// The import line of one folder: state, the button, progress while it runs, and what it did.
function FolderImport({ folder, imp, disabled, docsConnected, onImport, onUndo }) {
  const done = folder.import?.done || 0;
  const failed = folder.import?.failed || 0;
  const [confirmUndo, setConfirmUndo] = useState(false);
  const running = Boolean(imp?.running);
  const t = imp?.totals;
  const left = imp?.remaining;
  const total = t && left != null ? t.processed + left : null;

  return (
    <div className="drivefolders__import">
      {!running && !imp && (
        <p className="connector__meta">
          {done || folder.import?.empty
            ? `En tu cerebro de negocios: ${plural(done, 'archivo importado', 'archivos importados')}${folder.import.lastAt ? ` (${since(folder.import.lastAt)})` : ''}.${failed ? ` ${plural(failed, 'archivo no se pudo leer', 'archivos no se pudieron leer')}.` : ''}`
            : 'Todavía no está en tu cerebro de negocios.'}
        </p>
      )}
      <div className="drivefolders__actions">
        <button type="button" className="btn btn-primary" disabled={disabled} onClick={onImport} title={docsConnected ? undefined : 'Conecta «Google Docs y Sheets» para poder leer los archivos'}>
          {running ? 'Importando…' : done ? 'Actualizar el cerebro' : 'Importar al cerebro'}
        </button>
        {(done > 0 || failed > 0) && !running &&
          (confirmUndo ? (
            <>
              <span className="connector__meta">¿Quitar del cerebro lo que vino de esta carpeta?</span>
              <button type="button" className="btn btn-danger" disabled={disabled} onClick={() => { setConfirmUndo(false); onUndo(); }}>
                Sí, deshacer
              </button>
              <button type="button" className="btn" onClick={() => setConfirmUndo(false)}>
                No
              </button>
            </>
          ) : (
            <button type="button" className="btn" disabled={disabled} onClick={() => setConfirmUndo(true)}>
              Deshacer importación
            </button>
          ))}
      </div>
      {running && (
        <div className="drivefolders__progress" role="status" aria-live="polite">
          {total ? <progress max={total} value={t.processed} aria-label="Avance de la importación" /> : <progress aria-label="Avance de la importación" />}
          <span>
            {imp.listing && !imp.listing.found
              ? 'Buscando documentos y hojas…'
              : `Leyendo archivos… ${t.processed}${total ? ` de ${total}` : ''}`}
          </span>
        </div>
      )}
      {imp && !running && imp.undone && (
        <p className="connector__meta" role="status">
          Deshecho: {plural(imp.undone.deleted, 'cosa nueva quitada', 'cosas nuevas quitadas')} y {plural(imp.undone.cleaned, 'ficha limpiada', 'fichas limpiadas')} de tu cerebro.
        </p>
      )}
      {imp && !running && t && (
        <div className="drivefolders__summary" role="status">
          <p>
            {imp.listing && imp.listing.found === 0
              ? 'No encontré documentos ni hojas de Google en esa carpeta.'
              : `Listo: ${plural(t.processed, 'archivo leído', 'archivos leídos')} → ${plural(t.created, 'cosa nueva', 'cosas nuevas')} y ${plural(t.updated, 'actualizada', 'actualizadas')} en tu cerebro.`}
            {t.empty > 0 && ` ${plural(t.empty, 'archivo sin nada útil', 'archivos sin nada útil')}.`}
            {t.failed > 0 && ` ${plural(t.failed, 'archivo falló', 'archivos fallaron')}.`}
            {imp.listing?.ignored > 0 && ` ${plural(imp.listing.ignored, 'archivo (PDF, Word…) no se lee', 'archivos (PDF, Word…) no se leen')}.`}
            {imp.listing?.truncated && ' La carpeta es muy grande: se leyó una parte; pulsa de nuevo para seguir con el resto.'}
          </p>
          {imp.stopped && (
            <p className="connectors__warning" role="alert">
              Se detuvo: {imp.stopped}
            </p>
          )}
          {imp.remaining > 0 && !imp.stopped && <p className="connector__meta">Faltan {plural(imp.remaining, 'archivo', 'archivos')}: pulsa de nuevo para seguir.</p>}
          {imp.items.length > 0 && (
            <ul className="drivefolders__items" aria-label="Lo que se guardó">
              {imp.items.map((i, k) => (
                <li key={`${i.title}-${k}`}>
                  <strong>{i.title}</strong> · {areaLabel(i.area)}
                  {i.created ? ' · nuevo' : ' · actualizado'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// "Carpetas de Drive": paste the link of a folder, say what it is for, and Eddie
// looks there (read-only) when he is asked about a client, a business or a plan.
export default function DriveControls({ connector, docsConnected, onChanged }) {
  const folders = connector.details?.folders || [];
  const [url, setUrl] = useState('');
  const [purpose, setPurpose] = useState('negocio');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // The import being run (or just finished) for one folder: { id, running, totals, remaining, items, stopped, listing, undone }.
  const [imp, setImp] = useState(null);

  if (connector.status !== 'connected') return null;

  async function run(label, fn) {
    setBusy(label);
    setError('');
    try {
      await fn();
      onChanged(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  // Reads the folder into the third brain in batches (each call is one short server run), showing progress.
  async function importFolder(folder) {
    const totals = { processed: 0, created: 0, updated: 0, empty: 0, failed: 0 };
    let state = { id: folder.id, running: true, totals, remaining: null, items: [], stopped: null, listing: null, undone: null };
    setImp(state);
    setError('');
    try {
      let start = true;
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const r = await post('import', { id: folder.id, start });
        start = false;
        for (const k of Object.keys(totals)) totals[k] += r[k] || 0;
        state = { ...state, totals: { ...totals }, remaining: r.remaining, items: [...state.items, ...(r.items || [])].slice(0, 40), stopped: r.stopped || null, listing: r.listing || state.listing };
        setImp(state);
        if (r.stopped || r.remaining === 0 || r.processed === 0) break;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setImp((cur) => (cur ? { ...cur, running: false } : cur));
      window.dispatchEvent(new Event(BUSINESS_CHANGED_EVENT));
      onChanged(true);
    }
  }

  async function undoFolder(folder) {
    setBusy('undo');
    setError('');
    try {
      const r = await post('undo', { id: folder.id });
      setImp({ id: folder.id, running: false, totals: null, remaining: 0, items: [], stopped: null, listing: null, undone: r });
      window.dispatchEvent(new Event(BUSINESS_CHANGED_EVENT));
      onChanged(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  }

  const importing = Boolean(imp?.running);

  return (
    <div className="drivefolders">
      {folders.length > 0 ? (
        <ul className="drivefolders__list" aria-label="Carpetas conectadas">
          {folders.map((f) => (
            <li key={f.id}>
              <Icon name="cloud" size={14} />
              <span className="drivefolders__name">{f.name}</span>
              <span className="drivefolders__purpose">{PURPOSES.find((p) => p.id === f.purpose)?.label || 'Otra'}</span>
              <button type="button" className="btn btn-danger" disabled={Boolean(busy) || importing} aria-label={`Quitar ${f.name}`} onClick={() => run('remove', () => post('remove', { id: f.id }))}>
                Quitar
              </button>
              <FolderImport folder={f} imp={imp?.id === f.id ? imp : null} disabled={Boolean(busy) || importing || !docsConnected} docsConnected={docsConnected} onImport={() => importFolder(f)} onUndo={() => undoFolder(f)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="connector__meta">Todavía no hay carpetas conectadas.</p>
      )}

      <form
        className="drivefolders__form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          run('add', async () => {
            await post('add', { url: url.trim(), purpose });
            setUrl('');
          });
        }}
      >
        <label>
          <span>Enlace de la carpeta</span>
          <input type="text" inputMode="url" autoComplete="off" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" disabled={Boolean(busy)} />
        </label>
        <label>
          <span>Para qué es</span>
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={Boolean(busy)}>
            {PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} — {p.hint}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-primary" disabled={Boolean(busy) || !url.trim()}>
          {busy === 'add' ? 'Conectando…' : 'Conectar carpeta'}
        </button>
      </form>
      <p className="connector__meta">Abre la carpeta en drive.google.com y copia el enlace de la barra de direcciones. Eddie mira lo que hay dentro, incluidas las subcarpetas.</p>

      {!docsConnected && (
        <p className="connectors__warning" role="status">
          Para que Eddie pueda leer el texto de los documentos y hojas de esas carpetas, conecta también «Google Docs y Sheets».
        </p>
      )}
      {error && (
        <p className="connectors__warning" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
