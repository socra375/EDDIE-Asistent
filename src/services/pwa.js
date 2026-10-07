// Eddie as an installed app (PWA): registers the service worker (public/sw.js,
// production only) and tells the Configuración card whether Eddie can be
// installed, with the browser's own install prompt behind the button.
import { useEffect, useState } from 'react';

const DISPLAY_QUERY = '(display-mode: standalone)';
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export function registerServiceWorker() {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Without it Eddie still works online; it just can't open offline.
    });
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

export const isStandalone = () => {
  try {
    return window.matchMedia?.(DISPLAY_QUERY).matches || window.navigator.standalone === true;
  } catch {
    return false;
  }
};

// Asks the browser to show its install dialog; resolves to 'accepted' | 'dismissed' | 'unavailable'.
export async function promptInstall() {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  deferredPrompt = null;
  notify();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'dismissed';
  }
}

// { installed, canInstall, offlineReady }
export function useInstallState() {
  const [, setTick] = useState(0);
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    listeners.add(update);
    const media = window.matchMedia?.(DISPLAY_QUERY);
    media?.addEventListener?.('change', update);
    return () => {
      listeners.delete(update);
      media?.removeEventListener?.('change', update);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    navigator.serviceWorker?.ready.then(() => alive && setOfflineReady(true)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { installed: isStandalone(), canInstall: Boolean(deferredPrompt), offlineReady };
}

// Shortcuts of the installed app and links like /?modulo=tareas: where to open.
// Read once, then the address is cleaned.
const MODULES = ['home', 'today', 'chat', 'tasks', 'notes', 'memory', 'gallery', 'connectors', 'settings'];
const ALIASES = { inicio: 'home', hoy: 'today', tareas: 'tasks', notas: 'notes', memoria: 'memory', galeria: 'gallery', galería: 'gallery', conectores: 'connectors', configuracion: 'settings', configuración: 'settings' };

export function readLaunch(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search);
  const wanted = (params.get('modulo') || '').toLowerCase();
  const module = MODULES.includes(wanted) ? wanted : ALIASES[wanted] || null;
  const action = ['hablar', 'vigilancia'].includes(params.get('accion')) ? params.get('accion') : null;
  return { module, action };
}
