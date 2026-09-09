import EddieLogo from './EddieLogo';
import './Layout.css';

const MODULES = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'voice', label: 'Voz', icon: '🎙️' },
  { id: 'study', label: 'Estudio', icon: '📚' },
  { id: 'code', label: 'Programación', icon: '💻' },
  { id: 'tasks', label: 'Tareas', icon: '📅' },
  { id: 'documents', label: 'Documentos', icon: '📝' },
  { id: 'settings', label: 'Configuración', icon: '⚙️' },
];

export default function Sidebar({ active, onSelect }) {
  return (
    <nav className="sidebar glass-panel">
      <div className="sidebar__brand">
        <EddieLogo size={34} />
        <span className="sidebar__brand-name">EDDIE</span>
      </div>
      <ul className="sidebar__list">
        {MODULES.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className={`sidebar__item ${active === m.id ? 'sidebar__item--active' : ''}`}
              onClick={() => onSelect(m.id)}
              aria-current={active === m.id}
            >
              <span className="sidebar__icon" aria-hidden="true">
                {m.icon}
              </span>
              <span className="sidebar__label">{m.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export { MODULES };
