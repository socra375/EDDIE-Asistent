// The local probe's settings, kept only in this browser (localStorage): the
// address, the key and whether the chat uses it. They are never synced to
// Eddie's server — the key opens a program on the user's own computer.
import { useEffect, useState } from 'react';
import { DEFAULT_PROBE_URL } from './probeCore';

const STORAGE_KEY = 'eddie.probe';
export const PROBE_CHANGED_EVENT = 'eddie:probe-changed';
export const DEFAULT_PROBE_CONFIG = { enabled: false, url: DEFAULT_PROBE_URL, key: '', auto: false };

export function getProbeConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? { ...DEFAULT_PROBE_CONFIG, ...stored } : { ...DEFAULT_PROBE_CONFIG };
  } catch {
    return { ...DEFAULT_PROBE_CONFIG };
  }
}

export function saveProbeConfig(patch) {
  const next = { ...getProbeConfig(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Without storage the setting lasts until the page reloads.
  }
  window.dispatchEvent(new CustomEvent(PROBE_CHANGED_EVENT, { detail: next }));
  return next;
}

// The current settings, updated when they change anywhere in the app.
export function useProbeConfig() {
  const [config, setConfig] = useState(getProbeConfig);
  useEffect(() => {
    const update = () => setConfig(getProbeConfig());
    window.addEventListener(PROBE_CHANGED_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(PROBE_CHANGED_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return config;
}
