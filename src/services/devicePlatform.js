// What to call a device and how long ago it was seen. Pure (no browser APIs).

// "Chrome · ChromeOS" from a user-agent string.
export function describePlatform(ua = '') {
  const s = String(ua);
  const os = /CrOS/.test(s) ? 'ChromeOS' : /Android/.test(s) ? 'Android' : /iPhone|iPad|iPod/.test(s) ? 'iOS' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : '';
  return [browser, os].filter(Boolean).join(' · ') || 'Navegador';
}

// The name a new device gets until its owner changes it: "Chromebook", "Teléfono Android"…
export function defaultDeviceName(ua = '') {
  const s = String(ua);
  if (/CrOS/.test(s)) return 'Chromebook';
  if (/iPhone|iPod/.test(s)) return 'iPhone';
  if (/iPad/.test(s)) return 'iPad';
  if (/Android/.test(s)) return /Mobile/.test(s) ? 'Teléfono Android' : 'Tablet Android';
  if (/Windows/.test(s)) return 'PC con Windows';
  if (/Mac OS X|Macintosh/.test(s)) return 'Mac';
  if (/Linux/.test(s)) return 'PC con Linux';
  return 'Mi dispositivo';
}

// "ahora", "hace 3 min", "hace 2 h", "hace 4 días".
export function ago(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return 'nunca';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
