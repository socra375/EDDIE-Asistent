// Eddie's second brain: "Investiga y aprende X" makes Eddie read several web
// pages about X, keep the essential notes and use them whenever a later
// request touches the topic (the relevant notes are handed to him before every
// answer, see api/_lib/knowledge/recall.js). The tools here are for the
// explicit asks: learn something, say what he knows, forget a topic.
import { LearnError, cleanTopic, learnTopic } from '../../knowledge/learn.js';
import { recallForTool } from '../../knowledge/recall.js';
import { countNotes, countTopics, deleteTopic, listTopics } from '../../knowledge/store.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para usar el segundo cerebro inicia sesión con Google (Configuración → Cuenta de Google).';
const getUser = async (context) => context.getUser?.();

async function learn(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  try {
    const out = await learnTopic({ userId: user.id, topic: args.topic, focus: args.focus });
    return {
      learned: true,
      topic: out.topic,
      kind: out.kind,
      summary: out.summary,
      notes: out.noteCount,
      updated: out.updated,
      sources: out.sources.slice(0, 5),
      note: 'Ya quedó guardado en tu segundo cerebro. Cuéntale al usuario en 2 o 3 frases lo esencial que aprendiste y de cuántas fuentes (nombra un par); no copies todo.',
    };
  } catch (err) {
    if (err instanceof LearnError) return { error: err.message };
    throw err;
  }
}

async function searchKnowledge(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const query = clip(args.query, 300);
  if (!query) return { error: 'Dime qué buscar en lo que aprendí.' };
  const found = await recallForTool(user.id, query);
  if (!found.length) return { count: 0, note: 'No tengo nada aprendido sobre eso. Díselo al usuario y ofrécele investigarlo ("investiga y aprende …").' };
  return {
    count: found.length,
    notes: found.map((n) => ({ topic: n.topic, note: n.content, source: n.sourceTitle || n.sourceUrl || null, url: n.sourceUrl })),
    note: 'Son notas que aprendiste de páginas web: úsalas como base y nombra la fuente cuando ayude.',
  };
}

async function listKnowledge(_args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const topics = await listTopics(user.id);
  if (!topics.length) return { count: 0, note: 'Todavía no aprendí nada. El usuario puede pedirte "investiga y aprende …".' };
  return { count: topics.length, topics: topics.map((t) => ({ topic: t.title, kind: t.kind, notes: t.noteCount, learned: t.updatedAt.slice(0, 10) })) };
}

// The topic the user meant: exact title first, then a title that contains it (or the other way round).
export function matchTopic(topics, text) {
  const q = cleanTopic(text).toLowerCase();
  if (!q) return { candidates: [] };
  const exact = topics.find((t) => t.title.toLowerCase() === q);
  if (exact) return { topic: exact };
  const close = topics.filter((t) => t.title.toLowerCase().includes(q) || q.includes(t.title.toLowerCase()));
  return close.length === 1 ? { topic: close[0] } : { candidates: close };
}

async function prepareForget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const { topic, candidates } = matchTopic(await listTopics(user.id), args.topic);
  if (!topic) return { error: candidates?.length ? `Hay varios temas parecidos: ${candidates.map((t) => `«${t.title}»`).join(', ')}. Pídele al usuario que diga cuál.` : `No tengo aprendido nada llamado «${clip(args.topic, 80)}».` };
  return {
    args: { topic: topic.title },
    preview: {
      title: 'Olvidar lo que aprendí',
      confirmLabel: 'Olvidar',
      danger: true,
      fields: [
        { key: 'topic', label: 'Tema', value: topic.title },
        { key: 'notes', label: 'Se borran', value: `${topic.noteCount} nota${topic.noteCount === 1 ? '' : 's'} y el resumen` },
      ],
    },
  };
}

async function forget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const { topic } = matchTopic(await listTopics(user.id), args.topic);
  if (!topic) return { error: `«${clip(args.topic, 80)}» ya no está en lo que aprendí.` };
  await deleteTopic(user.id, topic.id);
  return { forgotten: true, topic: topic.title, summary: `Olvidé lo que había aprendido sobre «${topic.title}».` };
}

export default {
  id: 'knowledge',
  name: 'Segundo cerebro',
  description:
    'Dile «Investiga y aprende X» (un tema o una habilidad) y Eddie lee varias páginas web, guarda lo esencial en su segundo cerebro y lo usa cuando le preguntes algo relacionado. Puedes verlo y borrarlo en Memoria.',
  icon: 'memory',
  category: 'asistente',
  // Offered when the user talks about learning/researching or about what Eddie learned; the automatic recall doesn't need the tools.
  route: /investig|aprend|estudi[ao]\b|averigu|segundo cerebro|cerebro|(olvid|borr|elimin)\w*.*(aprend|tema|cerebro|investig)|qu[eé] (sabes|has aprendido|aprendiste)|lo que (aprendiste|sabes)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL', 'GEMINI_API_KEY'],
  note: 'Solo con sesión iniciada. Para cada tema hace 2 búsquedas (Tavily, con o sin TAVILY_API_KEY), lee hasta 5 páginas públicas (nunca direcciones internas ni archivos), guarda de 6 a 12 notas cortas con su fuente y las encuentra por significado (vectores de Gemini). Tope de 60 temas y 6 investigaciones por hora. Lo aprendido se ve y se borra en Memoria → Segundo cerebro.',
  details: async (user) => ({ topics: await countTopics(user.id), notes: await countNotes(user.id) }),
  tools: [
    {
      label: 'Investigar y aprender un tema',
      activity: 'Investigando en la web y aprendiendo…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => (result?.learned ? `Aprendí «${result.topic}»: ${result.notes} notas de ${result.sources?.length || 0} fuentes` : undefined),
      declaration: {
        name: 'learn_topic',
        description:
          'Investiga en varias páginas web y APRENDE un tema o una habilidad, guardando lo esencial en tu segundo cerebro para usarlo después. Úsala en cuanto el usuario diga "investiga y aprende X" (o "aprende sobre X"), sin pedir confirmación: ya lo pidió. Tarda unos 20-30 segundos. Si ya sabías el tema, lo actualiza. Después cuéntale en 2-3 frases lo esencial y de cuántas fuentes sale.',
        parameters: {
          type: 'OBJECT',
          properties: {
            topic: { type: 'STRING', description: 'El tema o la habilidad, tal como lo dijo el usuario, p. ej. "tocar guitarra eléctrica" o "la fotosíntesis".' },
            focus: { type: 'STRING', description: 'Opcional: un enfoque concreto que pidió el usuario (p. ej. "para principiantes").' },
          },
          required: ['topic'],
        },
      },
      run: (args, context) => learn(args, context),
    },
    {
      label: 'Consultar lo aprendido',
      activity: 'Consultando mi segundo cerebro…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result.count ? `${result.count} nota${result.count === 1 ? '' : 's'} encontrada${result.count === 1 ? '' : 's'}` : 'Nada aprendido sobre eso'),
      declaration: {
        name: 'search_knowledge',
        description:
          'Busca en lo que aprendiste investigando ("¿qué aprendiste sobre…?", "¿qué sabes de lo que investigaste de…?"). Para preguntas normales sobre un tema aprendido ya recibes las notas relevantes en tu contexto; úsala cuando el usuario pregunte expresamente por lo aprendido.',
        parameters: {
          type: 'OBJECT',
          properties: { query: { type: 'STRING', description: 'El tema o la pregunta, en pocas palabras.' } },
          required: ['query'],
        },
      },
      run: (args, context) => searchKnowledge(args, context),
    },
    {
      label: 'Ver los temas aprendidos',
      activity: 'Revisando lo que he aprendido…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : `${result.count} tema${result.count === 1 ? '' : 's'} aprendido${result.count === 1 ? '' : 's'}`),
      declaration: {
        name: 'list_knowledge',
        description: 'Lista los temas y habilidades que aprendiste investigando ("¿qué has aprendido?", "¿qué temas sabes?").',
        parameters: { type: 'OBJECT', properties: {} },
      },
      run: (args, context) => listKnowledge(args, context),
    },
    {
      label: 'Olvidar un tema aprendido',
      activity: 'Preparando la confirmación…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'forget_knowledge',
        description: 'Borra de tu segundo cerebro todo lo aprendido sobre un tema. Siempre pide confirmación al usuario con una tarjeta; tú solo la propones.',
        parameters: {
          type: 'OBJECT',
          properties: { topic: { type: 'STRING', description: 'El tema (o parte de su nombre).' } },
          required: ['topic'],
        },
      },
      prepare: (args, context) => prepareForget(args, context),
      run: (args, context) => forget(args, context),
    },
  ],
  webhook: null,
};
