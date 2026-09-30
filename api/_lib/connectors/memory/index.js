// Eddie's long-term memory (the Memoria module). Like the tasks tools, these
// don't write anything themselves: the memory lives in the browser (and in
// the user's account when signed in), so each tool validates the request
// against the memory the browser sent along (context.memory, a flat list of
// { id, c: category, t: text }) and emits an action that the app applies
// once the answer is complete (see applyMemoryActions in the app).
import { normalize } from '../tasks/index.js';
import { clip } from '../http.js';

const CATEGORY_LABEL = {
  profile: 'Perfil',
  preferences: 'Preferencias',
  projects: 'Proyectos',
  decisions: 'Decisiones',
  knowledge: 'Conocimientos',
  context: 'Contexto temporal',
};

// Memory is for what helps, not for secrets: passwords, keys, card numbers.
const SECRET_RE = /contrase[ñn]a|password|passwd|api[ _-]?key|secret|token|clave (de|del|privada)|tarjeta|cvv|iban|\b\d{13,19}\b/i;
const MAX_MATCHES = 6;

const words = (s) => normalize(s).split(' ').filter((w) => w.length > 2);

// Items that match a description: the whole phrase inside the item, or most
// of its words. Best first.
export function findMemory(items, query) {
  const wanted = normalize(query);
  const wantedWords = [...new Set(words(query))];
  if (!wanted || !Array.isArray(items)) return [];
  return items
    .map((item) => {
      const text = normalize(item.t);
      let score = 0;
      if (text.includes(wanted)) score = 100;
      else if (wantedWords.length) {
        const have = new Set(text.split(' '));
        const shared = wantedWords.filter((w) => have.has(w)).length;
        if (shared / wantedWords.length >= 0.6) score = (shared / wantedWords.length) * 80;
      }
      return { item, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.item);
}

function remember(args, context) {
  const text = String(args.text || '').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'Falta qué recordar.' };
  if (text.length > 300) return { error: 'Es demasiado largo para recordarlo (máximo 300 caracteres); resúmelo.' };
  if (SECRET_RE.test(text) || SECRET_RE.test(args.key || '')) {
    return { error: 'No guardo contraseñas, claves ni datos de tarjetas. Dile al usuario que eso no se guarda en la memoria.' };
  }
  const keyed = args.category === 'perfil' || args.category === 'preferencia';
  const key = String(args.key || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (keyed && !key) return { error: 'Para perfil y preferencias indica un nombre corto en "key" (por ejemplo "nombre" o "tono").' };
  context.emit?.({ type: 'memory_add', category: args.category, key: keyed ? key : undefined, text, project: args.project, days: args.days });
  const where = { perfil: 'tu perfil', preferencia: 'tus preferencias', decision: 'tus decisiones', conocimiento: 'tus conocimientos', contexto: 'tu contexto temporal' }[args.category];
  return { saved: true, summary: keyed ? `Guardado en ${where}: ${key} = ${text}` : `Guardado en ${where}: ${text}`, note: 'Se guarda al terminar tu respuesta; avisa al usuario en una frase corta ("Lo recordaré").' };
}

const PROJECT_FIELDS = { status: 'status', stack: 'stack', last_change: 'lastChange', next_goal: 'nextGoal' };

function updateProject(args, context) {
  const name = String(args.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!name) return { error: 'El proyecto necesita un nombre.' };
  const project = { name };
  for (const [arg, field] of Object.entries(PROJECT_FIELDS)) {
    if (typeof args[arg] === 'string' && args[arg].trim()) project[field] = args[arg].trim().slice(0, 160);
  }
  if (Object.keys(project).length < 2) return { error: 'Indica al menos un dato del proyecto: estado, stack, último cambio o próximo objetivo.' };
  const text = Object.values(project).join(' ');
  if (SECRET_RE.test(text)) return { error: 'No guardo contraseñas, claves ni tokens en la memoria.' };
  context.emit?.({ type: 'memory_project', project });
  return { saved: true, project, summary: `Proyecto "${name}" guardado en tu memoria.` };
}

function recall(args, context) {
  const items = context.memory || [];
  if (!items.length) return { found: 0, note: 'La memoria está vacía (o el usuario la apagó): no hay nada guardado.' };
  const query = String(args.query || '').trim();
  const matches = findMemory(items, query).slice(0, 8);
  if (!matches.length) return { found: 0, note: `No hay nada guardado sobre "${clip(query, 60)}".` };
  return { found: matches.length, items: matches.map((m) => ({ categoria: CATEGORY_LABEL[m.c] || m.c, texto: m.t })) };
}

function prepareForget(args, context) {
  const matches = findMemory(context.memory, args.query);
  if (!matches.length) return { error: `No encontré nada en la memoria sobre "${clip(args.query, 60)}".` };
  if (matches.length > MAX_MATCHES) return { error: `Hay ${matches.length} recuerdos que coinciden; pide al usuario que sea más específico.` };
  return {
    args: { query: args.query },
    preview: {
      title: 'Olvidar de tu memoria',
      confirmLabel: 'Olvidar',
      danger: true,
      fields: matches.map((m, i) => ({ key: `m${i}`, label: CATEGORY_LABEL[m.c] || m.c, value: m.t })),
    },
  };
}

function forget(args, context) {
  const matches = findMemory(context.memory, args.query).slice(0, MAX_MATCHES);
  if (!matches.length) return { error: 'Ese recuerdo ya no está en la memoria.' };
  context.emit?.({ type: 'memory_forget', ids: matches.map((m) => m.id) });
  return { forgotten: matches.length, summary: `Olvidé ${matches.length} ${matches.length === 1 ? 'recuerdo' : 'recuerdos'}.` };
}

export default {
  id: 'memory',
  name: 'Memoria',
  description: 'Eddie recuerda quién eres, tus preferencias, proyectos y decisiones entre conversaciones. Lo ves y lo borras en el módulo Memoria.',
  icon: 'memory',
  category: 'asistente',
  auth: null,
  requiredEnv: [],
  // Always offered: what's worth remembering can come up in any message.
  tools: [
    {
      label: 'Recordar',
      activity: 'Guardando en la memoria…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'remember',
        description:
          'Guarda en la memoria algo que el usuario dijo y conviene recordar, sin que lo pida: perfil (nombre, trabajo, estudios), preferencia (cómo quiere que trabajes), decision, conocimiento (dato estable) o contexto (temporal, con días). Nunca contraseñas, claves ni tarjetas.',
        parameters: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING', enum: ['perfil', 'preferencia', 'decision', 'conocimiento', 'contexto'], description: 'Dónde guardarlo.' },
            text: { type: 'STRING', description: 'El dato, en una frase corta y clara.' },
            key: { type: 'STRING', description: 'Perfil/preferencia: nombre corto del dato ("nombre", "tono").' },
            project: { type: 'STRING', description: 'Decision: proyecto al que pertenece.' },
            days: { type: 'INTEGER', description: 'Contexto: días de vigencia (7 por defecto, máx. 60).' },
          },
          required: ['category', 'text'],
        },
      },
      run: (args, context) => remember(args, context),
    },
    {
      label: 'Actualizar un proyecto',
      activity: 'Actualizando el proyecto…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result.summary,
      declaration: {
        name: 'update_project',
        description:
          'Crea o actualiza un proyecto del usuario en la memoria (solo cambian los datos dados) cuando cuente en qué trabaja o el proyecto avance.',
        parameters: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING', description: 'Nombre del proyecto.' },
            status: { type: 'STRING', description: 'Estado (idea, desarrollo, producción…).' },
            stack: { type: 'STRING', description: 'Tecnologías.' },
            last_change: { type: 'STRING', description: 'Lo último que se cambió o terminó.' },
            next_goal: { type: 'STRING', description: 'El próximo objetivo.' },
          },
          required: ['name'],
        },
      },
      run: (args, context) => updateProject(args, context),
    },
    {
      label: 'Consultar la memoria',
      activity: 'Buscando en la memoria…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result.found ? `${result.found} recuerdo(s) encontrados` : 'Nada guardado sobre eso'),
      declaration: {
        name: 'recall',
        description:
          'Busca en la memoria lo que se sabe de un tema o proyecto ("¿qué sabes de…?", "¿te acuerdas de…?"). Nunca inventes recuerdos.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'El tema a buscar, en pocas palabras.' } },
          required: ['query'],
        },
      },
      run: (args, context) => recall(args, context),
    },
    {
      label: 'Olvidar un recuerdo',
      activity: 'Preparando la confirmación…',
      sensitive: true,
      declaration: {
        name: 'forget',
        description:
          'Borra de la memoria lo que coincide con una descripción; siempre pide confirmación con una tarjeta.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'Qué olvidar, en pocas palabras (p. ej. "mi ciudad").' } },
          required: ['query'],
        },
      },
      prepare: (args, context) => prepareForget(args, context),
      run: (args, context) => forget(args, context),
    },
  ],
  webhook: null,
};
