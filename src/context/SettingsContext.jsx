import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  getMemory,
  saveMemory,
  clearMemory,
} from '../utils/storage';
import { addItem, upsertProject, removeItems, emptyMemory, normalizeMemory } from '../services/memory';
import { MEMORY_CHANGED_EVENT } from '../services/memoryActions';

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => getSettings());
  const [memory, setMemory] = useState(() => getMemory());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Eddie changed the memory from the chat (memory tools).
  useEffect(() => {
    const reload = () => setMemory(getMemory());
    window.addEventListener(MEMORY_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MEMORY_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  function updateSettings(patch) {
    setSettings((prev) => ({ ...prev, ...patch }));
  }

  function updateVoiceSettings(patch) {
    setSettings((prev) => ({ ...prev, voice: { ...prev.voice, ...patch } }));
  }

  function updateDisplaySettings(patch) {
    setSettings((prev) => ({ ...prev, display: { ...DEFAULT_SETTINGS.display, ...(prev.display || {}), ...patch } }));
  }

  function updateWakeSettings(patch) {
    setSettings((prev) => ({ ...prev, wake: { ...DEFAULT_SETTINGS.wake, ...(prev.wake || {}), ...patch } }));
  }

  function setConnectorEnabled(id, enabled) {
    setSettings((prev) => {
      const off = new Set(prev.disabledConnectors || []);
      if (enabled) off.delete(id);
      else off.add(id);
      return { ...prev, disabledConnectors: [...off] };
    });
  }

  // Memory edits the user makes by hand (Memoria module) or the app makes
  // itself (the study level). Eddie's own edits from the chat arrive through
  // applyMemoryActions and the change event below.
  function commitMemory(result) {
    if (!result.changed) return false;
    saveMemory(result.memory);
    setMemory(result.memory);
    return true;
  }

  function rememberFact(item) {
    if (!settings.memoryEnabled) return false;
    return commitMemory(addItem(getMemory(), item));
  }

  function saveProject(fields) {
    return commitMemory(upsertProject(getMemory(), fields));
  }

  function forgetItem(id) {
    const out = removeItems(getMemory(), [id]);
    return commitMemory({ memory: out.memory, changed: out.removed > 0 });
  }

  function forgetEverything() {
    clearMemory();
    setMemory(emptyMemory());
  }

  // Used by the auth sync bridge to adopt settings/memory pulled from the
  // server on login, without going through the per-field helpers above.
  function replaceSettings(next) {
    setSettings((prev) => ({ ...prev, ...next }));
  }

  function replaceMemory(next) {
    const clean = normalizeMemory(next);
    saveMemory(clean);
    setMemory(clean);
  }

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      updateVoiceSettings,
      updateDisplaySettings,
      updateWakeSettings,
      setConnectorEnabled,
      memory,
      rememberFact,
      saveProject,
      forgetItem,
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
