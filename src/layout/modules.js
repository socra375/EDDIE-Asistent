// Each module gets its own accent so the rail reads at a glance, the same
// way JARVIS-HRZ colors its icons per function. Estudio, Código y
// Documentos ya no son pantallas: viven como habilidades del chat
// (src/services/skills.js).
export const MODULES = [
  { id: 'home', label: 'Inicio', icon: 'home', color: '#3fe8ff' },
  { id: 'chat', label: 'Chat', icon: 'chat', color: '#b9f7ff' },
  { id: 'tasks', label: 'Tareas', icon: 'check', color: '#4dffa6' },
];

export const SETTINGS = { id: 'settings', label: 'Configuración', icon: 'settings', color: '#6fd3e6' };

export function moduleLabel(id) {
  return [...MODULES, SETTINGS].find((m) => m.id === id)?.label || 'Eddie';
}
