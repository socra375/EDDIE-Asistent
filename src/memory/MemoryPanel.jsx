import { useState } from 'react';
import { useSettings } from '../context/SettingsContext';
import Icon from '../layout/Icon';
import { CATEGORIES, countItems, pruneExpired } from '../services/memory';
import './Memory.css';

const EMPTY_FORM = { key: '', text: '', days: '7', project: '', name: '', status: '', stack: '', lastChange: '', nextGoal: '' };
const fmtDate = (t) => new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short' });

function ItemBody({ category, item }) {
  if (category === 'projects') {
    const rows = [
      ['Estado', item.status],
      ['Stack', item.stack],
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
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  function submit(e) {
    e.preventDefault();
    let saved = false;
    if (category === 'projects') {
      saved = saveProject({ name: form.name, status: form.status, stack: form.stack, lastChange: form.lastChange, nextGoal: form.nextGoal });
    } else {
      saved = rememberFact({ category, key: form.key, text: form.text, project: form.project, days: Number(form.days) });
    }
    setNotice(saved ? 'Guardado.' : settings.memoryEnabled ? 'Nada nuevo que guardar (¿falta algún dato o ya existía?).' : 'La memoria está apagada.');
    if (saved) setForm(EMPTY_FORM);
  }

  function edit(project) {
    setCategory('projects');
    setForm({ ...EMPTY_FORM, name: project.name, status: project.status, stack: project.stack, lastChange: project.lastChange, nextGoal: project.nextGoal });
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
