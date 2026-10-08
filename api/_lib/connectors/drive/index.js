// The Drive folders the user connected ("Negocio", "Servicio al cliente"…).
// Eddie can see what is in them and search them by name — only inside those
// folders, never the rest of the Drive — and then reads the Docs and Sheets it
// finds with read_document / read_spreadsheet (the Google Docs and Sheets
// connector). Names and structure only (drive.metadata.readonly); nothing is
// copied into Eddie's database but the folder's id, name and purpose.
// The folders are connected from the hub (api/_lib/drive/handlers.js).
import { getValidAccessToken, hasDriveAccess } from '../../googleCredentials.js';
import { DriveError, describeFile, getFile, insideConnected, listChildren, parseFolderRef, searchFolders } from '../../drive/folders.js';
import { listFolders } from '../../drive/store.js';
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

export default {
  id: 'drive',
  name: 'Carpetas de Drive',
  description:
    'Conecta carpetas de tu Drive (por ejemplo «Negocio» y «Servicio al cliente») y Eddie las consulta cuando le preguntas por un cliente, un negocio o un plan: busca por nombre, mira qué hay dentro y lee los documentos y hojas que encuentra.',
  icon: 'cloud',
  category: 'productividad',
  // Offered to the model only when the conversation touches the topic.
  route: /carpeta|drive|archivo|documento|cliente|negocio|propuesta|contrato|cotiza|presupuesto|precio|\bplan(es)?\b|servicio al|qu[eé] (tengo|hay|dice)/i,
  auth: {
    type: 'google-login',
    scope: 'drive',
    isConnected: (user) => hasDriveAccess(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Eddie solo mira las carpetas que conectes (y lo que hay dentro), en solo lectura: no cambia, mueve ni borra nada de tu Drive. Ve nombres y estructura; el texto de los documentos y hojas lo lee con el permiso de Google Docs y Sheets, así que conéctalo también.',
  details: async (user) => (user ? { folders: await listFolders(user.id) } : null),
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
  ],
  webhook: null,
};
