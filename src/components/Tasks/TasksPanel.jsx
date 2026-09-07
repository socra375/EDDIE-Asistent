import { useEffect, useMemo, useState } from 'react';
import { getTasks, saveTasks } from '../../utils/storage';
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
  const [tasks, setTasks] = useState(() => getTasks());
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('media');
  const [filter, setFilter] = useState('pendientes');

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    setTasks((prev) => [...prev, { id: nextId(), title: title.trim(), dueDate: dueDate || null, priority, done: false }]);
    setTitle('');
    setDueDate('');
    setPriority('media');
  }

  function toggleDone(id) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }

  function removeTask(id) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
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
