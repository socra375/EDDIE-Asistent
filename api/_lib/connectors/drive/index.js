// The Drive folders the user connected ("Negocio", "Servicio al cliente"…).
// Eddie can see what is in them and search them by name — only inside those
// folders, never the rest of the Drive — and then reads the Docs and Sheets it
// finds with read_document / read_spreadsheet (the Google Docs and Sheets
// connector). Names and structure only (drive.metadata.readonly). On request
// (import_drive_to_business, or the card's button) Eddie also reads their text once and
// sorts what it says into the third brain, Negocios (api/_lib/drive/importer.js);
// otherwise only the folder's id, name and purpose are stored.
// The folders are connected from the hub (api/_lib/drive/handlers.js).
import { getValidAccessToken, hasDocsAccess, hasDriveAccess } from '../../googleCredentials.js';
import { DriveError, describeFile, getFile, insideConnected, listChildren, parseFolderRef, searchFolders } from '../../drive/folders.js';
import { listFolders } from '../../drive/store.js';
import { folderCounts } from '../../drive/importStore.js';
import { importFolder } from '../../drive/importer.js';
import { clip } from '../http.js';

const TOP_ITEMS = 30;
const READ_HINT = 'Lee los documentos con read_document y las hojas con read_spreadsheet (usa su url). Los PDF, Word y demás se ven en la lista pero no se pueden leer.';

async function driveSession(context) {
  const user = await context.getUser?.();
  if (!user) throw new DriveError('Para usar tus carpetas de Drive, inicia sesión con Google y pulsa "Conectar Carpetas de Drive" en Conectores.');
  if (!(await hasDriveAccess(user.id))) throw new DriveError('Las carpetas de Drive no están conectadas: pulsa "Conectar Carpetas de Drive" en el módulo Conectores.');
  const folders = await listFolders(user.id);
  if (!folders.length) throw new DriveError('Todavía no hay ninguna carpeta conectada: pega el enlace de una en Conectores → Carpetas de Drive.');
  let token;
  try {
    token = await getValidAccessToken(user.id);
  } catch (err) {
    throw new DriveError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a conectar las carpetas de Drive.');
  }
  return { token, folders };
}

// Wraps a tool body so a DriveError becomes a readable { error }.
function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof DriveError) return { error: err.message };
      throw err;
    }
  };
}

const item = (f) => ({ ...f, name: clip(f.name, 120) });

// The folder asked for, as { folderId, name } — only a connected folder or one inside it.
async function folderInside(args, { token, folders }) {
  const id = parseFolderRef(args.folder);
  if (!id) throw new DriveError('Dame el id o el enlace de una de las carpetas (los ves en el resultado de list_drive_folder).');
  const root = folders.find((f) => f.folderId === id);
  if (root) return { folderId: id, name: root.name };
  if (!(await insideConnected(token, id, folders.map((f) => f.folderId)))) {
    throw new DriveError('Esa carpeta no está dentro de las que el usuario conectó: solo puedo mirar en las conectadas.');
  }
  const file = await getFile(token, id);
  return { folderId: id, name: clip(file?.name, 80) || 'Carpeta' };
}

async function listDriveFolder(args, context) {
  const session = await driveSession(context);
  if (!args.folder) {
    // The connected folders, with what is at the top of each.
    const out = await Promise.all(
      session.folders.map(async (f) => {
        const { files, more } = await listChildren(session.token, f.folderId);
        return { name: f.name, purpose: f.purpose, id: f.folderId, items: files.slice(0, TOP_ITEMS).map((x) => item(describeFile(x))), more: more || files.length > TOP_ITEMS };
      }),
    );
    return { folders: out, note: `${READ_HINT} Para entrar en una subcarpeta, usa list_drive_folder con su id.` };
  }
  const folder = await folderInside(args, session);
  const { files, more } = await listChildren(session.token, folder.folderId);
  return {
    folder: folder.name,
    id: folder.folderId,
    items: files.map((f) => item(describeFile(f))),
    more,
    note: files.length ? `${READ_HINT}${more ? ' Hay más archivos de los que se muestran: afina con search_drive.' : ''}` : 'La carpeta está vacía.',
  };
}

async function searchDrive(args, context) {
  const query = String(args.query ?? '').trim();
  if (query.length < 2) throw new DriveError('Dime qué buscar (al menos dos letras): el nombre de un cliente, un plan, un documento…');
  const session = await driveSession(context);
  const roots = args.folder ? [await folderInside(args, session)] : session.folders.map((f) => ({ folderId: f.folderId, name: f.name }));
  const { found, searched, complete } = await searchFolders(session.token, roots, query);
  return {
    query,
    results: found.map((f) => ({ ...item(f), where: clip(f.where, 160) })),
    searchedFolders: searched,
    note: found.length
      ? `${READ_HINT}${complete ? '' : ' La búsqueda no llegó a todas las subcarpetas: si no está lo que buscas, entra a la carpeta con list_drive_folder.'}`
      : `No encontré «${clip(query, 60)}» por nombre${complete ? '' : ' (y no se revisaron todas las subcarpetas)'}. La búsqueda es solo por nombre de archivo, no por lo que dice dentro: prueba con otra palabra o mira la carpeta con list_drive_folder.`,
  };
}

const plain = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// One batch of the import (api/_lib/drive/importer.js). The first call for a folder looks at it again;
// the following ones carry on with what is pending.
async function importToBusiness(args, context) {
  const user = await context.getUser?.();
  if (!user) throw new DriveError('Para importar tus carpetas, inicia sesión con Google.');
  if (!(await hasDriveAccess(user.id))) throw new DriveError('Las carpetas de Drive no están conectadas: pulsa "Conectar Carpetas de Drive" en el módulo Conectores.');
  if (!(await hasDocsAccess(user.id))) throw new DriveError('Para leer los documentos y hojas, conecta también «Google Docs y Sheets» en Conectores.');
  const folders = await listFolders(user.id);
  if (!folders.length) throw new DriveError('Todavía no hay ninguna carpeta conectada: pega el enlace de una en Conectores → Carpetas de Drive.');
  const wanted = plain(args.folder);
  let folder;
  if (wanted) {
    folder = folders.find((f) => plain(f.name) === wanted) || folders.find((f) => plain(f.name).includes(wanted) || wanted.includes(plain(f.name)));
    if (!folder) throw new DriveError(`No hay una carpeta conectada llamada «${clip(args.folder, 60)}». Las conectadas son: ${folders.map((f) => `«${f.name}»`).join(', ')}.`);
  } else {
    // The first one still being imported, else the first.
    const counts = await Promise.all(folders.map((f) => folderCounts(user.id, f.id)));
    folder = folders.find((_, i) => counts[i].pending > 0) || folders[0];
  }
  const before = await folderCounts(user.id, folder.id);
  const result = await importFolder(user.id, folder, { start: before.pending === 0 });
  const total = result.listing;
  if (result.created + result.updated > 0) context.emit?.({ type: 'business_saved', title: folder.name, imported: result.created + result.updated });
  return {
    folder: folder.name,
    ...(total ? { filesFound: total.found, ignoredFiles: total.ignored, listingIncomplete: total.truncated } : {}),
    read: result.processed,
    created: result.created,
    updated: result.updated,
    withoutUsefulInfo: result.empty,
    failed: result.failed,
    remaining: result.remaining,
    saved: result.items.map((i) => `${i.title} (${i.area}${i.created ? ', nuevo' : ''})`),
    ...(result.stopped ? { stopped: result.stopped } : {}),
    note: result.stopped
      ? `Se detuvo: ${result.stopped}`
      : result.remaining
        ? `Faltan ${result.remaining} archivos: llama de nuevo a import_drive_to_business con la misma carpeta para seguir.`
        : `Listo. El usuario puede verlo en el módulo Negocios y deshacerlo desde Conectores → Carpetas de Drive.${total?.ignored ? ' Los PDF, Word y demás archivos no se leen.' : ''}`,
  };
}

export default {
  id: 'drive',
  name: 'Carpetas de Drive',
  description:
    'Conecta carpetas de tu Drive (por ejemplo «Negocio» y «Servicio al cliente») y Eddie las consulta cuando le preguntas por un cliente, un negocio o un plan: busca por nombre, mira qué hay dentro y lee los documentos y hojas que encuentra.',
  icon: 'cloud',
  category: 'productividad',
  // Offered to the model only when the conversation touches the topic.
  route: /carpeta|drive|cerebro|import|export|pasa(r|s)? |archivo|documento|cliente|negocio|propuesta|contrato|cotiza|presupuesto|precio|\bplan(es)?\b|servicio al|qu[eé] (tengo|hay|dice)/i,
  auth: {
    type: 'google-login',
    scope: 'drive',
    isConnected: (user) => hasDriveAccess(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Eddie solo mira las carpetas que conectes (y lo que hay dentro), en solo lectura: no cambia, mueve ni borra nada de tu Drive. Con «Importar al cerebro» lee sus documentos y hojas una vez y guarda en Negocios lo que dicen (clientes, precios, cómo hablas…), sin pisar lo que ya escribiste y con opción de deshacer. Ve nombres y estructura; el texto de los documentos y hojas lo lee con el permiso de Google Docs y Sheets, así que conéctalo también.',
  details: async (user) => {
    if (!user) return null;
    const folders = await listFolders(user.id);
    // What was imported from each folder into the third brain, for the card's button and summary.
    // A failure here must not hide the folders themselves.
    const counts = (f) => folderCounts(user.id, f.id).catch(() => ({ pending: 0, done: 0, empty: 0, failed: 0, lastAt: null, errors: [] }));
    return { folders: await Promise.all(folders.map(async (f) => ({ ...f, import: await counts(f) }))) };
  },
  tools: [
    {
      label: 'Ver tus carpetas de Drive',
      activity: 'Mirando tu Drive…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => (r.folders ? `${r.folders.length} carpeta${r.folders.length === 1 ? '' : 's'}` : `${r.items.length} elemento${r.items.length === 1 ? '' : 's'}`),
      declaration: {
        name: 'list_drive_folder',
        description:
          'Muestra lo que hay en las carpetas de Drive que el usuario conectó (sin argumentos: lo de más arriba de cada una) o dentro de una de ellas o de sus subcarpetas (folder = id o enlace). Devuelve nombre, tipo, enlace y fecha de cada archivo. Solo mira dentro de las carpetas conectadas.',
        parameters: {
          type: 'OBJECT',
          properties: { folder: { type: 'STRING', description: 'El id o el enlace de una carpeta conectada o de una subcarpeta suya. Sin él: todas las conectadas.' } },
        },
      },
      run: guarded(listDriveFolder),
    },
    {
      label: 'Buscar en tus carpetas de Drive',
      activity: 'Buscando en tu Drive…',
      risk: 'read',
      sensitive: false,
      summarize: (r) => `${r.results.length} resultado${r.results.length === 1 ? '' : 's'}`,
      declaration: {
        name: 'search_drive',
        description:
          'Busca por NOMBRE de archivo (todas las palabras, sin importar acentos ni mayúsculas) dentro de las carpetas de Drive que el usuario conectó y sus subcarpetas. Úsala cuando pregunte por un cliente, un negocio, un plan, un contrato o cualquier cosa que pueda estar en sus carpetas, y luego lee lo que encuentres con read_document o read_spreadsheet. No busca dentro del texto de los archivos.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Palabras del nombre del archivo, p. ej. "Ana Pérez" o "plan 2027".' },
            folder: { type: 'STRING', description: 'Opcional: buscar solo dentro de esta carpeta (id o enlace).' },
          },
          required: ['query'],
        },
      },
      run: guarded(searchDrive),
    },
    {
      label: 'Importar una carpeta de Drive a tu cerebro de negocios',
      activity: 'Leyendo tus documentos para el cerebro…',
      risk: 'write',
      sensitive: false,
      summarize: (r) => (r.error ? 'No se pudo' : `${r.created} nuevo${r.created === 1 ? '' : 's'}, ${r.updated} actualizado${r.updated === 1 ? '' : 's'}${r.remaining ? `, faltan ${r.remaining}` : ''}`),
      declaration: {
        name: 'import_drive_to_business',
        description:
          'Lee los documentos y hojas de una carpeta de Drive conectada y guarda lo que dicen en el tercer cerebro (Negocios y clientes): clientes, negocios, precios, cómo habla el usuario, contexto. Úsala cuando el usuario pida pasar, importar o exportar sus carpetas al cerebro. Trabaja por tandas: cada llamada lee unos cuantos archivos y devuelve cuántos faltan (remaining); si faltan, vuelve a llamarla con la misma carpeta hasta que remaining sea 0. No pisa lo que el usuario ya escribió y se puede deshacer desde Conectores → Carpetas de Drive. Los archivos que no han cambiado no se leen otra vez.',
        parameters: {
          type: 'OBJECT',
          properties: {
            folder: { type: 'STRING', description: 'Nombre de la carpeta conectada (p. ej. "Negocio"). Sin él, la primera que tenga archivos por importar.' },
          },
        },
      },
      run: guarded(importToBusiness),
    },
  ],
  webhook: null,
};
