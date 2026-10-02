// "Modo ligero": turns off the HUD effects and the ring's animations on
// computers that can't keep up. The choice (Configuración → Pantalla) is
// "auto" (default), "lite" or "full".
//
// In "auto" the screen goes light when
//  - the system asks for less motion, or the device is very small (2 cores or
//    less, or 2 GB of memory or less), or
//  - a frame-rate check noticed the screen running slowly (below ~20 frames
//    per second twice in a row); that verdict is remembered (GUARD_KEY) so the
//    next load starts light, until the user retries from Configuración.
const GUARD_KEY = 'eddie.perf.lite';
export const PERF_CHANGED_EVENT = 'eddie:perf-changed';
export const SLOW_FPS = 20;
const START_AFTER_MS = 4000;
const WINDOW_MS = 2000;
const SLOW_WINDOWS = 2;

export function lowPowerDevice() {
  try {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const cores = navigator.hardwareConcurrency;
    const memory = navigator.deviceMemory;
    return Boolean(reduced || (cores && cores <= 2) || (memory && memory <= 2));
  } catch {
    return false;
  }
}

export function readGuard() {
  try {
    return localStorage.getItem(GUARD_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeGuard(on) {
  try {
    if (on) localStorage.setItem(GUARD_KEY, '1');
    else localStorage.removeItem(GUARD_KEY);
  } catch {
    // Without storage the verdict lasts until the page reloads.
  }
  window.dispatchEvent(new CustomEvent(PERF_CHANGED_EVENT));
}

// Is the lite look on, given the user's choice and what is known?
export function isLite(mode, guard, lowPower = lowPowerDevice()) {
  if (mode === 'lite') return true;
  if (mode === 'full') return false;
  return Boolean(guard || lowPower);
}

// Counts animation frames in short windows; calls onSlow() once if the page
// runs below SLOW_FPS for SLOW_WINDOWS windows in a row. A hidden tab gets no
// frames at all, so a window that was ever hidden doesn't count. Returns a stop function.
export function watchFrameRate(onSlow, { raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), now = () => performance.now(), isHidden = () => document.hidden } = {}) {
  let stopped = false;
  let frame = 0;
  let timer = 0;
  let slow = 0;
  let frames = 0;
  let startedAt = 0;
  let hiddenSeen = false;

  const onVisibility = () => {
    if (isHidden()) hiddenSeen = true;
  };
  const loop = () => {
    frames += 1;
    frame = raf(loop);
  };
  const beginWindow = () => {
    frames = 0;
    hiddenSeen = isHidden();
    startedAt = now();
    frame = raf(loop);
    timer = window.setTimeout(endWindow, WINDOW_MS);
  };
  const endWindow = () => {
    cancel(frame);
    if (stopped) return;
    const seconds = (now() - startedAt) / 1000;
    if (!hiddenSeen && !isHidden() && seconds > 0) {
      slow = frames / seconds < SLOW_FPS ? slow + 1 : 0;
      if (slow >= SLOW_WINDOWS) {
        onSlow();
        return;
      }
    } else {
      slow = 0;
    }
    beginWindow();
  };

  document.addEventListener('visibilitychange', onVisibility);
  timer = window.setTimeout(beginWindow, START_AFTER_MS);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    cancel(frame);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
