import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const REFRESH_MS = 5 * 60 * 1000;

// Loads GET /api/connectors/today (agenda, important mail, news): the same
// connector tools Eddie uses in the chat. `userKey` changes on login/logout
// and `off` is the connectors the user switched off, so the panel reloads
// when either changes; it also refreshes itself every 5 minutes while open.
export function useToday(userKey, off) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '', updatedAt: null });
  const [attempt, setAttempt] = useState(0);
  const offKey = off.join(',');
  const dataRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const url = `${API_BASE}/api/connectors/today?tz=${encodeURIComponent(tz)}&off=${encodeURIComponent(offKey)}`;
      fetch(url, { credentials: 'include', signal: controller.signal })
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!res.ok || !data?.calendar) throw new Error(data?.error || `El servidor respondió con un error (${res.status}).`);
          dataRef.current = data;
          if (!cancelled) setState({ status: 'ready', data, error: '', updatedAt: new Date() });
        })
        .catch((err) => {
          if (cancelled || err.name === 'AbortError') return;
          // Keep showing the last good data if a refresh fails.
          setState({ status: 'error', data: dataRef.current, error: err.message || 'No se pudo contactar al servidor.', updatedAt: null });
        });
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [userKey, offKey, attempt]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
