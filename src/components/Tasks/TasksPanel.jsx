import { useEffect, useMemo, useState } from 'react';
import { getTasks, saveTasks } from '../../utils/storage';
import { useAuth } from '../../context/AuthContext';
import { remoteTasks, remoteCalendar } from '../../services/remote';
import './Tasks.css';

const PRIORITIES = { alta: 3, media: 2, baja: 1 };

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `task-${Date.now()}-${idCounter}`;
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diff / 86400000);
}

export default function TasksPanel() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState(() => getTasks());
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('media');
  const [filter, setFilter] = useState('pendientes');
  const [syncError, setSyncError] = useState('');
  const [syncingId, setSyncingId] = useState(null);

  // localStorage stays as the always-on offline cache, whether logged in or not.
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // On login, adopt the server's tasks as the source of truth — unless the
  // server has none yet and there's local work, in which case migrate it up
  // once so a first-time sign-in doesn't lose anything.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const remote = await remoteTasks.list();
        if (cancelled || !remote) return;
        if (remote.tasks.length === 0 && tasks.length > 0) {
          const migrated = [];
          for (const t of tasks) {
            const created = await remoteTasks.create({ title: t.title, dueDate: t.dueDate, priority: t.priority });
            if (created) migrated.push(created.task);
          }
          if (!cancelled) setTasks(migrated);
        } else {
          setTasks(remote.tasks);
        }
      } catch (err) {
        if (!cancelled) setSyncError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only re-run on login/logout transitions, not on every local task edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const draft = { title: title.trim(), dueDate: dueDate || null, priority };
    setTitle('');
    setDueDate('');
    setPriority('media');

    if (user) {
      try {
        const result = await remoteTasks.create(draft);
        if (result) {
          setTasks((prev) => [...prev, result.task]);
          return;
        }
      } catch (err) {
        setSyncError(err.message);
      }
    }
    setTasks((prev) => [...prev, { id: nextId(), ...draft, done: false }]);
  }

  function toggleDone(id) {
    const target = tasks.find((t) => t.id === id);
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    if (user && target) {
      remoteTasks.update(id, { done: !target.done }).catch((err) => setSyncError(err.message));
    }
  }

  function removeTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (user) {
      remoteTasks.remove(id).catch((err) => setSyncError(err.message));
    }
  }

  async function syncToCalendar(task) {
    setSyncError('');
    setSyncingId(task.id);
    try {
      const result = await remoteCalendar.createEventFromTask(task);
      if (result) {
        setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, googleEventId: result.eventId, googleEventLink: result.htmlLink } : t)));
        await remoteTasks.update(task.id, { googleEventId: result.eventId });
      }
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncingId(null);
    }
  }

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((t) => (filter === 'todas' ? true : filter === 'pendientes' ? !t.done : t.done));
    return [...filtered].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const dueDiff = (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) - (b.dueDate ? new Date(b.dueDate).getTime() : Infinity);
      if (dueDiff !== 0) return dueDiff;
      return PRIORITIES[b.priority] - PRIORITIES[a.priority];
    });
  }, [tasks, filter]);

  const pendingCount = tasks.filter((t) => !t.done).length;
  const nextDue = useMemo(() => {
    return tasks
      .filter((t) => !t.done && t.dueDate)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))[0];
  }, [tasks]);

  return (
    <section className="tasks-panel">
      <div className="glass-panel tasks-summary">
        <p>
          Tienes <strong>{pendingCount}</strong> tarea{pendingCount === 1 ? '' : 's'} pendiente{pendingCount === 1 ? '' : 's'}.
          {nextDue && (
            <>
              {' '}
              La más próxima es <strong>{nextDue.title}</strong>
              {daysUntil(nextDue.dueDate) === 0 ? ' y vence hoy.' : daysUntil(nextDue.dueDate) < 0 ? ', ya venció.' : ` en ${daysUntil(nextDue.dueDate)} día(s).`}
            </>
          )}
        </p>
        {!user && <p className="tasks-summary__hint">Inicia sesión con Google para sincronizar tus tareas entre dispositivos y añadirlas a Calendar.</p>}
        {syncError && <p className="tasks-sync-error">{syncError}</p>}
      </div>

      <form className="glass-panel tasks-form" onSubmit={addTask}>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nueva tarea (p. ej. Exposición de Historia)" />
        <input className="input tasks-form__date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <select className="select tasks-form__priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>
          Añadir
        </button>
      </form>

      <div className="tasks-filters">
        {['pendientes', 'completadas', 'todas'].map((f) => (
          <button key={f} type="button" className={`btn ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>

      <ul className="tasks-list">
        {visibleTasks.length === 0 && <li className="tasks-empty">No hay tareas en esta vista.</li>}
        {visibleTasks.map((t) => {
          const due = daysUntil(t.dueDate);
          return (
            <li key={t.id} className={`task-item glass-panel priority-${t.priority} ${t.done ? 'task-item--done' : ''}`}>
              <label className="task-item__check">
                <input type="checkbox" checked={t.done} onChange={() => toggleDone(t.id)} />
                <span>{t.title}</span>
              </label>
              <div className="task-item__meta">
                {t.dueDate && (
                  <span className={`task-item__due ${!t.done && due < 0 ? 'task-item__due--overdue' : ''}`}>
                    {t.dueDate} {!t.done && due != null ? (due === 0 ? '(hoy)' : due < 0 ? '(vencida)' : `(${due}d)`) : ''}
                  </span>
                )}
                <span className={`task-item__priority-tag priority-tag-${t.priority}`}>{t.priority}</span>
                {user &&
                  t.dueDate &&
                  (t.googleEventId ? (
                    t.googleEventLink ? (
                      <a className="btn tasks-calendar" href={t.googleEventLink} target="_blank" rel="noreferrer">
                        📅 Ver evento
                      </a>
                    ) : (
                      <span className="tasks-calendar-done">✓ En Calendar</span>
                    )
                  ) : (
                    <button type="button" className="btn tasks-calendar" onClick={() => syncToCalendar(t)} disabled={syncingId === t.id}>
                      {syncingId === t.id ? 'Sincronizando…' : '📅 A Calendar'}
                    </button>
                  ))}
                <button type="button" className="btn tasks-delete" onClick={() => removeTask(t.id)} aria-label="Eliminar tarea">
                  ✕
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
