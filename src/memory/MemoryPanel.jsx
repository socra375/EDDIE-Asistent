import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { deleteAllEpisodes, deleteEpisode, listEpisodes } from '../services/episodes';
import { useWakeWord } from '../context/wakeWordState';
import { cleanWakeWord, cleanFollowUpSeconds, DEFAULT_WAKE_WORD, DEFAULT_FOLLOW_UP_SECONDS, MAX_FOLLOW_UP_SECONDS } from '../services/wakeWord';
import Icon from '../layout/Icon';
import { CATEGORIES, countItems, pruneExpired } from '../services/memory';
import MemoryOrb from './MemoryOrb';
import './Memory.css';

const EMPTY_FORM = { key: '', text: '', days: '7', project: '', name: '', status: '', stack: '', repo: '', lastChange: '', nextGoal: '' };
const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

const ORB_CATEGORIES = [...CATEGORIES, { id: 'episodes', label: 'Conversaciones' }];

// What each point of the orb says when you point at it.
function orbText(category, item) {
  if (category === 'projects') return [item.name, item.status && `(${item.status})`, item.nextGoal && `Próximo: ${item.nextGoal}`].filter(Boolean).join(' ');
  if (category === 'profile' || category === 'preferences') return `${item.key}: ${item.text}`;
  return item.text;
}

function orbItemsOf(memory, episodes) {
  const items = [];
  for (const c of CATEGORIES) {
    for (const item of memory[c.id] || []) {
      items.push({
        id: item.id,
        category: c.id,
        label: c.label,
        text: orbText(c.id, item),
        meta: c.id === 'context' ? `vigente hasta ${fmtDate(item.expiresAt)}` : '',
        kind: 'memory',
        forgettable: true,
      });
    }
  }
  for (const e of episodes) {
    items.push({
      id: `ep-${e.id}`,
      category: 'episodes',
      label: 'Conversación',
      text: e.summary,
      meta: `${fmtDate(e.createdAt)}${e.source === 'telegram' ? ' · Telegram' : ''}`,
      kind: 'episode',
      forgettable: true,
      rawId: e.id,
    });
  }
  return items;
}

function ItemBody({ category, item }) {
  if (category === 'projects') {
    const rows = [
      ['Estado', item.status],
      ['Stack', item.stack],
      ['Repo', item.repo],
      ['Último cambio', item.lastChange],
      ['Próximo objetivo', item.nextGoal],
    ].filter(([, v]) => v);
    return (
      <div className="memory-item__body">
        <strong>{item.name}</strong>
        {rows.map(([label, value]) => (
          <span key={label} className="memory-item__row">
            <span>{label}</span> {value}
          </span>
        ))}
      </div>
    );
  }
  if (category === 'profile' || category === 'preferences') {
    return (
      <div className="memory-item__body">
        <span className="memory-item__row">
          <span>{item.key}</span> {item.text}
        </span>
      </div>
    );
  }
  return (
    <div className="memory-item__body">
      <span className="memory-item__row">{item.text}</span>
      {category === 'decisions' && item.project && <span className="memory-item__meta">Proyecto: {item.project}</span>}
      {category === 'context' && <span className="memory-item__meta">Vigente hasta {fmtDate(item.expiresAt)}</span>}
    </div>
  );
}

const WAKE_STATUS = {
  off: 'Desactivada',
  unsupported: 'Tu navegador no permite escuchar una palabra clave (usa Chrome o Edge).',
  paused: 'En pausa mientras hablas con Eddie o él contesta.',
  retrying: 'El navegador no logra escuchar ahora y sigue intentándolo (puede ser la conexión o que otra app use el micrófono).',
  denied: 'El navegador bloqueó el micrófono: permítelo en el candado de la barra de direcciones.',
  error: 'No se pudo escuchar (micrófono ocupado o sin conexión).',
};

// The phrase that wakes Eddie by voice. Lives here, next to what Eddie knows
// about the user, because it is part of how Eddie is set up for them.
function WakeWordCard() {
  const { settings, updateWakeSettings } = useSettings();
  const wake = useWakeWord();
  const [draft, setDraft] = useState(settings.wake?.word || DEFAULT_WAKE_WORD);
  const [saved, setSaved] = useState('');
  const clean = cleanWakeWord(draft);

  function saveWord(e) {
    e.preventDefault();
    if (!clean) return;
    updateWakeSettings({ word: clean });
    setDraft(clean);
    setSaved(`Listo: ahora despierto con “${clean}”.`);
  }

  const statusText = wake.waiting
    ? `Eddie te escucha: tienes ${wake.secondsLeft} s para responder, sin decir la palabra…`
    : wake.status === 'listening'
      ? `Escuchando la palabra “${wake.word}”…`
      : WAKE_STATUS[wake.status] || '';

  return (
    <section className="glass-panel memory__wake" aria-label="Palabra clave de activación">
      <h3>Palabra clave de activación</h3>
      <p className="memory__wake-desc">
        Di la palabra y Eddie te escucha, sin tocar nada. Puedes decirla y seguir hablando (“{wake.word}, ¿qué tengo hoy?”) o decirla sola y
        hablar después. Para apagar el micrófono di “{wake.word}, suspéndete” o “apágate”; para volver a encenderlo, actívalo aquí.
      </p>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={wake.enabled}
          onChange={(e) => {
            updateWakeSettings({ enabled: e.target.checked });
            wake.retry();
          }}
        />
        <span>Escuchar la palabra clave</span>
      </label>
      <form className="memory__wake-form" onSubmit={saveWord}>
        <label className="memory__field">
          <span>Palabra o frase</span>
          <input
            className="input"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSaved('');
            }}
            maxLength={30}
            aria-label="Palabra clave"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!clean || clean === (settings.wake?.word || DEFAULT_WAKE_WORD)}>
          Guardar palabra
        </button>
      </form>
      <label className="memory__field memory__wake-wait">
        <span>Tiempo de espera tras responder (segundos)</span>
        <input
          className="input"
          type="number"
          min="0"
          max={MAX_FOLLOW_UP_SECONDS}
          step="1"
          value={settings.wake?.followUpSeconds ?? DEFAULT_FOLLOW_UP_SECONDS}
          onChange={(e) => updateWakeSettings({ followUpSeconds: cleanFollowUpSeconds(e.target.value) })}
          aria-label="Tiempo de espera en segundos"
        />
      </label>
      <p className="memory__wake-desc">
        {wake.followUp > 0
          ? `Cuando Eddie termina de responder, te espera ${wake.followUp} s para que sigas hablando sin repetir la palabra. Si no dices nada, vuelve a esperar la palabra clave. Con 0 hay que decirla cada vez.`
          : 'Desactivado: hay que decir la palabra clave cada vez que quieras hablarle.'}
      </p>
      {!clean && <p className="memory__warn">Usa al menos 3 letras (mejor una palabra poco común, así no se activa sola).</p>}
      {saved && <p className="memory__notice" role="status">{saved}</p>}
      {wake.enabled && (
        <p className={`memory__wake-status memory__wake-status--${wake.waiting ? 'waiting' : wake.status}`} role="status">
          {statusText}
          {(wake.status === 'denied' || wake.status === 'error') && (
            <button type="button" className="btn" onClick={wake.retry}>
              Reintentar
            </button>
          )}
        </p>
      )}
      {wake.enabled && wake.status === 'listening' && wake.heard && <p className="memory__wake-heard">Lo último que oí: “{wake.heard}”</p>}
      <p className="memory__wake-note">
        Funciona con Eddie abierto en una pestaña del navegador. El navegador procesa el audio con su servicio de voz (en Chrome, el de Google) y
        Eddie solo reacciona a lo que empieza con la palabra clave; no guarda lo demás.
      </p>
    </section>
  );
}

const fmtLongDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });

// The notes of past conversations, loaded once for the orb and the card.
function useEpisodes() {
  const { user } = useAuth();
  const [state, setState] = useState({ status: 'loading', episodes: [], configured: true, error: '' });

  const apply = useCallback((data) => setState({ status: 'ready', episodes: data.episodes || [], configured: data.configured !== false, error: '' }), []);
  const fail = useCallback((err) => setState((s) => ({ ...s, status: 'error', error: err.message })), []);

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    listEpisodes().then((data) => alive && apply(data), (err) => alive && fail(err));
    return () => {
      alive = false;
    };
  }, [user, apply, fail]);

  const remove = useCallback(
    async (id) => {
      setState((s) => ({ ...s, episodes: s.episodes.filter((e) => e.id !== id) }));
      try {
        await deleteEpisode(id);
      } catch (err) {
        setState((s) => ({ ...s, error: err.message }));
        listEpisodes().then(apply, fail);
      }
    },
    [apply, fail],
  );

  const removeAll = useCallback(async () => {
    try {
      await deleteAllEpisodes();
      setState((s) => ({ ...s, episodes: [], error: '' }));
    } catch (err) {
      setState((s) => ({ ...s, error: err.message }));
    }
  }, []);

  return { user, state, remove, removeAll };
}

// The notes Eddie keeps of past conversations (conversation memory): when
// they are made, what they say, and the way to delete them. They are written
// on the server and only exist for signed-in users.
function ConversationMemoryCard({ episodes: data }) {
  const { user, state, remove, removeAll: dropAll } = data;
  const { settings, setConnectorEnabled } = useSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const memoryOn = settings.memoryEnabled !== false;
  const enabled = memoryOn && !(settings.disabledConnectors || []).includes('conversations');

  function removeAll() {
    setConfirmAll(false);
    dropAll();
  }

  const { episodes } = state;
  return (
    <section className="glass-panel memory__episodes" aria-label="Conversaciones recordadas">
      <header className="memory-card__head">
        <h3>Conversaciones recordadas</h3>
        {user && <span className="chip">{episodes.length}</span>}
      </header>
      <p className="memory__wake-desc">
        Cuando una conversación termina (5 minutos sin hablar, al cambiar de chat o al cerrar la pestaña), Eddie guarda un resumen corto, nunca la conversación
        completa. Así, si más adelante vuelves a un tema, lo recuerda. También las de Telegram. Aquí las ves y las borras.
      </p>
      <label className="settings-toggle">
        <input type="checkbox" checked={enabled} disabled={!memoryOn} onChange={(e) => setConnectorEnabled('conversations', e.target.checked)} />
        <span>Recordar mis conversaciones</span>
      </label>
      {!memoryOn && <p className="memory__warn">La memoria está apagada, así que tampoco se guardan conversaciones.</p>}
      {!user ? (
        <p className="memory-card__empty">Inicia sesión con Google para que Eddie recuerde tus conversaciones (se guardan en tu cuenta).</p>
      ) : state.status === 'loading' && episodes.length === 0 ? (
        <p className="memory-card__empty">Cargando…</p>
      ) : !state.configured ? (
        <p className="memory-card__empty">El servidor todavía no tiene configurada esta función (faltan GEMINI_API_KEY o la base de datos en Vercel).</p>
      ) : episodes.length === 0 ? (
        <p className="memory-card__empty">Todavía no hay recuerdos. Se crean solos cuando conversas un rato con Eddie.</p>
      ) : (
        <>
          <ul className="memory-card__list">
            {episodes.map((e) => (
              <li key={e.id} className="memory-item">
                <div className="memory-item__body">
                  <span className="memory-item__meta">
                    {fmtLongDate(e.createdAt)}
                    {e.source === 'telegram' ? ' · Telegram' : ''}
                  </span>
                  <span className="memory-item__row">{e.summary}</span>
                </div>
                <span className="memory-item__actions">
                  <button type="button" className="btn tasks-delete" onClick={() => remove(e.id)} aria-label="Borrar este recuerdo">
                    <Icon name="close" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {confirmAll ? (
            <span className="memory__confirm">
              ¿Borrar todos?
              <button type="button" className="btn btn-danger" onClick={removeAll}>
                Sí, borrar
              </button>
              <button type="button" className="btn" onClick={() => setConfirmAll(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-danger memory__episodes-clear" onClick={() => setConfirmAll(true)}>
              Borrar todas las conversaciones recordadas
            </button>
          )}
        </>
      )}
      {state.error && <p className="memory__warn" role="alert">{state.error}</p>}
    </section>
  );
}

// What Eddie knows about the user, by category, with everything visible and
// deletable, plus a form to add things by hand. Eddie's own additions (the
// remember / update_project tools) appear here as soon as the answer ends.
export default function MemoryPanel() {
  const { settings, updateSettings, memory, rememberFact, saveProject, forgetItem, forgetEverything } = useSettings();
  const [category, setCategory] = useState('profile');
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState('');
  const live = pruneExpired(memory);
  const total = countItems(live);
  const episodes = useEpisodes();
  const orbItems = useMemo(() => orbItemsOf(live, episodes.state.episodes), [live, episodes.state.episodes]);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    let saved = false;
    if (category === 'projects') {
      saved = saveProject({ name: form.name, status: form.status, stack: form.stack, repo: form.repo, lastChange: form.lastChange, nextGoal: form.nextGoal });
    } else {
      saved = rememberFact({ category, key: form.key, text: form.text, project: form.project, days: Number(form.days) });
    }
    setNotice(saved ? 'Guardado.' : settings.memoryEnabled ? 'Nada nuevo que guardar (¿falta algún dato o ya existía?).' : 'La memoria está apagada.');
    if (saved) setForm(EMPTY_FORM);
  }

  function edit(project) {
    setCategory('projects');
    setForm({ ...EMPTY_FORM, name: project.name, status: project.status, stack: project.stack, repo: project.repo, lastChange: project.lastChange, nextGoal: project.nextGoal });
    setNotice('');
  }

  const keyed = category === 'profile' || category === 'preferences';
  const valid = category === 'projects' ? form.name.trim() : keyed ? form.key.trim() && form.text.trim() : form.text.trim();

  return (
    <section className="memory" aria-label="Memoria de Eddie">
      <div className="glass-panel memory__summary">
        <p>
          Esto es lo que Eddie recuerda de ti entre conversaciones. Lo guarda cuando le cuentas algo que conviene recordar, y en cada respuesta usa solo lo que
          viene al caso. Puedes añadir, revisar y borrar todo desde aquí.
        </p>
        <div className="memory__bar">
          <label className="settings-toggle">
            <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })} />
            <span>Permitir que Eddie recuerde</span>
          </label>
          <span className="chip">{total} {total === 1 ? 'recuerdo' : 'recuerdos'}</span>
          {confirmClear ? (
            <span className="memory__confirm">
              ¿Borrar todo?
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  forgetEverything();
                  setConfirmClear(false);
                }}
              >
                Sí, borrar
              </button>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                No
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmClear(true)} disabled={total === 0}>
              Borrar toda la memoria
            </button>
          )}
        </div>
        {!settings.memoryEnabled && <p className="memory__warn">La memoria está apagada: Eddie no la consulta ni guarda nada nuevo.</p>}
      </div>

      <MemoryOrb
        items={orbItems}
        categories={ORB_CATEGORIES}
        onForget={(item) => (item.kind === 'episode' ? episodes.remove(item.rawId) : forgetItem(item.id))}
      />

      <ConversationMemoryCard episodes={episodes} />

      <WakeWordCard />

      <form className="glass-panel memory__form" onSubmit={submit} aria-label="Añadir a la memoria">
        <h3>Añadir a la memoria</h3>
        <div className="memory__fields">
          <label className="memory__field">
            <span>Categoría</span>
            <select
              className="input"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setNotice('');
              }}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {keyed && (
            <label className="memory__field">
              <span>Nombre del dato</span>
              <input className="input" value={form.key} onChange={set('key')} placeholder={category === 'profile' ? 'nombre, ciudad, trabajo…' : 'tono, formato…'} maxLength={60} />
            </label>
          )}
          {category === 'projects' ? (
            <>
              <label className="memory__field">
                <span>Proyecto</span>
                <input className="input" value={form.name} onChange={set('name')} placeholder="Gestor Empresarial" maxLength={60} />
              </label>
              <label className="memory__field">
                <span>Estado</span>
                <input className="input" value={form.status} onChange={set('status')} placeholder="producción" maxLength={160} />
              </label>
              <label className="memory__field">
                <span>Stack</span>
                <input className="input" value={form.stack} onChange={set('stack')} placeholder="React, Node, Postgres" maxLength={160} />
              </label>
              <label className="memory__field">
                <span>Repo de GitHub</span>
                <input className="input" value={form.repo} onChange={set('repo')} placeholder="dueño/nombre" maxLength={100} />
              </label>
              <label className="memory__field">
                <span>Último cambio</span>
                <input className="input" value={form.lastChange} onChange={set('lastChange')} maxLength={160} />
              </label>
              <label className="memory__field">
                <span>Próximo objetivo</span>
                <input className="input" value={form.nextGoal} onChange={set('nextGoal')} maxLength={160} />
              </label>
            </>
          ) : (
            <label className="memory__field memory__field--wide">
              <span>{keyed ? 'Valor' : 'Qué recordar'}</span>
              <input className="input" value={form.text} onChange={set('text')} maxLength={300} />
            </label>
          )}
          {category === 'decisions' && (
            <label className="memory__field">
              <span>Proyecto (opcional)</span>
              <input className="input" value={form.project} onChange={set('project')} maxLength={60} />
            </label>
          )}
          {category === 'context' && (
            <label className="memory__field">
              <span>Días vigente</span>
              <input className="input" type="number" min="1" max="60" value={form.days} onChange={set('days')} />
            </label>
          )}
        </div>
        <div className="memory__actions">
          <button type="submit" className="btn btn-primary" disabled={!valid}>
            <Icon name="plus" size={14} /> Guardar
          </button>
          {notice && <span className="memory__notice" role="status">{notice}</span>}
        </div>
      </form>

      <div className="memory__grid">
        {CATEGORIES.map((c) => (
          <article key={c.id} className="glass-panel memory-card" aria-label={c.label}>
            <header className="memory-card__head">
              <h3>{c.label}</h3>
              <span className="chip">{live[c.id].length}</span>
            </header>
            {live[c.id].length === 0 ? (
              <p className="memory-card__empty">{c.hint}</p>
            ) : (
              <ul className="memory-card__list">
                {live[c.id].map((item) => (
                  <li key={item.id} className="memory-item">
                    <ItemBody category={c.id} item={item} />
                    <span className="memory-item__actions">
                      {c.id === 'projects' && (
                        <button type="button" className="btn" onClick={() => edit(item)} aria-label={`Editar ${item.name}`}>
                          Editar
                        </button>
                      )}
                      <button type="button" className="btn tasks-delete" onClick={() => forgetItem(item.id)} aria-label="Olvidar este recuerdo">
                        <Icon name="close" size={14} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
