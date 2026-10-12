// The in-app call (src/call/CallScreen.jsx) shared with the rest of Eddie without
// importing it: the wake-word listener keeps quiet while a call is on, the answers
// are read aloud even if "leer en voz alta" is off, and anything can start a call
// with startCall() (the Contactos screen, the installed app's shortcut, and later
// Eddie calling the user).
import { useSyncExternalStore } from 'react';

export const CALL_EVENT = 'eddie:call';

let active = false;
const subscribers = new Set();

export const callBridge = {
  isActive: () => active,
  set(value) {
    if (active === Boolean(value)) return;
    active = Boolean(value);
    subscribers.forEach((fn) => fn());
  },
};

const subscribe = (fn) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

export const useCallActive = () => useSyncExternalStore(subscribe, () => active, () => false);

// { incoming: true } shows «Eddie te llama» with Contestar / Rechazar; otherwise the screen waits for «Llamar a Eddie».
export const startCall = (detail = {}) => window.dispatchEvent(new CustomEvent(CALL_EVENT, { detail }));
