// /api/connectors/drive/* — what the hub's card calls (signed-in user):
//   add     { url, purpose }  connects a folder (checks it is one, and that the account can see it)
//   remove  { id }            disconnects it
//   import  { id, start }     reads the next Docs and Sheets of a folder into the third brain (one batch;
//                             call again until `remaining` is 0; `start` looks at the folder again first)
//   undo    { id }            takes back what the import of that folder put in the brain
// The list of connected folders comes with the connector's card (`details`).
import { requireUser } from '../session.js';
import { getValidAccessToken, hasDocsAccess, hasDriveAccess } from '../googleCredentials.js';
import { clip } from '../connectors/http.js';
import { DriveError, getFile, isFolderMime, parseFolderRef } from './folders.js';
import { PURPOSES, listFolders, removeFolder, saveFolder } from './store.js';
import { importFolder, undoImport } from './importer.js';
import { folderCounts } from './importStore.js';

export async function handleDriveRoute({ method, path = [], cookies = {}, body }) {
  const action = path[1];
  if (method !== 'POST') return { status: 405, json: { error: 'Método no permitido.' } };
  const user = await requireUser(cookies);

  if (action === 'add') {
    if (!(await hasDriveAccess(user.id))) return { status: 409, json: { error: 'Primero pulsa "Conectar Carpetas de Drive" y acepta el permiso.' } };
    const folderId = parseFolderRef(body?.url);
    if (!folderId) return { status: 400, json: { error: 'Pega el enlace de la carpeta (el que ves al abrirla en drive.google.com, con /folders/ en la dirección).' } };
    const purpose = PURPOSES.includes(body?.purpose) ? body.purpose : 'otro';
    let file;
    try {
      file = await getFile(await getValidAccessToken(user.id), folderId);
    } catch (err) {
      if (err instanceof DriveError) return { status: 400, json: { error: err.message } };
      return { status: 502, json: { error: err.message || 'No se pudo hablar con Google Drive.' } };
    }
    if (!isFolderMime(file?.mimeType)) return { status: 400, json: { error: 'Ese enlace es de un archivo, no de una carpeta. Abre la carpeta en Drive y copia su enlace.' } };
    if (file.trashed) return { status: 400, json: { error: 'Esa carpeta está en la papelera.' } };
    const folder = await saveFolder(user.id, { folderId, name: clip(file.name, 80) || 'Carpeta', purpose });
    if (!folder) return { status: 409, json: { error: 'Ya hay 10 carpetas conectadas: quita alguna antes de añadir otra.' } };
    return { status: 200, json: { ok: true, folder } };
  }

  if (action === 'remove') {
    const id = String(body?.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: 400, json: { error: 'Falta la carpeta a quitar.' } };
    return (await removeFolder(user.id, id)) ? { status: 200, json: { ok: true } } : { status: 404, json: { error: 'Esa carpeta ya no está conectada.' } };
  }

  if (action === 'import' || action === 'undo') {
    const id = String(body?.id || '');
    const folder = /^[0-9a-f-]{36}$/i.test(id) ? (await listFolders(user.id)).find((f) => f.id === id) : null;
    if (!folder) return { status: 404, json: { error: 'Esa carpeta ya no está conectada.' } };
    if (action === 'undo') {
      const result = await undoImport(user.id, folder);
      return { status: 200, json: { ok: true, ...result, import: await folderCounts(user.id, folder.id) } };
    }
    if (!(await hasDriveAccess(user.id))) return { status: 409, json: { error: 'Primero pulsa "Conectar Carpetas de Drive" y acepta el permiso.' } };
    if (!(await hasDocsAccess(user.id))) return { status: 409, json: { error: 'Para leer los documentos y hojas, conecta también «Google Docs y Sheets» en Conectores.' } };
    try {
      const result = await importFolder(user.id, folder, { start: body?.start === true });
      return { status: 200, json: { ok: true, ...result, import: await folderCounts(user.id, folder.id) } };
    } catch (err) {
      if (err instanceof DriveError) return { status: 400, json: { error: err.message } };
      return { status: 502, json: { error: err.message || 'No se pudo importar la carpeta.' } };
    }
  }

  return { status: 404, json: { error: 'Esa acción de Drive no existe.' } };
}
