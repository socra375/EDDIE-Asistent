import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from '../layout/Icon';
import { fileProblem, firstFile, ingestDocument } from '../services/brainDocs';
import { countsLabel } from '../services/brainKinds';
import { applyMemoryActions } from '../services/memoryActions';
import { categoryLabel } from '../services/knowledgeCategories';

const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

// What the user is told once a document is in.
function summaryOf(target, result, applied) {
  if (target === 'memory') {
    const what = countsLabel(result.counts) || 'información';
    return applied.length
      ? `Guardé en la memoria ${applied.length === 1 ? 'un dato' : `${applied.length} datos`} de «${result.name}»: ${what}.`
      : `Leí «${result.name}» (${what}), pero no había nada nuevo que guardar o la memoria está apagada.`;
  }
  const topic = result.topic || {};
  const extra = result.personal ? ` También tiene ${result.personal}: suéltalo sobre el orbe de Memoria si quieres guardarlos allí.` : '';
  return `«${topic.title}» entró al segundo cerebro como ${topic.kind === 'habilidad' ? 'habilidad' : 'tema'} (${categoryLabel(topic.category)}) con ${result.noteCount} notas${result.updated ? ' (actualicé lo que ya sabía)' : ''}.${extra}`;
}

// Wraps a brain so a Markdown file can be dropped on it (or picked with the
// button): the document is analysed and sorted by what it says. `target` is
// 'memory' (the first brain: Memoria's orb) or 'knowledge' (the second brain);
// `onDone(result)` runs after it is kept (the second brain reloads its list).
export default function BrainDrop({ target, onDone, children }) {
  const { user, login } = useAuth();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const depth = useRef(0);
  const alive = useRef(true);
  const inputRef = useRef(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const receive = useCallback(
    async (file) => {
      const problem = fileProblem(file);
      if (problem) return setMessage({ tone: 'bad', text: problem });
      if (!user) return setMessage({ tone: 'bad', text: 'Inicia sesión con Google para que Eddie pueda analizar documentos.' });
      setBusy(true);
      setMessage({ tone: 'wait', text: `Leyendo y clasificando «${file.name}»…` });
      try {
        const result = await ingestDocument(file, target);
        const applied = target === 'memory' ? applyMemoryActions(result.actions) : [];
        if (alive.current) setMessage({ tone: applied.length || target === 'knowledge' ? 'ok' : 'wait', text: `${summaryOf(target, result, applied)}${result.truncated ? ' (el documento era muy largo: analicé solo el principio)' : ''}` });
        onDone?.(result);
      } catch (err) {
        if (alive.current) setMessage({ tone: 'bad', text: err.message });
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [target, user, onDone],
  );

  const handlers = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setOver(true);
    },
    onDragOver: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      if (!busy) receive(firstFile(e.dataTransfer.files));
    },
  };

  const label = target === 'memory' ? 'Suelta aquí un .md: entra a la memoria, clasificado' : 'Suelta aquí un .md: entra al segundo cerebro';
  return (
    <div className={`brain-drop${over ? ' brain-drop--over' : ''}`} {...handlers}>
      {children}
      {over && (
        <div className="brain-drop__veil" aria-hidden="true">
          <Icon name="plus" size={22} />
          <span>{label}</span>
        </div>
      )}
      <div className="brain-drop__bar">
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          hidden
          onChange={(e) => {
            const file = firstFile(e.target.files);
            e.target.value = '';
            if (file) receive(file);
          }}
        />
        <button type="button" className="btn" disabled={busy} onClick={() => (user ? inputRef.current?.click() : login())}>
          <Icon name="plus" size={14} /> Subir documento .md
        </button>
        <span className="brain-drop__hint">o suéltalo sobre {target === 'memory' ? 'el orbe' : 'el mapa'}: Eddie lo lee y lo clasifica (datos, preferencias, habilidades, proyectos…).</span>
        {message.text && (
          <span className={`brain-drop__msg brain-drop__msg--${message.tone}`} role="status">
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}
