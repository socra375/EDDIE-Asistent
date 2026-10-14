// The app's heartbeat (see api/_lib/reminders/tick.js): while Eddie is open and signed in,
// it asks the server to run whatever is due about once a minute, and right away when the
// device wakes up or the app comes back to the front. Quiet on failure: it is a helper,
// not something to show errors for.
import { useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const EVERY_MS = 60_000;
const MIN_GAP_MS = 20_000;

export function useTick(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    let last = 0;
    const beat = () => {
      if (document.hidden && last) return; // a hidden tab waits (browsers slow it down anyway)
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      fetch(`${API_BASE}/api/connectors/tick`, { method: 'POST', credentials: 'include' }).catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, EVERY_MS);
    document.addEventListener('visibilitychange', beat);
    window.addEventListener('online', beat);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', beat);
      window.removeEventListener('online', beat);
    };
  }, [enabled]);
}
