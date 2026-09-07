import { useAuth } from '../../context/AuthContext';
import './Layout.css';

const STATUS_LABEL = {
  idle: 'En línea',
  processing: 'Analizando…',
  responding: 'Respondiendo',
  error: 'Error',
};

export default function TopBar({ title, status = 'idle', onToggleTheme, theme }) {
  const { user, loading, login, logout } = useAuth();

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
        {!loading && (
          <>
            {user ? (
              <button type="button" className="btn topbar__account" onClick={logout} title="Cerrar sesión">
                {user.avatarUrl ? (
                  <img className="topbar__avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
                ) : (
                  <span aria-hidden="true">👤</span>
                )}
                <span className="topbar__account-name">{user.name?.split(' ')[0] || 'Cuenta'}</span>
              </button>
            ) : (
              <button type="button" className="btn topbar__account" onClick={login}>
                <span aria-hidden="true">🔐</span> Iniciar sesión
              </button>
            )}
          </>
        )}
        <button type="button" className="btn topbar__theme" onClick={onToggleTheme} title="Cambiar tema">
          {theme === 'dark' ? '🌙' : '☀️'}
        </button>
      </div>
    </header>
  );
}
