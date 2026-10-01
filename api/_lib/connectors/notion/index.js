// The owner's Notion: search and read pages, list the rows of a database,
// and write — create a page or add to one — always through the confirmation
// card. Like GitHub, this uses ONE internal-integration token kept in
// Vercel's environment (NOTION_TOKEN; it never reaches the browser or the
// database) and only works for a signed-in user whose Google email is listed
// in EDDIE_OWNER_EMAIL, because the token opens whatever pages the owner
// shared with the integration. Nothing here deletes or archives anything.
import { clip, fetchJson } from '../http.js';
import { isOwner } from '../github/index.js';
import { blocksToText, markdownToBlocks } from './blocks.js';

const API = 'https://api.notion.com/v1';
// The last version before "data sources" (2025-09-03) changed how databases
// are queried; this one keeps working and keeps the calls simple.
const NOTION_VERSION = '2022-06-28';
const MAX_TITLE = 200;
const MAX_CONTENT = 6000;
const MAX_READ_CHARS = 6000;
const MAX_BLOCK_PAGES = 2; // of 100 blocks
const MAX_SUBFETCHES = 12; // nested blocks (toggles, lists) read per page
const SEARCH_LIMIT = 8;
const ROW_LIMIT = 15;

class NotionError extends Error {}

const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// The 32-hex id inside a Notion link, or a bare id → "8-4-4-4-12"; null if none.
export function idFrom(value) {
  const s = String(value || '').trim();
  let hex = null;
  const uuid = /([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})/i.exec(s.replace(/[?#].*$/, ''));
  if (uuid && (/^[0-9a-f-]{32,36}$/i.test(s) || /notion\.(so|site|com)\//i.test(s))) hex = uuid.slice(1).join('');
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`.toLowerCase() : null;
}

async function ownerToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new NotionError('Para usar Notion, inicia sesión con tu cuenta de Google (la del dueño de Eddie).');
  if (!isOwner(user)) throw new NotionError('Notion solo está disponible para el dueño de Eddie (la cuenta de EDDIE_OWNER_EMAIL).');
  return process.env.NOTION_TOKEN;
}

const SHARE_HINT = 'Revisa que sea correcto y que esa página esté compartida con la integración (en Notion: en la página, menú ••• → Conexiones → agrega tu integración).';

async function notion(token, path, options = {}) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 9000,
  });
  if (ok) return data;
  if (status === 401) throw new NotionError('Notion rechazó el token: NOTION_TOKEN no es válido. Revisa la integración y actualízalo en Vercel.');
  if (status === 404 || data?.code === 'object_not_found') throw new NotionError(`Notion no encuentra eso. ${SHARE_HINT}`);
  if (status === 403) throw new NotionError('La integración de Notion no tiene permiso para esto (revisa sus capacidades: leer, insertar y actualizar contenido).');
  if (status === 429) throw new NotionError('Notion está limitando las solicitudes; inténtalo en unos segundos.');
  if (status === 400) throw new NotionError(`Notion no aceptó la petición: ${clip(data?.message, 140) || 'datos no válidos'}.`);
  throw new NotionError('Notion no respondió en este momento.');
}

const guarded = (fn) => async (args, context) => {
  try {
    return await fn(args, context);
  } catch (err) {
    if (err instanceof NotionError) return { error: err.message };
    throw err;
  }
};

const plain = (rich) => (Array.isArray(rich) ? rich.map((t) => t.plain_text ?? '').join('') : '');

export function titleOf(obj) {
  if (!obj) return '';
  if (obj.object === 'database') return plain(obj.title) || 'Sin título';
  const prop = Object.values(obj.properties || {}).find((p) => p.type === 'title');
  return plain(prop?.title) || 'Sin título';
}

const dateOnly = (iso) => (iso ? String(iso).slice(0, 10) : null);

function describe(obj) {
  return { id: obj.id, type: obj.object, title: clip(titleOf(obj), 120), url: obj.url || null, edited: dateOnly(obj.last_edited_time) };
}

async function search(token, query, type) {
  const body = { page_size: SEARCH_LIMIT, sort: { direction: 'descending', timestamp: 'last_edited_time' } };
  if (query) body.query = clip(query, 120);
  if (type === 'page' || type === 'database') body.filter = { property: 'object', value: type };
  const data = await notion(token, '/search', { method: 'POST', body: JSON.stringify(body) });
  return (data.results || []).filter((r) => !r.archived && !r.in_trash).map(describe);
}

// A page or database the user named: an id, a link or a title.
async function resolveObject(token, ref, type) {
  const id = idFrom(ref);
  if (id) {
    if (type !== 'database') {
      try {
        return describe(await notion(token, `/pages/${id}`));
      } catch (err) {
        if (type === 'page') throw err;
      }
    }
    return describe(await notion(token, `/databases/${id}`));
  }
  const wanted = normalize(ref);
  if (!wanted) throw new NotionError('Dime qué página o base de datos (su nombre o su enlace).');
  const found = await search(token, ref, type);
  const exact = found.filter((f) => normalize(f.title) === wanted);
  const pool = exact.length ? exact : found;
  if (pool.length === 1) return pool[0];
  if (!pool.length) throw new NotionError(`No encontré "${clip(ref, 80)}" en Notion. ${SHARE_HINT}`);
  throw new NotionError(`Hay varias coincidencias para "${clip(ref, 80)}": ${pool.slice(0, 5).map((f) => `«${f.title}»`).join(', ')}. Pregunta cuál.`);
}

async function searchNotion(args, context) {
  const token = await ownerToken(context);
  const results = await search(token, args.query, args.type);
  if (!results.length) return { results: [], note: `No encontré nada${args.query ? ` para "${clip(args.query, 60)}"` : ''}. ${SHARE_HINT}` };
  return { results };
}

// The blocks of a block/page, with the children of nested ones (toggles,
// list items) to a small depth, as [{ block, children }].
async function readBlocks(token, id, budget, depth = 0) {
  const nodes = [];
  let cursor;
  for (let page = 0; page < MAX_BLOCK_PAGES; page += 1) {
    const data = await notion(token, `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    for (const block of data.results || []) {
      const node = { block, children: [] };
      if (block.has_children && depth < 2 && block.type !== 'child_page' && block.type !== 'child_database' && budget.left > 0) {
        budget.left -= 1;
        node.children = await readBlocks(token, block.id, budget, depth + 1).catch(() => []);
      }
      nodes.push(node);
    }
    if (!data.has_more) break;
    cursor = data.next_cursor;
  }
  return nodes;
}

function flatProperty(p) {
  switch (p.type) {
    case 'select':
    case 'status':
      return p[p.type]?.name || null;
    case 'multi_select':
      return p.multi_select.map((o) => o.name).join(', ') || null;
    case 'date':
      return p.date ? `${dateOnly(p.date.start)}${p.date.end ? ` → ${dateOnly(p.date.end)}` : ''}` : null;
    case 'checkbox':
      return p.checkbox ? 'sí' : 'no';
    case 'number':
      return p.number ?? null;
    case 'rich_text':
      return clip(plain(p.rich_text), 120) || null;
    case 'url':
    case 'email':
    case 'phone_number':
      return p[p.type] || null;
    case 'people':
      return p.people.map((u) => u.name).filter(Boolean).join(', ') || null;
    case 'created_time':
    case 'last_edited_time':
      return dateOnly(p[p.type]);
    case 'formula':
      return p.formula?.[p.formula.type] ?? null;
    case 'relation':
      return p.relation.length ? `${p.relation.length} enlazados` : null;
    default:
      return null;
  }
}

function flatProperties(obj, limit = 8) {
  const out = {};
  for (const [name, p] of Object.entries(obj.properties || {})) {
    if (p.type === 'title' || Object.keys(out).length >= limit) continue;
    const v = flatProperty(p);
    if (v !== null && v !== '') out[name] = v;
  }
  return out;
}

async function readPage(args, context) {
  const token = await ownerToken(context);
  const ref = await resolveObject(token, args.page);
  if (ref.type !== 'page') throw new NotionError(`«${ref.title}» es una base de datos: usa notion_query_database para ver sus filas.`);
  const page = await notion(token, `/pages/${ref.id}`);
  const nodes = await readBlocks(token, ref.id, { left: MAX_SUBFETCHES });
  const full = blocksToText(nodes);
  const content = full.length > MAX_READ_CHARS ? `${full.slice(0, MAX_READ_CHARS)}…` : full;
  return {
    id: ref.id,
    title: titleOf(page),
    url: page.url || null,
    edited: dateOnly(page.last_edited_time),
    properties: flatProperties(page),
    content: content || '(La página está vacía.)',
    ...(full.length > MAX_READ_CHARS ? { truncated: true, note: 'La página es más larga; esto es solo el principio.' } : {}),
  };
}

async function queryDatabase(args, context) {
  const token = await ownerToken(context);
  const ref = await resolveObject(token, args.database);
  if (ref.type !== 'database') throw new NotionError(`«${ref.title}» es una página, no una base de datos: usa notion_read_page.`);
  const schema = await notion(token, `/databases/${ref.id}`);
  const titleName = Object.entries(schema.properties || {}).find(([, p]) => p.type === 'title')?.[0];
  const body = { page_size: ROW_LIMIT, sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] };
  if (args.text && titleName) body.filter = { property: titleName, title: { contains: clip(args.text, 100) } };
  const data = await notion(token, `/databases/${ref.id}/query`, { method: 'POST', body: JSON.stringify(body) });
  const rows = (data.results || []).filter((r) => !r.archived && !r.in_trash).map((r) => ({ id: r.id, title: clip(titleOf(r), 120), url: r.url || null, properties: flatProperties(r, 6) }));
  return { database: ref.title, count: rows.length, ...(data.has_more ? { has_more: true } : {}), rows, ...(rows.length ? {} : { note: 'No hay filas que coincidan.' }) };
}

// ---- writing -------------------------------------------------------------

const cleanText = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max); // eslint-disable-line no-control-regex

async function resolveParent(token, ref) {
  const wanted = ref || process.env.NOTION_PARENT_PAGE_ID;
  if (!wanted) {
    throw new NotionError('Dime dentro de qué página o base de datos la creo (su nombre o enlace). Si prefieres, configura NOTION_PARENT_PAGE_ID en Vercel con tu página de notas.');
  }
  return resolveObject(token, wanted);
}

async function prepareCreate(args, context) {
  const token = await ownerToken(context);
  const title = cleanText(args.title, MAX_TITLE).replace(/\s+/g, ' ');
  if (!title) return { error: 'La página necesita un título.' };
  const parent = await resolveParent(token, args.parent);
  const content = cleanText(args.content, MAX_CONTENT);
  return {
    args: { title, content, parent: parent.id },
    preview: {
      title: 'Crear página en Notion',
      confirmLabel: 'Crear',
      fields: [
        { key: 'parent', label: parent.type === 'database' ? 'En la base de datos' : 'Dentro de', value: parent.title },
        { key: 'title', label: 'Título', value: title, editable: true },
        { key: 'content', label: 'Contenido', value: content, editable: true, multiline: true },
      ],
    },
  };
}

async function createPage(args, context) {
  const token = await ownerToken(context);
  const title = cleanText(args.title, MAX_TITLE).replace(/\s+/g, ' ');
  if (!title) throw new NotionError('La página necesita un título.');
  const parent = await resolveParent(token, args.parent);
  const { blocks, truncated } = markdownToBlocks(cleanText(args.content, MAX_CONTENT));
  const title_prop = { title: [{ type: 'text', text: { content: title } }] };
  let body;
  if (parent.type === 'database') {
    const schema = await notion(token, `/databases/${parent.id}`);
    const titleName = Object.entries(schema.properties || {}).find(([, p]) => p.type === 'title')?.[0] || 'Name';
    body = { parent: { database_id: parent.id }, properties: { [titleName]: title_prop } };
  } else {
    body = { parent: { page_id: parent.id }, properties: { title: title_prop } };
  }
  if (blocks.length) body.children = blocks;
  const page = await notion(token, '/pages', { method: 'POST', body: JSON.stringify(body) });
  // "Comprueba": read the page back and check the title (and that it has content).
  let verified = null;
  try {
    const back = await notion(token, `/pages/${page.id}`);
    verified = titleOf(back) === title;
    if (verified && blocks.length) {
      const kids = await notion(token, `/blocks/${page.id}/children?page_size=1`);
      verified = (kids.results || []).length > 0;
    }
  } catch {
    verified = null;
  }
  return {
    created: true,
    id: page.id,
    title,
    parent: parent.title,
    url: page.url || null,
    verified,
    summary: `Creé la página «${title}» en Notion (dentro de «${parent.title}»).`,
    ...(truncated ? { note: 'El contenido era muy largo y se guardó solo el principio.' } : {}),
  };
}

async function prepareAppend(args, context) {
  const token = await ownerToken(context);
  const page = await resolveObject(token, args.page);
  if (page.type !== 'page') throw new NotionError(`«${page.title}» es una base de datos: para añadir una fila usa notion_create_page con esa base como destino.`);
  const text = cleanText(args.text, MAX_CONTENT);
  if (!text) return { error: 'No hay nada que añadir.' };
  return {
    args: { page: page.id, text },
    preview: {
      title: 'Añadir a una página de Notion',
      confirmLabel: 'Añadir',
      fields: [
        { key: 'page', label: 'Página', value: page.title },
        { key: 'text', label: 'Texto a añadir', value: text, editable: true, multiline: true },
      ],
    },
  };
}

async function appendToPage(args, context) {
  const token = await ownerToken(context);
  const page = await resolveObject(token, args.page);
  if (page.type !== 'page') throw new NotionError(`«${page.title}» no es una página.`);
  const { blocks, truncated } = markdownToBlocks(cleanText(args.text, MAX_CONTENT));
  if (!blocks.length) throw new NotionError('No hay nada que añadir.');
  const out = await notion(token, `/blocks/${page.id}/children`, { method: 'PATCH', body: JSON.stringify({ children: blocks }) });
  // Notion answers with the blocks it added: they should be as many as we sent.
  const verified = Array.isArray(out?.results) ? out.results.length >= blocks.length : null;
  return {
    appended: true,
    id: page.id,
    title: page.title,
    url: page.url,
    blocks: blocks.length,
    verified,
    summary: `Añadí ${blocks.length === 1 ? 'un bloque' : `${blocks.length} bloques`} a «${page.title}» en Notion.`,
    ...(truncated ? { note: 'El texto era muy largo y se añadió solo el principio.' } : {}),
  };
}

const TYPE_PARAM = { type: 'STRING', enum: ['page', 'database'], description: 'Limitar a páginas o a bases de datos (opcional).' };

export default {
  id: 'notion',
  name: 'Notion',
  description: 'Eddie busca y lee tus páginas de Notion, mira las filas de tus bases de datos y crea páginas o añade texto, siempre con tu confirmación.',
  icon: 'doc',
  category: 'productividad',
  // Offered to the model only when the conversation touches the topic.
  route: /notion|workspace|espacio de trabajo|apuntes|mis notas|mi libreta|p[aá]ginas? (de|en|del|nueva)|base de datos de|cre[ae]r? (una |otra )?(nota|p[aá]gina)|(guarda|guardar|anota|a[ñn]ade|a[ñn]adir|agrega|agregar)\w* (esto|eso|lo|la)? ?(en|a) (mis |mi )?(notas|libreta|p[aá]gina)/i,
  auth: {
    type: 'google-login',
    isConnected: (user) => isOwner(user),
  },
  requiredEnv: ['NOTION_TOKEN', 'EDDIE_OWNER_EMAIL'],
  note: 'Solo el dueño de Eddie (la cuenta de EDDIE_OWNER_EMAIL) puede usarlo, y solo ve las páginas que compartas con la integración en Notion (••• → Conexiones). Eddie nunca crea ni añade nada sin que lo confirmes; no borra ni archiva. Opcional: NOTION_PARENT_PAGE_ID, la página donde crear notas si no dices otra.',
  tools: [
    {
      label: 'Buscar en Notion',
      activity: 'Buscando en Notion…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.results.length} resultado${r.results.length === 1 ? '' : 's'} en Notion`,
      declaration: {
        name: 'notion_search',
        description: 'Busca páginas y bases de datos de Notion por título o contenido ("busca mis apuntes de React", "¿qué páginas tengo en Notion?"). Sin query lista las editadas más recientemente.',
        parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Qué buscar (opcional).' }, type: TYPE_PARAM } },
      },
      run: guarded(searchNotion),
    },
    {
      label: 'Leer una página de Notion',
      activity: 'Leyendo la página de Notion…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `Leí «${r.title}»`,
      declaration: {
        name: 'notion_read_page',
        description: 'Lee una página de Notion (su contenido y propiedades) para resumirla o responder sobre ella. Acepta el título, el enlace o el id.',
        parameters: { type: 'OBJECT', properties: { page: { type: 'STRING', description: 'Título, enlace o id de la página.' } }, required: ['page'] },
      },
      run: guarded(readPage),
    },
    {
      label: 'Ver las filas de una base de datos',
      activity: 'Consultando la base de datos de Notion…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.count} fila${r.count === 1 ? '' : 's'} en «${r.database}»`,
      declaration: {
        name: 'notion_query_database',
        description: 'Lista las filas más recientes de una base de datos de Notion (tareas, proyectos, lecturas…) con sus propiedades principales; opcionalmente las que contengan un texto en el título.',
        parameters: {
          type: 'OBJECT',
          properties: {
            database: { type: 'STRING', description: 'Nombre, enlace o id de la base de datos.' },
            text: { type: 'STRING', description: 'Texto que debe contener el título (opcional).' },
          },
          required: ['database'],
        },
      },
      run: guarded(queryDatabase),
    },
    {
      label: 'Crear una página en Notion',
      activity: 'Preparando la página de Notion…',
      sensitive: true,
      declaration: {
        name: 'notion_create_page',
        description:
          'Crea una página nueva en Notion (o una fila nueva si el destino es una base de datos) con un título y contenido en Markdown sencillo (# títulos, - listas, - [ ] tareas, > citas). Siempre pide confirmación con una tarjeta; tú solo la propones. Si el usuario no dice dónde, no inventes el destino.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Título de la página.' },
            content: { type: 'STRING', description: 'Contenido en Markdown sencillo (opcional).' },
            parent: { type: 'STRING', description: 'Página o base de datos donde crearla: nombre, enlace o id. Opcional si hay una página de notas por defecto.' },
          },
          required: ['title'],
        },
      },
      prepare: guarded(prepareCreate),
      run: guarded(createPage),
    },
    {
      label: 'Añadir texto a una página de Notion',
      activity: 'Preparando el texto para Notion…',
      sensitive: true,
      declaration: {
        name: 'notion_append',
        description: 'Añade texto (Markdown sencillo) al final de una página existente de Notion. Siempre pide confirmación con una tarjeta; tú solo lo propones.',
        parameters: {
          type: 'OBJECT',
          properties: {
            page: { type: 'STRING', description: 'Título, enlace o id de la página.' },
            text: { type: 'STRING', description: 'Texto a añadir, en Markdown sencillo.' },
          },
          required: ['page', 'text'],
        },
      },
      prepare: guarded(prepareAppend),
      run: guarded(appendToPage),
    },
  ],
  webhook: null,
};
