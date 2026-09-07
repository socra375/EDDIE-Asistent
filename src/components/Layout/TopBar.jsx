import './Layout.css';

const STATUS_LABEL = {
  idle: 'En línea',
  processing: 'Analizando…',
  responding: 'Respondiendo',
  error: 'Error',
};

export default function TopBar({ title, status = 'idle', onToggleTheme, theme }) {
  return (
    <header className="topbar glass-panel">
      <div>
        <h1 className="topbar__title">{title}</h1>
      </div>
      <div className="topbar__right">
        <span className={`status-pill status-pill--${status}`}>
          <span className="status-pill__dot" />
          {STATUS_LABEL[status] || status}
        </span>
        <button type="button" className="btn topbar__theme" onClick={onToggleTheme} title="Cambiar tema">
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  );
}
