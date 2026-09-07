import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export function useProviderHealth() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/health`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setHealth({ ok: false, gemini: false, claude: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return health;
}
