// Chat "skills": the old Estudio / Programación / Documentos screens, folded
// into the chat as templates. Each skill picks a response mode, an action
// and an optional setting (level, language); the user's text fills the
// template, while the chat bubble keeps showing only what the user typed.

const LEVELS = ['básico', 'intermedio', 'avanzado'];
const LANGUAGES = ['JavaScript', 'Python', 'HTML/CSS', 'SQL', 'Java', 'C#', 'Otro'];

const codeBlock = (text) => (text.includes('```') ? text : `\`\`\`\n${text}\n\`\`\``);

export const SKILLS = [
  {
    id: 'general',
    label: 'General',
    icon: 'chat',
    placeholder: 'Pregúntale algo a Eddie…',
  },
  {
    id: 'study',
    label: 'Estudio',
    icon: 'book',
    mode: 'tutor',
    placeholder: 'Tema a estudiar…',
    option: { label: 'Nivel', values: LEVELS, initial: 'intermedio' },
    actions: [
      { id: 'explicar', label: 'Explicar desde cero', build: (t, l) => `Explícame "${t}" desde cero, a nivel ${l}, con analogías simples.` },
      { id: 'resumen', label: 'Resumen', build: (t, l) => `Crea un resumen claro de "${t}" a nivel ${l}.` },
      { id: 'cuestionario', label: 'Cuestionario', build: (t, l) => `Genera un cuestionario de 5 preguntas sobre "${t}" a nivel ${l}, con las respuestas al final.` },
      { id: 'flashcards', label: 'Flashcards', build: (t, l) => `Crea 8 flashcards (pregunta y respuesta) sobre "${t}" a nivel ${l}.` },
      { id: 'esquema', label: 'Mapa conceptual', build: (t, l) => `Crea un esquema o mapa conceptual en texto jerárquico sobre "${t}" a nivel ${l}.` },
      { id: 'repaso', label: 'Plan de repaso', build: (t, l) => `Diseña un plan de repaso de 5 días para prepararme un examen de "${t}" a nivel ${l}.` },
    ],
  },
  {
    id: 'code',
    label: 'Código',
    icon: 'code',
    mode: 'tecnico',
    placeholder: 'Pega tu código…',
    option: { label: 'Lenguaje', values: LANGUAGES, initial: 'JavaScript' },
    actions: [
      { id: 'explicar', label: 'Explicar', build: (c, lang) => `Explica qué hace este código en ${lang}:\n\n${codeBlock(c)}` },
      {
        id: 'depurar',
        label: 'Detectar errores',
        build: (c, lang) =>
          `Este código en ${lang} tiene un error (si incluí la descripción del error, úsala). Detecta el error, explica por qué ocurre y propón el código corregido:\n\n${codeBlock(c)}`,
      },
      { id: 'refactorizar', label: 'Refactorizar', build: (c, lang) => `Refactoriza este código en ${lang} para que sea más claro y organizado, sin cambiar su comportamiento:\n\n${codeBlock(c)}` },
      { id: 'ejemplo', label: 'Generar ejemplo', build: (c, lang) => `A partir de este código en ${lang}, crea un ejemplo adicional que use un enfoque similar:\n\n${codeBlock(c)}` },
    ],
  },
  {
    id: 'documents',
    label: 'Documentos',
    icon: 'doc',
    mode: 'explicativo',
    exportable: true,
    placeholder: 'Tema del documento…',
    actions: [
      { id: 'resumen', label: 'Resumen', build: (t) => `Escribe un resumen bien estructurado sobre "${t}".` },
      { id: 'informe', label: 'Informe', build: (t) => `Redacta un informe con introducción, desarrollo y conclusión sobre "${t}".` },
      { id: 'guia', label: 'Guía de estudio', build: (t) => `Crea una guía de estudio completa sobre "${t}", con puntos clave y ejemplos.` },
      { id: 'esquema', label: 'Esquema para exposición', build: (t) => `Crea un esquema para una exposición sobre "${t}", con secciones numeradas.` },
      { id: 'correo', label: 'Correo o mensaje', build: (t) => `Redacta un correo o mensaje listo para enviar sobre: ${t}. Incluye asunto si es un correo.` },
    ],
  },
];

export function getSkill(id) {
  return SKILLS.find((s) => s.id === id) || SKILLS[0];
}

// Returns what to send to the AI for a skill request, plus a short tag and
// a document title for the chat bubble. The general skill sends the text as is.
export function buildSkillRequest(skillId, actionId, text, option) {
  const skill = getSkill(skillId);
  const input = text.trim();
  if (!skill.actions) return { prompt: input };

  const action = skill.actions.find((a) => a.id === actionId) || skill.actions[0];
  const firstLine = input.split('\n')[0].slice(0, 60);
  return {
    prompt: action.build(input, option),
    tag: `${skill.label} · ${action.label}${option ? ` · ${option}` : ''}`,
    title: `${action.label}: ${firstLine}`,
    mode: skill.mode,
  };
}
