import { createContext, useContext } from 'react';

// The wake word's state, shared with the Memoria card (provided by
// WakeWordContext.jsx). Kept apart from the provider so that file only
// exports a component.
export const WakeWordContext = createContext(null);

export function useWakeWord() {
  const ctx = useContext(WakeWordContext);
  if (!ctx) throw new Error('useWakeWord debe usarse dentro de <WakeWordProvider>');
  return ctx;
}
