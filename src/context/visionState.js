import { createContext, useContext } from 'react';

// Modo Vigilancia's state, shared with the camera panel, the header chip and
// the settings card (provided by VisionContext.jsx). Kept apart from the
// provider so that file only exports a component.
export const VisionContext = createContext(null);

export function useVision() {
  const ctx = useContext(VisionContext);
  if (!ctx) throw new Error('useVision debe usarse dentro de <VisionProvider>');
  return ctx;
}
