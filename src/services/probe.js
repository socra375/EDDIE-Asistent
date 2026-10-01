// The local probe's settings, kept only in this browser (localStorage): the
// address, the key and how the chat uses it. They are never synced to
// Eddie's server — the key opens a program on the user's own computer.
import { useEffect, useState } from 'react';
import { DEFAULT_PROBE_URL, cleanProbeUrl } from './probeCore';

const STORAGE_KEY = 'eddie.probe';
export const PROBE_CHANGED_EVENT = 'eddie:probe-changed';
// forced: "Sonda" mode in the chat — every message goes to the probe.
// autoDetect: questions about the computer go to the probe on their own
// (once a key is saved), and to the cloud if the probe doesn't answer.
export const DEFAULT_PROBE_CONFIG = { url: DEFAULT_PROBE_URL, key: '', forced: false, autoDetect: true };

export function getProbeConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== 'object') return { ...DEFAULT_PROBE_CONFIG };
    // Only the current fields (older versions stored `enabled` and `auto`).
    const config = { ...DEFAULT_PROBE_CONFIG };
    if (typeof stored.url === 'string') config.url = stored.url;
    if (typeof stored.key === 'string') config.key = stored.key;
    if (typeof stored.forced === 'boolean') config.forced = stored.forced;
    if (typeof stored.autoDetect === 'boolean') config.autoDetect = stored.autoDetect;
    return config;
  } catch {
    return { ...DEFAULT_PROBE_CONFIG };
  }
}

// Whether questions about the computer go to the probe by themselves: only
// once it has been set up here (a valid address and a saved key).
export function autoDetectReady(config) {
  return Boolean(config.autoDetect && config.key && cleanProbeUrl(config.url));
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
