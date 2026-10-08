import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { deleteAllEpisodes, deleteEpisode, listEpisodes } from '../services/episodes';
import { useWakeWord } from '../context/wakeWordState';
import { SENSITIVITY, cleanSensitivity } from '../services/clap';
import { cleanWakeWord, cleanFollowUpSeconds, DEFAULT_WAKE_WORD, DEFAULT_FOLLOW_UP_SECONDS, MAX_FOLLOW_UP_SECONDS } from '../services/wakeWord';
import Icon from '../layout/Icon';
import { CATEGORIES, countItems, pruneExpired } from '../services/memory';
import MemoryOrb from './MemoryOrb';
import KnowledgeCard from './KnowledgeCard';
import BusinessBrain from './BusinessBrain';
import BrainDrop from './BrainDrop';
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

// The fields of a project, for the pinned detail.
function projectRows(item) {
  return [
    ['Estado', item.status],
    ['Stack', item.stack],
    ['Repo', item.repo],
    ['Último cambio', item.lastChange],
    ['Próximo objetivo', item.nextGoal],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => ({ label, value }));
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
        ...(c.id === 'projects' ? { title: item.name, rows: projectRows(item), editable: true, raw: item } : {}),
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

const WAKE_STATUS = {
  off: 'Desactivada',
  starting: 'Iniciando el micrófono…',
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

const CLAP_STATUS = {
  starting: 'Iniciando el micrófono…',
  listening: 'Esperando dos aplausos…',
  paused: 'En pausa mientras hablas con Eddie o él contesta.',
  unsupported: 'Tu navegador no permite escuchar el micrófono de esta forma (usa Chrome o Edge).',
  denied: 'El navegador bloqueó el micrófono: permítelo en el candado de la barra de direcciones.',
  error: 'No se pudo usar el micrófono (¿lo usa otra app?).',
};

// A live level meter for the clap detector: what the microphone hears, the level a clap must reach,
// what was counted and, when a loud sound did not count, why. Reads a ref a few times a second.
function ClapMeter({ getMeter }) {
  const [m, setM] = useState(() => getMeter());
  useEffect(() => {
    const timer = window.setInterval(() => setM({ ...getMeter() }), 150);
    return () => window.clearInterval(timer);
  }, [getMeter]);
  if (!m?.listening) return null;
  const scale = (v) => Math.min(100, Math.sqrt(Math.max(0, v)) * 100);
  const silent = m.silentMs > 2500;
  return (
    <div className="clap-meter" aria-label="Nivel del micrófono">
      <div className="clap-meter__bar" role="img" aria-label={`Nivel ${Math.round(m.level * 100)} %, umbral ${Math.round(m.threshold * 100)} %`}>
        <i style={{ width: `${scale(m.level)}%` }} />
        <b style={{ left: `${scale(m.threshold)}%` }} title="Un aplauso debe pasar esta marca" />
      </div>
      <p className="clap-meter__facts">
        Nivel {(m.level * 100).toFixed(1)} % · marca {(m.threshold * 100).toFixed(1)} % · ruido del cuarto {(m.floor * 100).toFixed(1)} % · aplausos oídos {m.claps} · dobles {m.doubles}
      </p>
      {silent ? (
        <p className="memory__warn">No me llega nada de audio (nivel 0): revisa que el micrófono no esté silenciado ni bloqueado en el equipo o en el navegador.</p>
      ) : (
        m.reason && <p className="clap-meter__reason">Último sonido fuerte que no conté: {m.reason}.</p>
      )}
      <p className="memory__wake-note">Aplaude dos veces seguidas mirando la barra: tiene que cruzar la marca. Si la cruza y no cuenta, mira el motivo; si no la cruza, sube la sensibilidad.</p>
    </div>
  );
}
// Two claps wake Eddie, like saying the word alone: a chime and the microphone opens.
function ClapCard() {
  const { settings, updateWakeSettings } = useSettings();
  const wake = useWakeWord();
  const sensitivity = cleanSensitivity(settings.wake?.clapSensitivity);

  return (
    <section className="glass-panel memory__wake" aria-label="Activar con dos aplausos">
      <h3>Activar con dos aplausos</h3>
      <p className="memory__wake-desc">
        Aplaude dos veces seguidas y Eddie suena y te escucha, sin tocar nada ni decir la palabra clave. Para apagarlo di “{wake.word}, suspéndete”
        o desactívalo aquí.
      </p>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={wake.clapEnabled}
          disabled={!wake.clapSupported}
          onChange={(e) => {
            updateWakeSettings({ clap: e.target.checked });
            wake.clapRetry();
          }}
        />
        <span>Despertar a Eddie con dos aplausos</span>
      </label>
      <label className="memory__field memory__wake-wait">
        <span className="field-label">Sensibilidad</span>
        <select className="select" value={sensitivity} onChange={(e) => updateWakeSettings({ clapSensitivity: e.target.value })}>
          {Object.entries(SENSITIVITY).map(([id, v]) => (
            <option key={id} value={id}>
              {v.label}
            </option>
          ))}
        </select>
      </label>
      {wake.clapEnabled && (
        <p className={`memory__wake-status memory__wake-status--${wake.clapStatus}`} role="status">
          {CLAP_STATUS[wake.clapStatus] || ''}
          {(wake.clapStatus === 'denied' || wake.clapStatus === 'error') && (
            <button type="button" className="btn" onClick={wake.clapRetry}>
              Reintentar
            </button>
          )}
        </p>
      )}
      {wake.clapEnabled && wake.clapStatus === 'listening' && <ClapMeter getMeter={wake.clapMeter} />}
      <p className="memory__wake-note">
        Funciona con Eddie abierto en una pestaña del navegador (si la pestaña queda en segundo plano el navegador puede dormirla y no oír los
        aplausos). Mientras esté activo el navegador muestra que el micrófono está en uso; el audio se analiza en tu equipo y no se envía ni se
        guarda. Si se activa solo con ruidos, baja la sensibilidad; si no te oye, súbela.
      </p>
    </section>
  );
}

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

// Settings of the notes Eddie keeps of past conversations (written on the
// server, only for signed-in users). The notes themselves are points of the
// orb; here: on/off and "delete them all".
function ConversationSettings({ episodes: data }) {
  const { user, state, removeAll: dropAll } = data;
  const { settings, setConnectorEnabled } = useSettings();
  const [confirmAll, setConfirmAll] = useState(false);
  const memoryOn = settings.memoryEnabled !== false;
  const enabled = memoryOn && !(settings.disabledConnectors || []).includes('conversations');
  const count = state.episodes.length;

  function removeAll() {
    setConfirmAll(false);
    dropAll();
  }

  return (
    <section className="memory__settings-block" aria-label="Conversaciones recordadas">
      <h3>Conversaciones recordadas</h3>
      <p className="memory__wake-desc">
        Cuando una conversación termina (5 minutos sin hablar, al cambiar de chat o al cerrar la pestaña), Eddie guarda un resumen corto, nunca la conversación
        completa; también las de Telegram. Aparecen en el orbe.
      </p>
      <label className="settings-toggle">
        <input type="checkbox" checked={enabled} disabled={!memoryOn} onChange={(e) => setConnectorEnabled('conversations', e.target.checked)} />
        <span>Recordar mis conversaciones</span>
      </label>
      {!memoryOn && <p className="memory__warn">La memoria está apagada, así que tampoco se guardan conversaciones.</p>}
      {!user && <p className="memory-card__empty">Inicia sesión con Google para que Eddie recuerde tus conversaciones (se guardan en tu cuenta).</p>}
      {user && !state.configured && <p className="memory-card__empty">El servidor todavía no tiene configurada esta función (faltan GEMINI_API_KEY o la base de datos en Vercel).</p>}
      {user && state.configured && count > 0 &&
        (confirmAll ? (
          <span className="memory__confirm">
            ¿Borrar las {count}?
            <button type="button" className="btn btn-danger" onClick={removeAll}>
              Sí, borrar
            </button>
            <button type="button" className="btn" onClick={() => setConfirmAll(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-danger memory__episodes-clear" onClick={() => setConfirmAll(true)}>
            Borrar todas las conversaciones recordadas ({count})
          </button>
        ))}
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
  const formRef = useRef(null);
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
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const keyed = category === 'profile' || category === 'preferences';
  const valid = category === 'projects' ? form.name.trim() : keyed ? form.key.trim() && form.text.trim() : form.text.trim();

  return (
    <section className="memory" aria-label="Memoria de Eddie">
      <BrainDrop target="memory">
        <MemoryOrb
          items={orbItems}
          categories={ORB_CATEGORIES}
          onForget={(item) => (item.kind === 'episode' ? episodes.remove(item.rawId) : forgetItem(item.id))}
          onEdit={(item) => edit(item.raw)}
        />
      </BrainDrop>

      <form className="glass-panel memory__form" onSubmit={submit} aria-label="Agregar memoria" ref={formRef}>
        <h3>Agregar memoria</h3>
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
            <Icon name="plus" size={14} /> Guardar en el orbe
          </button>
          {notice && <span className="memory__notice" role="status">{notice}</span>}
        </div>
      </form>

      <KnowledgeCard />

      <BusinessBrain />

      <details className="glass-panel memory__settings">
        <summary>Ajustes de la memoria, palabra clave y aplausos</summary>
        <div className="memory__settings-body">
          <section className="memory__settings-block" aria-label="Memoria">
            <label className="settings-toggle">
              <input type="checkbox" checked={settings.memoryEnabled} onChange={(e) => updateSettings({ memoryEnabled: e.target.checked })} />
              <span>Permitir que Eddie recuerde</span>
            </label>
            {!settings.memoryEnabled && <p className="memory__warn">La memoria está apagada: Eddie no la consulta ni guarda nada nuevo.</p>}
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
                Borrar toda la memoria ({total})
              </button>
            )}
          </section>
          <ConversationSettings episodes={episodes} />
          <WakeWordCard />
          <ClapCard />
        </div>
      </details>
    </section>
  );
}
