// The local probe's settings, kept only in this browser (localStorage): the
// address, the key and whether questions about the computer are detected
// automatically. They are never synced to Eddie's server — the key opens a
// program on the user's own computer.
//
// "forced" (the chat's «Sonda local» switch, which sends the typed messages
// there) is NOT saved: it lives in memory and starts off on every load, so a
// forgotten switch can never leave Eddie depending on the probe.
import { useEffect, useState } from 'react';
import { DEFAULT_PROBE_URL, cleanProbeUrl } from './probeCore';

const STORAGE_KEY = 'eddie.probe';
// Version 2: autoDetect is off by default and an older saved `forced`/`autoDetect` is ignored.
const STORAGE_VERSION = 2;
export const PROBE_CHANGED_EVENT = 'eddie:probe-changed';
export const DEFAULT_PROBE_CONFIG = { url: DEFAULT_PROBE_URL, key: '', forced: false, autoDetect: false };

let forced = false;

function readStored() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored && typeof stored === 'object' ? stored : null;
  } catch {
    return null;
  }
}

export function getProbeConfig() {
  const config = { ...DEFAULT_PROBE_CONFIG, forced };
  const stored = readStored();
  if (!stored) return config;
  if (typeof stored.url === 'string') config.url = stored.url;
  if (typeof stored.key === 'string') config.key = stored.key;
  if (stored.v === STORAGE_VERSION && typeof stored.autoDetect === 'boolean') config.autoDetect = stored.autoDetect;
  return config;
}

// Whether questions about the computer go to the probe by themselves: only
// when the user turned it on and the probe is set up here (a valid address and a saved key).
export function autoDetectReady(config) {
  return Boolean(config.autoDetect && config.key && cleanProbeUrl(config.url));
}

export function saveProbeConfig(patch) {
  if (typeof patch.forced === 'boolean') forced = patch.forced;
  const current = getProbeConfig();
  const next = {
    url: patch.url ?? current.url,
    key: patch.key ?? current.key,
    autoDetect: patch.autoDetect ?? current.autoDetect,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: STORAGE_VERSION, url: next.url, key: next.key, autoDetect: next.autoDetect }));
  } catch {
    // Without storage the setting lasts until the page reloads.
  }
  const config = { ...next, forced };
  window.dispatchEvent(new CustomEvent(PROBE_CHANGED_EVENT, { detail: config }));
  return config;
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
