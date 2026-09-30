// Each module gets its own accent so the rail reads at a glance, the same
// way JARVIS-HRZ colors its icons per function.
export const MODULES = [
  { id: 'home', label: 'Inicio', icon: 'home', color: '#3fe8ff' },
  { id: 'chat', label: 'Chat', icon: 'chat', color: '#b9f7ff' },
  { id: 'study', label: 'Estudio', icon: 'book', color: '#9d8cff' },
  { id: 'code', label: 'Programación', icon: 'code', color: '#5b9dff' },
  { id: 'tasks', label: 'Tareas', icon: 'check', color: '#4dffa6' },
  { id: 'documents', label: 'Documentos', icon: 'doc', color: '#ffb020' },
];

export const SETTINGS = { id: 'settings', label: 'Configuración', icon: 'settings', color: '#6fd3e6' };

export function moduleLabel(id) {
  return [...MODULES, SETTINGS].find((m) => m.id === id)?.label || 'Eddie';
}
