import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  getMemory,
  saveMemory,
  deleteMemoryField,
  clearMemory,
} from '../utils/storage';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => getSettings());
  const [memory, setMemory] = useState(() => getMemory());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  function updateSettings(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function updateVoiceSettings(patch) {
    setSettings((prev) => ({ ...prev, voice: { ...prev.voice, ...patch } }));
  }

  function rememberFact(key, value) {
    if (!settings.memoryEnabled) return;
    setMemory(saveMemoryAndReturn(key, value));
  }

  function saveMemoryAndReturn(key, value) {
    const next = { ...getMemory(), [key]: value };
    saveMemory(next);
    return next;
  }

  function forgetFact(key) {
    setMemory(deleteMemoryField(key));
  }

  function forgetEverything() {
    clearMemory();
    setMemory({});
  }

  // Used by the auth sync bridge to adopt settings/memory pulled from the
  // server on login, without going through the per-field helpers above.
  function replaceSettings(next) {
    setSettings((prev) => ({ ...prev, ...next }));
  }

  function replaceMemory(next) {
    saveMemory(next);
    setMemory(next);
  }

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      updateVoiceSettings,
      memory,
      rememberFact,
      forgetFact,
      forgetEverything,
      replaceSettings,
      replaceMemory,
      resetSettings: () => setSettings({ ...DEFAULT_SETTINGS }),
    }),
    [settings, memory],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings debe usarse dentro de <SettingsProvider>');
  return ctx;
}
