// The third brain for Eddie: clients, deals, prices, business context, how the
// user works and how he talks. He saves what the user tells him (sin pedirlo),
// looks things up, and says how valuable a client is and why. Forgetting asks
// for the user's OK on a card. The screen is Memoria → Negocios.
import { cleanArea, areaOf, clientValue, cleanTitle, matchNodes, AREAS, cleanNote } from '../../../../src/services/business.js';
import { listBusiness, deleteBusiness, saveBusiness } from '../../business/store.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para guardar negocios y clientes inicia sesión con Google (Configuración → Cuenta de Google).';
const getUser = async (context) => context.getUser?.();
const AREA_LIST = AREAS.map((a) => `${a.id} (${a.hint.toLowerCase()})`).join('; ');

async function save(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const area = cleanArea(args.area);
  if (!area) return { error: `Área no válida. Usa una de estas: ${AREAS.map((a) => a.id).join(', ')}.` };
  const name = cleanTitle(args.title);
  if (!name) return { error: 'Dime el nombre de lo que guardo (el cliente, el negocio, el precio…).' };
  const out = await saveBusiness(user.id, { area, title: name, summary: args.summary, status: args.status, value: args.value, amount: args.amount, related: args.related, note: cleanNote(args.note), source: 'chat' });
  if (out.error) return { error: out.error };
  const label = areaOf(area).label;
  const analysis = area === 'clientes' ? clientValue(out.node, await listBusiness(user.id)) : null;
  context.emit?.({ type: 'business_saved', id: out.node.id, area, title: name });
  return {
    saved: true,
    created: out.created,
    area: label,
    title: name,
    ...(analysis ? { value: analysis.level, reasons: analysis.reasons } : {}),
    summary: `${out.created ? 'Guardé' : 'Actualicé'} en Negocios: ${clip(name, 60)} (${label.toLowerCase()})`,
    note: 'Lo guardaste sin que el usuario lo pidiera: dilo en una frase corta («Lo apunté en negocios»). Si el usuario no te dijo cuánto vale un cliente, no inventes el valor.',
  };
}

async function recall(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const query = clip(args.query, 300);
  if (!query) return { error: 'Dime de qué cliente, negocio o precio hablamos.' };
  const nodes = await listBusiness(user.id);
  const found = matchNodes(nodes, query, { limit: 6 });
  if (!found.length) return { count: 0, note: 'No tengo nada guardado sobre eso. Pregunta al usuario lo que falta y guárdalo cuando lo diga.' };
  return {
    count: found.length,
    items: found.map((n) => {
      const value = n.area === 'clientes' ? clientValue(n, nodes) : null;
      return {
        area: areaOf(n.area)?.label,
        title: n.title,
        status: n.status,
        amount: n.amount,
        ...(value ? { value: value.level, reasons: value.reasons } : {}),
        summary: clip(n.summary, 200),
        last_notes: n.notes.slice(-3).map((x) => clip(x.text, 200)),
      };
    }),
    note: 'Usa esto para contestar con criterio. Si el cliente vale mucho o el precio ya se negoció, dilo y di por qué.',
  };
}

async function prepareForget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const found = matchNodes(await listBusiness(user.id), args.name, { limit: 3 });
  if (!found.length) return { error: 'No encontré nada guardado con ese nombre.' };
  if (found.length > 1 && !found.some((n) => n.title.toLowerCase() === cleanTitle(args.name).toLowerCase())) {
    return { error: `Hay varias coincidencias: ${found.map((n) => `«${n.title}»`).join(', ')}. Pide al usuario el nombre exacto.` };
  }
  const node = found.find((n) => n.title.toLowerCase() === cleanTitle(args.name).toLowerCase()) || found[0];
  return {
    args: { id: node.id },
    preview: {
      title: 'Olvidar en Negocios',
      confirmLabel: 'Olvidar',
      danger: true,
      fields: [
        { key: 'title', label: 'Qué', value: node.title },
        { key: 'area', label: 'Área', value: areaOf(node.area)?.label || node.area },
        { key: 'note', label: 'Se borra', value: `con sus ${node.notes.length} notas` },
      ],
    },
  };
}

async function forget(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const gone = await deleteBusiness(user.id, String(args.id || ''));
  if (!gone) return { error: 'Eso ya no está guardado.' };
  return { deleted: true, summary: 'Lo olvidé en Negocios' };
}

export default {
  id: 'business',
  name: 'Negocios',
  description: 'Tu tercer cerebro: clientes, negocios vendidos o negociados, precios, contexto del negocio, cómo trabajas y cómo hablas. Eddie lo guarda cuando lo cuentas, dice cuánto vale cada cliente y por qué, y lo usa para contestar con criterio.',
  icon: 'coin',
  category: 'asistente',
  // Offered when the conversation is about clients, deals, prices or work.
  route: /client|negoci|vend[ií]|venta|vender|precio|cotiz|propuesta|present[aé]|factura|cobr|presupuest|contrat|proveedor|cuánto (cobro|cobra|cuesta|vale)|cu[aá]nto (cobr|vale)|mi forma de (trabajar|hablar)|c[oó]mo (hablo|trabajo)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL'],
  note: 'Solo con sesión iniciada. Guarda clientes, negocios, precios, contexto, cómo trabajas y cómo hablas, con sus notas, y calcula el valor de cada cliente a partir de las ventas y de cuánto se habla de él. Tope de 200 cosas. Se ve y se edita en Memoria → Negocios.',
  details: async (user) => ({ items: (await listBusiness(user.id)).length }),
  tools: [
    {
      label: 'Guardar en negocios',
      activity: 'Anotando en negocios…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'save_business',
        description:
          `Guarda en tu tercer cerebro de NEGOCIOS lo que el usuario cuenta de su trabajo, SIN que lo pida: un cliente nuevo o una charla con él, un negocio vendido o negociado (con su precio y estado), un precio o cotización, el contexto de su negocio, cómo trabaja o cómo habla. Áreas: ${AREA_LIST}. Una llamada por cosa; si ya existe, la actualiza y añade la nota. Tras guardarlo, dilo en una frase. No inventes montos ni datos.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            area: { type: 'STRING', enum: AREAS.map((a) => a.id), description: 'Área: clientes, negocios, estilo (cómo habla), contexto, precios o trabajo.' },
            title: { type: 'STRING', description: 'Nombre corto: el cliente («Ana Pérez»), el negocio («Web para panadería»), el precio («Paquete básico»), etc. Máximo 80 caracteres.' },
            note: { type: 'STRING', description: 'Lo que pasó o se dijo, en una frase («negociamos el precio, pidió 10 % menos»).' },
            status: { type: 'STRING', description: 'Clientes: prospecto, activo, cerrado o perdido. Negocios: propuesto, en curso, vendido o perdido.' },
            amount: { type: 'NUMBER', description: 'Monto del negocio o precio, solo si lo dijo.' },
            related: { type: 'STRING', description: 'Para un negocio: el nombre del cliente al que se vendió o se negocia.' },
            value: { type: 'STRING', enum: ['alto', 'medio', 'bajo'], description: 'Opcional: tu juicio sobre la importancia de un cliente, solo si hay motivos claros (lo explicas en la nota).' },
            summary: { type: 'STRING', description: 'Opcional: una línea que describa la cosa (quién es, qué es).' },
          },
          required: ['area', 'title'],
        },
      },
      run: (args, context) => save(args, context),
    },
    {
      label: 'Consultar negocios',
      activity: 'Revisando negocios…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : result.count ? `${result.count} en negocios` : 'Nada guardado sobre eso'),
      declaration: {
        name: 'recall_business',
        description:
          'Busca en tu tercer cerebro de NEGOCIOS: clientes (con su valor y los motivos), negocios vendidos o negociados, precios, contexto y cómo habla el usuario. Úsala antes de contestar sobre un cliente, un precio o una propuesta, o cuando pregunte «¿cuánto vale…?», «¿qué le vendí a…?», «¿cómo le hablo a…?».',
        parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'El cliente, negocio o tema, en pocas palabras.' } }, required: ['query'] },
      },
      run: (args, context) => recall(args, context),
    },
    {
      label: 'Olvidar en negocios',
      activity: 'Preparando la confirmación…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'forget_business',
        description: 'Borra de tu tercer cerebro de negocios un cliente, negocio, precio o dato con sus notas. Siempre pide confirmación con una tarjeta; tú solo la propones.',
        parameters: { type: 'OBJECT', properties: { name: { type: 'STRING', description: 'El nombre (o parte) de lo que quiere borrar.' } }, required: ['name'] },
      },
      prepare: (args, context) => prepareForget(args, context),
      run: (args, context) => forget(args, context),
    },
  ],
  webhook: null,
};
