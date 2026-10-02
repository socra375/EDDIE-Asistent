import { useEffect, useRef, useState } from 'react';
import { useNotes } from '../context/notesState';
import Icon from '../layout/Icon';
import { DURATION_CHOICES, MAX_MINUTES, cleanMinutes, countWords, formatClock, formatMinutes } from '../services/dictation';
import { noteTitle } from '../services/notes';
import './Notes.css';

const fmtDate = (t) => new Date(t).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const STATUS = {
  unsupported: 'Este navegador no puede dictar. Usa Chrome o Edge.',
  starting: 'Preparando el micrófono…',
  listening: 'Escuchando: habla con normalidad.',
  denied: 'El navegador bloqueó el micrófono. Permítelo en el candado de la barra de direcciones y vuelve a dictar.',
  error: 'No pude abrir el micrófono. Revisa que esté conectado y que ninguna otra pestaña lo use.',
};

function statusText(notes) {
  if (notes.phase === 'waiting') return 'Eddie está terminando de hablar…';
  if (notes.status === 'retrying') return 'La conexión del dictado se cortó; reintento…';
  return STATUS[notes.status] || '';
}

function download(note) {
  const text = `${noteTitle(note)}\n\n${note.body}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${noteTitle(note).replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 40) || 'nota'}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function NotesPanel() {
  const notes = useNotes();
  const { active, dictating, dictatingId } = notes;
  const [custom, setCustom] = useState('');
  const [confirmId, setConfirmId] = useState(null); // sheet whose "Borrar" is waiting for a yes
  const [copiedId, setCopiedId] = useState(null);
  const confirmDelete = confirmId === active?.id;
  const copied = copiedId === active?.id;
  const paper = useRef(null);
  const writing = dictating && dictatingId === active?.id;

  // The sheet follows the text while it is being written.
  useEffect(() => {
    if (writing && paper.current) paper.current.scrollTop = paper.current.scrollHeight;
  }, [writing, active?.body, notes.interim]);

  function pickMinutes(minutes) {
    setCustom('');
    notes.setMinutes(minutes);
  }

  function applyCustom(value) {
    setCustom(value);
    if (value !== '') notes.setMinutes(cleanMinutes(value, notes.prefs.minutes));
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(active.body);
      const id = active.id;
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard blocked: the text can still be selected by hand */
    }
  }

  const minutes = notes.prefs.minutes;
  const message = dictating ? statusText(notes) : '';
  const words = countWords(active?.body);
  const low = dictating && notes.phase === 'on' && notes.secondsLeft <= 30;

  return (
    <section className="notes" aria-label="Notas">
      <aside className="notes__list glass-panel">
        <header>
          <h2>Hojas</h2>
          <button type="button" className="btn" onClick={() => notes.createNote()} disabled={dictating}>
            <Icon name="plus" size={14} /> Nueva hoja
          </button>
        </header>
        {notes.notes.length === 0 ? (
          <p className="notes__empty">Aún no hay hojas. Pulsa «Dictar» o di «Eddie, toma notas durante 10 minutos».</p>
        ) : (
          <ul>
            {notes.notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`notes__item ${n.id === active?.id ? 'notes__item--on' : ''}`}
                  onClick={() => notes.setActive(n.id)}
                  disabled={dictating && n.id !== dictatingId}
                  title={dictating && n.id !== dictatingId ? 'Termina el dictado para cambiar de hoja' : ''}
                >
                  <strong>
                    {dictatingId === n.id && <span className="notes__rec" aria-label="Escuchando" />}
                    {noteTitle(n)}
                  </strong>
                  <span>
                    {fmtDate(n.updatedAt)} · {countWords(n.body)} palabras
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="notes__sheet glass-panel">
        <div className="notes__bar">
          <div className="notes__time" role="group" aria-label="Cuánto debe durar la nota">
            <span className="notes__label">Duración</span>
            {DURATION_CHOICES.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${!custom && minutes === m ? 'on' : ''}`}
                aria-pressed={!custom && minutes === m}
                disabled={dictating}
                onClick={() => pickMinutes(m)}
              >
                {m >= 60 ? `${m / 60} h` : `${m} min`}
              </button>
            ))}
            <label className="notes__custom">
              <input
                className="input"
                type="number"
                min="1"
                max={MAX_MINUTES}
                inputMode="numeric"
                placeholder="otro"
                value={custom}
                disabled={dictating}
                onChange={(e) => applyCustom(e.target.value)}
                aria-label={`Minutos (1 a ${MAX_MINUTES})`}
              />
              <span>min</span>
            </label>
          </div>

          <div className="notes__controls">
            {dictating ? (
              <>
                <span className={`notes__clock ${low ? 'notes__clock--low' : ''}`} aria-live="off">
                  {notes.phase === 'on' ? formatClock(notes.secondsLeft) : formatClock(notes.totalMinutes * 60)}
                </span>
                {notes.phase === 'on' && (
                  <button type="button" className="btn" onClick={() => notes.extend(5)}>
                    +5 min
                  </button>
                )}
                <button type="button" className="btn btn-danger" onClick={() => notes.stopDictation('manual')}>
                  <Icon name="close" size={14} /> Detener
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" disabled={!notes.supported} onClick={() => notes.startDictation({ minutes })}>
                <Icon name="mic" size={14} /> Dictar {formatMinutes(minutes)}
              </button>
            )}
          </div>
        </div>

        {(message || !notes.supported) && (
          <p className={`notes__status notes__status--${dictating ? notes.status : 'unsupported'}`} role="status">
            {dictating ? message : STATUS.unsupported}
          </p>
        )}

        {active ? (
          <>
            <input
              className="input notes__title"
              value={active.title}
              maxLength={120}
              placeholder={writing ? 'Título (opcional)' : noteTitle(active) === 'Hoja en blanco' ? 'Título (opcional)' : noteTitle(active)}
              onChange={(e) => notes.updateNote(active.id, { title: e.target.value })}
              aria-label="Título de la nota"
            />
            <div className="notes__paper-wrap">
              <textarea
                ref={paper}
                className={`notes__paper ${writing ? 'notes__paper--live' : ''}`}
                value={active.body}
                onChange={(e) => notes.updateNote(active.id, { body: e.target.value })}
                placeholder="Hoja en blanco. Escribe aquí, o pulsa «Dictar» y habla: Eddie lo va anotando."
                aria-label="Hoja de notas"
                spellCheck
              />
              {writing && notes.interim && (
                <p className="notes__interim" aria-live="off">
                  {notes.interim}…
                </p>
              )}
            </div>
            <footer className="notes__foot">
              <span>
                {words} {words === 1 ? 'palabra' : 'palabras'}
              </span>
              <label className="settings-toggle notes__punct" title="Si lo apagas, «coma» y «punto» se escriben como palabras.">
                <span>Puntuación hablada</span>
                <input type="checkbox" checked={notes.prefs.punctuation} onChange={(e) => notes.setPunctuation(e.target.checked)} />
              </label>
              <span className="notes__actions">
                <button type="button" className="btn" onClick={copy} disabled={!active.body}>
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button type="button" className="btn" onClick={() => download(active)} disabled={!active.body}>
                  Descargar .txt
                </button>
                {confirmDelete ? (
                  <>
                    <button type="button" className="btn btn-danger" onClick={() => notes.deleteNote(active.id)}>
                      Sí, borrar
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmId(null)}>
                      No
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-danger" onClick={() => setConfirmId(active.id)}>
                    <Icon name="trash" size={14} /> Borrar
                  </button>
                )}
              </span>
            </footer>
            <p className="notes__hint">
              Di «coma», «punto», «punto y aparte» o «nueva línea» para puntuar. «Fin de la nota» termina el dictado. Las hojas se guardan en este dispositivo.
            </p>
          </>
        ) : (
          <div className="notes__blank">
            <p>No hay ninguna hoja abierta.</p>
            <button type="button" className="btn btn-primary" onClick={() => notes.createNote()}>
              <Icon name="plus" size={14} /> Nueva hoja
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
