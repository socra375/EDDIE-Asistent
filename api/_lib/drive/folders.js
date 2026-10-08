// Reading the structure of the Drive folders the user connected: what is in a
// folder, a search by name inside them, and whether a file or folder belongs to
// one of them. Only names and structure (drive.metadata.readonly); the text of a
// Doc or a Sheet is read by the Docs connector with its own permissions.
import { fetchJson } from '../connectors/http.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const PAGE_SIZE = 100;
const MAX_REQUESTS = 30; // a search never makes more calls than this
const MAX_DEPTH = 3;
const MAX_RESULTS = 20;
const MAX_ANCESTORS = 8;
const ID_RE = /^[A-Za-z0-9_-]{10,120}$/;

export class DriveError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// The folder id in a Drive link (drive.google.com/drive/folders/…, ?id=…) or a bare id; null otherwise.
export function parseFolderRef(value) {
  const text = String(value ?? '').trim();
  if (ID_RE.test(text)) return text;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
  const inPath = /\/folders\/([A-Za-z0-9_-]{10,120})/.exec(u.pathname);
  if (inPath) return inPath[1];
  const id = u.searchParams.get('id');
  return id && ID_RE.test(id) ? id : null;
}

const KINDS = {
  [FOLDER]: 'carpeta',
  'application/vnd.google-apps.document': 'documento',
  'application/vnd.google-apps.spreadsheet': 'hoja',
  'application/vnd.google-apps.presentation': 'presentación',
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'text/plain': 'texto',
};

// Eddie reads Google Docs and Sheets (read_document / read_spreadsheet); the rest it only lists.
const READABLE = new Set(['documento', 'hoja']);

export function describeFile(f) {
  const kind = KINDS[f.mimeType] || 'archivo';
  return {
    id: f.id,
    name: f.name,
    kind,
    readable: READABLE.has(kind),
    url: f.webViewLink || (kind === 'carpeta' ? `https://drive.google.com/drive/folders/${f.id}` : ''),
    modified: f.modifiedTime || null,
  };
}

async function drive(token, path) {
  const { ok, status, data } = await fetchJson(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 8000 });
  if (ok) return data;
  if (status === 401) throw new DriveError('Google rechazó el acceso a Drive. Vuelve a pulsar "Conectar Carpetas de Drive" en Conectores.', status);
  if (status === 403) throw new DriveError('Google no permitió leer esa carpeta: revisa que la "Google Drive API" esté habilitada en tu proyecto de Google Cloud y que aceptaste el permiso de Carpetas de Drive.', status);
  if (status === 404) throw new DriveError('No encuentro esa carpeta, o tu cuenta no tiene acceso a ella.', status);
  if (status === 429) throw new DriveError('Google está limitando las solicitudes; inténtalo en un momento.', status);
  throw new DriveError(data?.error?.message || 'Google Drive no respondió en este momento.', status);
}

const shared = 'supportsAllDrives=true';

// { id, name, mimeType, parents } of one file or folder.
export function getFile(token, id) {
  return drive(token, `/${encodeURIComponent(id)}?fields=id,name,mimeType,parents,trashed&${shared}`);
}

// The files and folders directly inside `folderId` (folders first, then by name), up to `pages` pages.
export async function listChildren(token, folderId, { pages = 1 } = {}) {
  const files = [];
  let pageToken = '';
  for (let page = 0; page < pages; page += 1) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
      orderBy: 'folder,name',
      pageSize: String(PAGE_SIZE),
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await drive(token, `?${params}`);
    files.push(...(data?.files || []).filter((f) => f.mimeType !== SHORTCUT));
    pageToken = data?.nextPageToken || '';
    if (!pageToken) break;
  }
  return { files, more: Boolean(pageToken) };
}

// true when `id` is one of the connected folders or sits (at any depth) inside one.
export async function insideConnected(token, id, rootIds) {
  const roots = new Set(rootIds);
  let current = id;
  for (let hop = 0; hop <= MAX_ANCESTORS; hop += 1) {
    if (roots.has(current)) return true;
    let file;
    try {
      file = await getFile(token, current);
    } catch (err) {
      // An ancestor the account cannot see is not one of the connected folders.
      if (err instanceof DriveError && err.status === 404) return false;
      throw err;
    }
    const parent = file?.parents?.[0];
    if (!parent) return false;
    current = parent;
  }
  return false;
}

const plain = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// A name matches when it contains every word of the search (accents and case ignored).
export function nameMatches(name, query) {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const target = plain(name);
  return words.length > 0 && words.every((w) => target.includes(w));
}

// Looks by name through the folders (and the folders inside them, a few levels
// down). → { found: [{…file, where}], searched, complete }
export async function searchFolders(token, roots, query) {
  const found = [];
  const queue = roots.map((r) => ({ id: r.folderId, path: r.name, depth: 0 }));
  let requests = 0;
  let searched = 0;
  let complete = true;
  while (queue.length && found.length < MAX_RESULTS) {
    if (requests >= MAX_REQUESTS) {
      complete = false;
      break;
    }
    const { id, path, depth } = queue.shift();
    requests += 1;
    const { files, more } = await listChildren(token, id);
    searched += 1;
    if (more) complete = false;
    for (const f of files) {
      if (nameMatches(f.name, query)) found.push({ ...describeFile(f), where: path });
      if (f.mimeType === FOLDER) {
        if (depth + 1 < MAX_DEPTH) queue.push({ id: f.id, path: `${path} / ${f.name}`, depth: depth + 1 });
        else complete = false;
      }
    }
  }
  if (queue.length) complete = false;
  found.sort((a, b) => String(b.modified || '').localeCompare(String(a.modified || '')));
  return { found: found.slice(0, MAX_RESULTS), searched, complete };
}

export const isFolderMime = (mimeType) => mimeType === FOLDER;
