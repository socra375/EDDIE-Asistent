// What kind of knowledge a topic is, shared by the server (the AI picks one
// when Eddie learns it) and the screen (colour on the map, the selector).
// Pure, no browser or server APIs.
export const KNOWLEDGE_CATEGORIES = [
  { id: 'empresarial', label: 'Empresarial', hint: 'negocios, finanzas, ventas, marketing, emprendimiento, trabajo y gestión' },
  { id: 'tecnica', label: 'Técnica', hint: 'programación, tecnología, ingeniería, herramientas y oficios técnicos' },
  { id: 'cotidiana', label: 'Cotidiana', hint: 'vida diaria: hogar, cocina, compras, viajes, trámites, mascotas y consejos prácticos' },
  { id: 'personal', label: 'Personal', hint: 'desarrollo personal, hábitos, relaciones, estudio, productividad y bienestar emocional' },
  { id: 'salud', label: 'Salud', hint: 'salud, ejercicio, nutrición, deporte y medicina general' },
  { id: 'academica', label: 'Académica', hint: 'ciencia, historia, matemáticas, idiomas, geografía y cultura general' },
  { id: 'creativa', label: 'Creativa', hint: 'arte, música, escritura, diseño, fotografía y manualidades' },
  { id: 'unica', label: 'Única', hint: 'lo que no encaja en ninguna otra: curiosidades, aficiones raras o temas muy particulares' },
];

export const DEFAULT_CATEGORY = 'unica';
const IDS = new Set(KNOWLEDGE_CATEGORIES.map((c) => c.id));

// A known category id, or the default.
export const cleanCategory = (value) => {
  const id = String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return IDS.has(id) ? id : DEFAULT_CATEGORY;
};

export const categoryLabel = (id) => KNOWLEDGE_CATEGORIES.find((c) => c.id === cleanCategory(id))?.label || 'Única';
