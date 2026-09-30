// Each module gets its own accent so the rail reads at a glance, the same
// way JARVIS-HRZ colors its icons per function.
export const MODULES = [
  { id: 'chat', label: 'Chat', icon: 'chat', color: '#4fd6ff' },
  { id: 'study', label: 'Estudio', icon: 'book', color: '#8b6bff' },
  { id: 'code', label: 'Programación', icon: 'code', color: '#5b8cff' },
  { id: 'tasks', label: 'Tareas', icon: 'check', color: '#4fffa8' },
  { id: 'documents', label: 'Documentos', icon: 'doc', color: '#ffcf5c' },
];

export const SETTINGS = { id: 'settings', label: 'Configuración', icon: 'settings', color: '#8ea3c0' };

export function moduleLabel(id) {
  return [...MODULES, SETTINGS].find((m) => m.id === id)?.label || 'Eddie';
}
