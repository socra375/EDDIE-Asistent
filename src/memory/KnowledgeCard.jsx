import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Icon from '../layout/Icon';
import { deleteNote, deleteTopic, getTopic, learnTopic, listTopics, setTopicCategory } from '../services/knowledge';
import { categoryLabel } from '../services/knowledgeCategories';
import BrainDrop from './BrainDrop';
import KnowledgeMap, { CategorySelect } from './KnowledgeMap';
import { colorOf } from './knowledgeMap';

const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });
// The research takes a while; these are the real stages in the order they happen.
const STAGES = ['Buscando en la web…', 'Leyendo varias páginas…', 'Resumiendo lo esencial…', 'Guardándolo en mi segundo cerebro…'];
const STAGE_MS = 6500;
const domain = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// Memoria → Segundo cerebro: teach Eddie a topic or skill ("Investiga y aprende X") and look after what he learned.
export default function KnowledgeCard() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', topics: [], configured: true, error: '' });
  const [draft, setDraft] = useState('');
  const [working, setWorking] = useState(null); // { topic, stage }
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(null); // { id, topic } with notes
  const [confirm, setConfirm] = useState('');
  const [selectedId, setSelectedId] = useState(null); // pinned on the map
  const alive = useRef(true);
  const listRef = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const data = await listTopics();
      if (alive.current) setState({ status: 'ready', topics: data.topics || [], configured: data.configured !== false, error: '' });
    } catch (err) {
      if (alive.current) setState((s) => ({ ...s, status: 'error', error: err.message }));
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

  // Moves the progress text along while the server works.
  useEffect(() => {
    if (!working) return undefined;
    const timer = window.setInterval(() => setWorking((w) => (w ? { ...w, stage: Math.min(w.stage + 1, STAGES.length - 1) } : w)), STAGE_MS);
    return () => window.clearInterval(timer);
  }, [working?.topic]); // eslint-disable-line react-hooks/exhaustive-deps

  const learn = async (topic) => {
    const clean = topic.trim();
    if (!clean || working) return;
    setNotice('');
    setState((s) => ({ ...s, error: '' }));
    setWorking({ topic: clean, stage: 0 });
    try {
      const out = await learnTopic(clean);
      if (!alive.current) return;
      setNotice(`${out.updated ? 'Actualicé' : 'Aprendí'} «${out.topic}»: ${out.noteCount} notas de ${out.sources.length} fuente${out.sources.length === 1 ? '' : 's'}.`);
      setDraft('');
      setOpen(null);
      await refresh();
    } catch (err) {
      if (alive.current) setState((s) => ({ ...s, error: err.message }));
    } finally {
      if (alive.current) setWorking(null);
    }
  };

  const toggle = async (topic) => {
    if (open?.id === topic.id) return setOpen(null);
    setOpen({ id: topic.id, topic: null });
    try {
      const { topic: full } = await getTopic(topic.id);
      if (alive.current) setOpen({ id: topic.id, topic: full });
    } catch (err) {
      if (alive.current) setState((s) => ({ ...s, error: err.message }));
    }
  };

  const changeCategory = async (topic, category) => {
    // The colour changes at once; if the server refuses, the list is reloaded.
    setState((s) => ({ ...s, topics: s.topics.map((t) => (t.id === topic.id ? { ...t, category } : t)) }));
    setOpen((o) => (o?.topic && o.id === topic.id ? { ...o, topic: { ...o.topic, category } } : o));
    try {
      await setTopicCategory(topic.id, category);
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
      refresh();
    }
  };

  // "Ver las notas" on the map: opens the topic in the list below and brings it into view.
  const openFromMap = async (topic) => {
    if (open?.id !== topic.id) await toggle(topic);
    window.setTimeout(() => listRef.current?.querySelector(`[data-topic="${topic.id}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), 60);
  };

  const forget = async (topic) => {
    setConfirm('');
    try {
      await deleteTopic(topic.id);
      if (open?.id === topic.id) setOpen(null);
      if (selectedId === topic.id) setSelectedId(null);
      await refresh();
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  };

  const removeNote = async (note) => {
    try {
      await deleteNote(note.id);
      setOpen((o) => (o?.topic ? { ...o, topic: { ...o.topic, notes: o.topic.notes.filter((n) => n.id !== note.id), noteCount: o.topic.noteCount - 1 } } : o));
      await refresh();
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  };

  const signedIn = Boolean(user) && state.configured;

  return (
    <BrainDrop target="knowledge" onDone={refresh}>
      {signedIn && (
        <KnowledgeMap
          topics={state.topics}
          learning={working?.topic || null}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={openFromMap}
          onCategory={changeCategory}
        />
      )}
    <section className="glass-panel knowledge" aria-label="Segundo cerebro">
      <h3>Segundo cerebro</h3>
      <p className="knowledge__desc">
        Dile a Eddie «Investiga y aprende…» (un tema o una habilidad), por voz o aquí. Lee varias páginas web, guarda lo esencial con su fuente y lo
        usa cuando le preguntes algo relacionado. Pueden pasar unos 30 segundos.
      </p>
      {!user ? (
        <p className="knowledge__note">Inicia sesión con Google (Configuración → Cuenta de Google) para usar el segundo cerebro.</p>
      ) : !state.configured ? (
        <p className="knowledge__note knowledge__note--bad">El segundo cerebro necesita DATABASE_URL y GEMINI_API_KEY en Vercel.</p>
      ) : (
        <>
          <form
            className="knowledge__form"
            onSubmit={(e) => {
              e.preventDefault();
              learn(draft);
            }}
          >
            <input
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Investiga y aprende… (un tema o habilidad; puedes explicar qué te interesa)"
              maxLength={300}
              aria-label="Tema que Eddie debe investigar y aprender"
              disabled={Boolean(working)}
            />
            <button type="submit" className="btn btn-primary" disabled={!draft.trim() || Boolean(working)}>
              <Icon name="search" size={14} /> Investigar y aprender
            </button>
          </form>
          {working && (
            <p className="knowledge__progress" role="status">
              <span className="knowledge__spinner" aria-hidden="true" /> «{working.topic}»: {STAGES[working.stage]}
            </p>
          )}
          {notice && !working && <p className="knowledge__notice" role="status">{notice}</p>}
          {state.error && <p className="knowledge__note knowledge__note--bad" role="alert">{state.error}</p>}
          {state.status === 'ready' && !state.topics.length && !working && <p className="knowledge__note">Todavía no aprendió nada. Pídele un tema y aparecerá aquí.</p>}
          <ul className="knowledge__list" ref={listRef}>
            {state.topics.map((topic) => {
              const expanded = open?.id === topic.id;
              return (
                <li key={topic.id} className="knowledge__item" data-topic={topic.id}>
                  <button type="button" className="knowledge__head" onClick={() => toggle(topic)} aria-expanded={expanded}>
                    <span className="knowledge__title">{topic.title}</span>
                    <span className="chip">{topic.kind === 'habilidad' ? 'HABILIDAD' : 'TEMA'}</span>
                    <span className="knowledge__cat" style={{ color: colorOf(topic.category) }}>
                      <i style={{ background: colorOf(topic.category) }} aria-hidden="true" />
                      {categoryLabel(topic.category)}
                    </span>
                    <span className="knowledge__meta">
                      {topic.noteCount} nota{topic.noteCount === 1 ? '' : 's'} · {topic.sourceCount} fuente{topic.sourceCount === 1 ? '' : 's'} · {fmtDate(topic.updatedAt)}
                    </span>
                  </button>
                  {expanded && (
                    <div className="knowledge__body">
                      <p className="knowledge__summary">{topic.summary}</p>
                      <CategorySelect value={topic.category} onChange={(category) => changeCategory(topic, category)} />
                      {open.topic ? (
                        <ul className="knowledge__notes">
                          {open.topic.notes.map((note) => (
                            <li key={note.id}>
                              <span>{note.content}</span>
                              {note.sourceUrl && (
                                <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="knowledge__source">
                                  {note.sourceTitle || domain(note.sourceUrl)} ({domain(note.sourceUrl)})
                                </a>
                              )}
                              {!note.sourceUrl && note.sourceTitle && <span className="knowledge__source">de «{note.sourceTitle}»</span>}
                              <button type="button" className="knowledge__x" onClick={() => removeNote(note)} aria-label="Quitar esta nota" title="Quitar esta nota">
                                ✕
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="knowledge__note">Cargando las notas…</p>
                      )}
                      <div className="knowledge__actions">
                        <button type="button" className="btn" onClick={() => learn(topic.title)} disabled={Boolean(working)}>
                          Actualizar (volver a investigar)
                        </button>
                        {confirm === topic.id ? (
                          <span className="memory__confirm">
                            ¿Olvidar este tema?
                            <button type="button" className="btn btn-danger" onClick={() => forget(topic)}>
                              Sí, olvidar
                            </button>
                            <button type="button" className="btn" onClick={() => setConfirm('')}>
                              No
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-danger" onClick={() => setConfirm(topic.id)}>
                            Olvidar tema
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="knowledge__note">
            Lo aprendido viene de páginas web: puede contener errores. Eddie lo usa como apoyo y nombra la fuente; lo ves y lo borras aquí. Se
            puede apagar en Conectores → Segundo cerebro.
          </p>
        </>
      )}
    </section>
    </BrainDrop>
  );
}
