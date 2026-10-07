// Pictures for Eddie: create one from a description, FIND real ones on the
// internet (free sources, with their credit), edit one (the one the user just
// attached, one from the gallery, or the latest), list the gallery and delete
// from it (with the user's OK on a card). The picture itself never
// goes to the model: the tools emit a `show_image` action (the app puts it in
// the middle of Inicio and in the chat; Telegram gets it as a photo) and the
// model only hears that it worked.
import { MediaError, ASPECTS } from '../../media/image.js';
import { createImage, editImage, findImages, removeImage } from '../../media/create.js';
import { getMedia, listMedia, mediaUsage } from '../../media/store.js';
import { clip } from '../http.js';

const SIGN_IN = 'Para crear y guardar imágenes inicia sesión con Google (Configuración → Cuenta de Google).';
const getUser = async (context) => context.getUser?.();

const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function failure(err) {
  if (err instanceof MediaError) return { error: err.message };
  throw err;
}

function shown(context, item, extra = {}) {
  context.emit?.({ type: 'show_image', id: item.id, prompt: item.prompt, provider: item.provider });
  return {
    id: item.id,
    prompt: item.prompt,
    provider: item.provider,
    ...extra,
    note: `${
      item.provider === 'gemini' ? '' : 'Gemini no estaba disponible (cupo o error) y la hice con un servicio de respaldo gratis: dícelo. '
    }La imagen ya se ve en el centro de Inicio, en el chat y se guarda en la Galería; el usuario la ve, tú no. Dile en una frase qué hiciste y ofrécele ajustarla («cámbiale…»). No describas detalles que no puedes ver.`,
  };
}

async function create(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  try {
    const { item } = await createImage({ userId: user.id, prompt: args.prompt, aspect: args.aspect_ratio });
    return shown(context, item, { created: true, summary: `Creé una imagen: «${clip(item.prompt, 80)}»` });
  } catch (err) {
    return failure(err);
  }
}

// Real pictures from the internet: downloaded, kept in the gallery with their credit and
// shown in the chat and on Telegram (they do not replace the picture in the middle of Inicio).
async function find(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  try {
    const { items, query, tried } = await findImages({ userId: user.id, query: args.query, count: args.count });
    for (const item of items) {
      context.emit?.({ type: 'show_image', id: item.id, prompt: item.prompt, provider: item.provider, found: true, credit: item.credit, license: item.license, sourceUrl: item.sourceUrl });
    }
    const unverified = items.some((i) => i.provider === 'web');
    return {
      query,
      found: items.length,
      sources: [...new Set(items.map((i) => i.provider))],
      images: items.map((i) => ({ id: i.id, title: clip(i.prompt, 80), credit: i.credit, license: i.license })),
      searched_in: tried,
      summary: `Encontré ${items.length} imagen${items.length === 1 ? '' : 'es'} de «${clip(query, 60)}»`,
      note: `Ya se ven en el chat (con su autor y licencia) y llegan al Telegram del usuario; tú no las ves. Dile en una frase cuántas encontraste y de qué fuente (${[...new Set(items.map((i) => i.provider))].join(', ')})${
        unverified ? '; algunas vienen de la web general y su licencia no está verificada: avísalo' : ''
      }. No describas detalles que no puedes ver; si no son lo que busca, ofrécele otra búsqueda con otras palabras o crearla.`,
    };
  } catch (err) {
    return failure(err);
  }
}

async function edit(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  try {
    const { item, parent } = await editImage({ userId: user.id, instruction: args.instruction, id: args.image_id || null, attached: context.attachedImage || null });
    return shown(context, item, { edited: true, from: parent, summary: `Edité ${parent}: «${clip(item.prompt, 80)}»` });
  } catch (err) {
    return failure(err);
  }
}

async function list(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
  const items = (await listMedia(user.id, { limit })).filter((m) => m.kind === 'imagen');
  if (!items.length) return { count: 0, note: 'Todavía no hay imágenes en la galería. Ofrécele crear una.' };
  const usage = await mediaUsage(user.id);
  return { count: usage.count, shown: items.length, images: items.map((m) => ({ id: m.id, prompt: m.prompt, date: m.createdAt.slice(0, 10), editOf: m.parentId })) };
}

// The picture the user meant: an id, "la última", or words of its description.
export function matchImage(items, text) {
  const q = normalize(text);
  if (!q || /\b(ultim[ao]|reciente|anterior|esa|esta|la que (hiciste|creaste))\b/.test(q)) return { image: items[0] || null, candidates: [] };
  const words = new Set(q.split(' ').filter((w) => w.length > 2));
  const scored = items
    .map((m) => {
      const prompt = normalize(m.prompt);
      const shared = prompt.split(' ').filter((w) => words.has(w)).length;
      return { m, score: prompt.includes(q) ? 100 : words.size ? (shared / words.size) * 60 : 0 };
    })
    .filter((s) => s.score >= 25)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { image: null, candidates: [] };
  if (scored.length > 1 && scored[0].score === scored[1].score) return { image: null, candidates: scored.filter((s) => s.score === scored[0].score).map((s) => s.m) };
  return { image: scored[0].m, candidates: [] };
}

async function prepareDelete(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  let image = null;
  if (args.id) {
    image = await getMedia(user.id, String(args.id));
  } else {
    const found = matchImage((await listMedia(user.id)).filter((m) => m.kind === 'imagen'), args.which);
    if (found.candidates.length) return { error: `Hay varias imágenes parecidas: ${found.candidates.map((m) => `«${clip(m.prompt, 50)}»`).join(', ')}. Pídele al usuario que diga cuál.` };
    image = found.image;
  }
  if (!image) return { error: 'No encontré esa imagen en la galería.' };
  return {
    args: { id: image.id },
    preview: {
      title: 'Eliminar una imagen',
      confirmLabel: 'Eliminar',
      danger: true,
      fields: [
        { key: 'prompt', label: 'Imagen', value: clip(image.prompt, 200) },
        { key: 'date', label: 'Creada', value: image.createdAt.slice(0, 10) },
        { key: 'note', label: 'Se borra', value: 'de la galería, para siempre (las versiones editadas se quedan)' },
      ],
    },
  };
}

async function remove(args, context) {
  const user = await getUser(context);
  if (!user) return { error: SIGN_IN };
  const gone = await removeImage(user.id, String(args.id || ''));
  if (!gone) return { error: 'Esa imagen ya no está en la galería.' };
  context.emit?.({ type: 'media_deleted', id: String(args.id) });
  return { deleted: true, summary: 'Eliminé la imagen de la galería.' };
}

export default {
  id: 'media',
  name: 'Imágenes',
  description: 'Eddie crea imágenes desde una descripción, o las BUSCA en internet (fuentes libres con su autor y licencia) y te las manda; edita la que le muestres o una de tu galería («quítale el fondo», «hazla de noche») y las elimina cuando se lo pidas. Se ven en el chat y en la Galería (las creadas, también en el centro de Inicio) y llegan a tu Telegram.',
  icon: 'image',
  category: 'multimedia',
  // Offered when the conversation is about pictures.
  route: /im[aá]gen|imagenes|foto|fotograf|dibuj|ilustr|ret[oó]ca|logo|c[oó]mo (se ve|luce|es un|es una)|(ens[eé][ñn]a|mu[eé]stra)me (un|una|c[oó]mo)|fondo de pantalla|wallpaper|galer[ií]a|p[ií]ntame|pintura|c[oó]mic|caricatura|avatar|p[oó]ster|poster|quita(le)? el fondo|(crea|genera|haz|hazme|dise[ñn]a)\w*.*(imagen|foto|logo|dibujo|ilustraci)/i,
  auth: null,
  requiredEnv: ['DATABASE_URL', 'GEMINI_API_KEY'],
  note: 'Crear: usa el modelo de imágenes de Gemini con la misma GEMINI_API_KEY (cupo gratis diario). Buscar: Openverse y Wikimedia Commons sin clave, Pexels con PEXELS_API_KEY (gratis, opcional) y, si no hay nada, la web general (Tavily; sin licencia verificada); tope de DAILY_IMAGE_SEARCH_LIMIT por día (40 por defecto). Si Gemini se queda sin cupo, una imagen nueva puede salir de Pollinations (gratis, sin clave; MEDIA_FALLBACK=off lo apaga). Las imágenes se guardan en tu galería (hasta 60 o 150 MB) y se borran con tu confirmación. Tope de DAILY_IMAGE_LIMIT por día (20 por defecto). Solo con sesión iniciada.',
  details: async (user) => {
    const usage = await mediaUsage(user.id);
    return { images: usage.count, last24h: usage.last24h };
  },
  tools: [
    {
      label: 'Crear una imagen',
      activity: 'Creando la imagen…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'create_image',
        description:
          'Crea una IMAGEN nueva a partir de una descripción y la muestra al usuario (centro de Inicio, chat y galería). Úsala cuando pida dibujar, generar, crear o diseñar una imagen, ilustración, logo, póster o fondo; no pidas confirmación, ya lo pidió. Escribe la descripción en detalle (sujeto, estilo, colores, ambiente, composición); si la idea es corta, enriquécela con buen criterio sin cambiar lo que pidió. No crees imágenes sexuales, de menores, violentas explícitas ni que suplanten a personas reales. Tarda unos 10-30 segundos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            prompt: { type: 'STRING', description: 'La descripción de la imagen, detallada (máx. 800 caracteres).' },
            aspect_ratio: { type: 'STRING', enum: ASPECTS, description: 'Proporción: 1:1 (cuadrada, por defecto), 16:9 (horizontal), 9:16 (vertical), 4:3 o 3:4.' },
          },
          required: ['prompt'],
        },
      },
      run: (args, context) => create(args, context),
    },
    {
      label: 'Buscar imágenes en internet',
      activity: 'Buscando imágenes…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'search_images',
        description:
          'BUSCA fotos o imágenes que YA EXISTEN en internet (fuentes libres con autor y licencia; la web general si no hay nada) y se las muestra y manda al usuario, hasta 4. Úsala cuando pida «busca / mándame / pásame / enséñame una foto o imagen de X» de algo real: un lugar, un animal, una persona pública, un objeto, un logo, una obra, un producto. Si lo que quiere es algo inventado o personalizado (un dibujo, una ilustración, un póster suyo), usa create_image. No pidas confirmación. No busca contenido sexual explícito ni violento.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Qué buscar, en pocas palabras (2 a 6). Las fuentes libres responden mejor en inglés para temas internacionales; para lo local usa el nombre local. Sin frases largas.' },
            count: { type: 'INTEGER', description: 'Cuántas imágenes (1 a 4, por defecto 3). Una sola si pide «una foto».' },
          },
          required: ['query'],
        },
      },
      run: (args, context) => find(args, context),
    },
    {
      label: 'Editar una imagen',
      activity: 'Editando la imagen…',
      risk: 'write',
      sensitive: false,
      summarize: (result) => result?.summary,
      declaration: {
        name: 'edit_image',
        description:
          'Edita una imagen existente según una instrucción y guarda el resultado como una imagen nueva (la original se conserva). Edita, por orden: la imagen que el usuario adjuntó en este mensaje, la de la galería con image_id, o la última que hiciste. Úsala para «quítale el fondo», «hazla de noche», «agrégale un sombrero», «cambia el estilo a acuarela». Tarda unos 10-30 segundos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            instruction: { type: 'STRING', description: 'Qué cambiar, claro y concreto (máx. 800 caracteres).' },
            image_id: { type: 'STRING', description: 'Opcional: el id de la imagen de la galería (de list_images). Sin él se edita la adjunta o la última.' },
          },
          required: ['instruction'],
        },
      },
      run: (args, context) => edit(args, context),
    },
    {
      label: 'Ver la galería de imágenes',
      activity: 'Revisando la galería…',
      risk: 'read',
      sensitive: false,
      summarize: (result) => (result?.error ? undefined : `${result.count} imagen${result.count === 1 ? '' : 'es'} en la galería`),
      declaration: {
        name: 'list_images',
        description: 'Lista las imágenes recientes de la galería (descripción, fecha e id): úsala para encontrar «la de ayer» o la que el usuario nombra, y para saber qué id editar o eliminar.',
        parameters: { type: 'OBJECT', properties: { limit: { type: 'INTEGER', description: 'Cuántas mostrar (1-20, por defecto 8).' } } },
      },
      run: (args, context) => list(args, context),
    },
    {
      label: 'Eliminar una imagen',
      activity: 'Preparando la confirmación…',
      risk: 'confirm',
      sensitive: true,
      declaration: {
        name: 'delete_image',
        description: 'Elimina una imagen de la galería. Siempre pide confirmación con una tarjeta; tú solo la propones. Indica cuál con id (de list_images) o con which: «la última» o palabras de su descripción.',
        parameters: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING', description: 'El id de la imagen (de list_images).' },
            which: { type: 'STRING', description: 'Cuál: «la última» o palabras de su descripción.' },
          },
        },
      },
      prepare: (args, context) => prepareDelete(args, context),
      run: (args, context) => remove(args, context),
    },
  ],
  webhook: null,
};
