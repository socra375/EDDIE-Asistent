import { createContext, useContext } from 'react';

// Which info panels of the home screen are on show (provided by
// HudContext.jsx). Kept apart from the provider so that file only exports a
// component.
export const HudContext = createContext(null);

export function useHud() {
  const ctx = useContext(HudContext);
  if (!ctx) throw new Error('useHud debe usarse dentro de <HudProvider>');
  return ctx;
}
