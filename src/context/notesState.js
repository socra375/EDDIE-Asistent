import { createContext, useContext } from 'react';

// Notas' state (provided by NotesContext.jsx), shared with the Notas screen and
// the wake word. Kept apart from the provider so that file only exports a component.
export const NotesContext = createContext(null);

export function useNotes() {
  const ctx = useContext(NotesContext);
  if (!ctx) throw new Error('useNotes debe usarse dentro de <NotesProvider>');
  return ctx;
}
