import { useMemo, useReducer, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { mergeMemory, reviewMemory } from '../services/memory';
import { MAX_IMPORT_CHARS, dropBackup, exportFileName, exportMemory, mergeImport, parseMemoryExport, readBackup } from '../services/memoryBackup';

// localStorage can be missing or refuse (private windows): the tools then simply have no copy to offer.
const store = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: () => {},
  removeItem: (k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {
      // nothing to do
    }
  },
};

const KIND_LABEL = { secreto: 'Dato sensible', repetido: 'Repetido', sin_confirmar: 'Sin confirmar', historial: 'Historial', llena: 'Casi llena' };
const keyOf = (f) => `${f.kind}|${f.category}|${f.ids.join(',')}|${f.text}`;
const fmtDay = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'long' });

// Take the memory out, bring it back, get back what was just erased, and look through it for what to clean.
export default function MemoryTools() {
  const { memory, forgetItem, replaceMemory } = useSettings();
  const [notice, setNotice] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [dismissed, setDismissed] = useState(() => new Set());
  const fileRef = useRef(null);

  const [, refresh] = useReducer((n) => n + 1, 0);

  // The copy kept for a week after «Borrar toda la memoria»; read on every render (it is small and renders are rare),
  // so it shows up the moment the memory is erased and goes away the moment it expires.
  const backup = readBackup(store);
  const findings = useMemo(() => (reviewing ? reviewMemory(memory).filter((f) => !dismissed.has(keyOf(f))) : []), [reviewing, memory, dismissed]);

  function download() {
    const blob = new Blob([exportMemory(memory)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Descargué tu memoria. Guárdala donde quieras: no lleva contraseñas ni claves.');
  }

  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMPORT_CHARS) {
      setNotice('El archivo es demasiado grande para ser una memoria de Eddie.');
      return;
    }
    const parsed = parseMemoryExport(await file.text());
    if (parsed.error) {
      setNotice(parsed.error);
      return;
    }
    const { memory: merged, added } = mergeImport(memory, parsed.memory);
    replaceMemory(merged);
    setNotice(`${added ? `Sumé ${added} ${added === 1 ? 'recuerdo' : 'recuerdos'} a tu memoria` : 'No había nada nuevo que sumar'}${parsed.removed ? ` y dejé fuera ${parsed.removed} que parecían contraseñas o claves` : ''}.`);
  }

  function restore() {
    if (!backup) return;
    replaceMemory(mergeMemory(memory, backup.memory));
    dropBackup(store);
    setNotice('Recuperé tu memoria.');
  }

  function discard() {
    dropBackup(store);
    setNotice('Descarté la copia.');
    refresh();
  }

  function forgetFinding(f) {
    for (const id of f.ids) forgetItem(id);
    setNotice('Listo, lo olvidé.');
  }

  return (
    <section className="memory__settings-block memory-tools" aria-label="Copia y revisión de la memoria">
      <h3>Copia y revisión</h3>
      {backup && (
        <p className="memory__warn" role="status">
          Hay una copia de la memoria que borraste el {fmtDay(backup.at)} ({backup.count} recuerdos). Se descarta sola a los 7 días.
          <span className="memory-tools__row">
            <button type="button" className="btn" onClick={restore}>
              Recuperarla
            </button>
            <button type="button" className="btn" onClick={discard}>
              Descartarla
            </button>
          </span>
        </p>
      )}
      <div className="memory-tools__row">
        <button type="button" className="btn" onClick={download}>
          Descargar mi memoria
        </button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Sumar desde un archivo
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pick} aria-label="Archivo de memoria de Eddie" />
        <button type="button" className="btn" onClick={() => setReviewing((v) => !v)} aria-pressed={reviewing}>
          {reviewing ? 'Cerrar la revisión' : 'Revisar mi memoria'}
        </button>
      </div>
      {notice && (
        <span className="memory__notice" role="status">
          {notice}
        </span>
      )}
      {reviewing &&
        (findings.length ? (
          <ul className="memory-tools__list">
            {findings.map((f) => (
              <li key={keyOf(f)} className={`memory-tools__item memory-tools__item--${f.kind}`}>
                <strong>{KIND_LABEL[f.kind] || f.kind}</strong>
                <span>{f.text}</span>
                <small>{f.advice}</small>
                <span className="memory-tools__row">
                  {f.ids.length > 0 && (
                    <button type="button" className="btn btn-danger" onClick={() => forgetFinding(f)}>
                      Olvidar
                    </button>
                  )}
                  <button type="button" className="btn" onClick={() => setDismissed((d) => new Set(d).add(keyOf(f)))}>
                    Dejarlo
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="memory__notice">No veo nada que limpiar: sin datos sensibles, sin repetidos y sin deducciones viejas.</p>
        ))}
    </section>
  );
}
