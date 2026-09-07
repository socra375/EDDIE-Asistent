import { useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { remoteSettings, remoteMemory } from '../../services/remote';

// No visible output — reconciles localStorage-based settings/memory with
// the backend when a Google session exists. On login: adopt whatever the
// server already has, or seed it from the current local copy if this is
// the first sign-in. After that, every local change is mirrored up.
export default function SettingsSyncBridge() {
  const { user } = useAuth();
  const { settings, replaceSettings, memory, replaceMemory } = useSettings();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!user) {
      hydratedRef.current = false;
      return undefined;
    }
    let cancelled = false;

    (async () => {
      try {
        const [remoteS, remoteM] = await Promise.all([remoteSettings.get(), remoteMemory.get()]);
        if (cancelled) return;

        if (remoteS?.settings) {
          replaceSettings(remoteS.settings);
        } else {
          await remoteSettings.put(settings);
        }

        if (remoteM && Object.keys(remoteM.memory || {}).length > 0) {
          replaceMemory(remoteM.memory);
        } else if (Object.keys(memory).length > 0) {
          await remoteMemory.put(memory);
        }
      } catch {
        // Sync is best-effort; the app keeps working from localStorage either way.
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run on login/logout, not on every settings/memory edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user || !hydratedRef.current) return;
    remoteSettings.put(settings).catch(() => {});
  }, [user, settings]);

  useEffect(() => {
    if (!user || !hydratedRef.current) return;
    remoteMemory.put(memory).catch(() => {});
  }, [user, memory]);

  return null;
}
