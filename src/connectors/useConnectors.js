import { useCallback, useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

// Loads the connector list from GET /api/connectors. `userKey` changes on
// login/logout, which is what flips account connectors (Google) between
// "por conectar" and "conectado", so the list reloads then too.
export function useConnectors(userKey) {
  const [state, setState] = useState({ status: 'loading', connectors: [], error: '' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/connectors`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || `El servidor respondió con un error (${res.status}).`);
        // A 200 without the list means something other than the API answered
        // (e.g. the web page itself), so say that instead of "error 200".
        if (!Array.isArray(data?.connectors)) throw new Error('el servidor no devolvió la lista (respuesta inesperada).');
        if (!cancelled) setState({ status: 'ready', connectors: data.connectors, error: '' });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: 'error', connectors: [], error: err.message || 'No se pudo contactar al servidor.' });
      });
    return () => {
      cancelled = true;
    };
  }, [userKey, attempt]);

  const reload = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    setAttempt((n) => n + 1);
  }, []);

  return { ...state, reload };
}
