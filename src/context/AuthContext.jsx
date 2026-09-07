import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const AuthContext = createContext(null);

// Google sign-in is a full-page redirect (OAuth can't happen inside a
// fetch), so this context's job is just: know who's logged in (via the
// session cookie + /api/auth/me), and expose login()/logout() as simple
// actions. The rest of the app stays fully usable when logged out.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
      const data = await res.json();
      setUser(data.user || null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    window.location.href = `${API_BASE}/api/auth/google/start`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    } finally {
      setUser(null);
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/auth/account`, { method: 'DELETE', credentials: 'include' });
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, deleteAccount, refresh }), [user, loading, login, logout, deleteAccount, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
