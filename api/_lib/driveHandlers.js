import { getValidAccessToken } from './googleCredentials.js';
import { requireUser } from './session.js';

// Uploads a document Eddie generated straight to the user's Drive, using
// the `drive.file` scope (only files this app creates, not the whole Drive).
export async function saveToDrive(cookies, body) {
  const user = await requireUser(cookies);
  if (!body?.filename || typeof body?.content !== 'string') {
    const err = new Error('Se requiere un nombre de archivo y contenido.');
    err.code = 'BAD_REQUEST';
    throw err;
  }

  const accessToken = await getValidAccessToken(user.id);
  const mimeType = body.mimeType || 'text/plain';
  const boundary = `eddie-${Date.now()}`;
  const metadata = JSON.stringify({ name: body.filename, mimeType });
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    body.content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message || 'No se pudo guardar el archivo en Google Drive.');
    err.code = 'PROVIDER_ERROR';
    throw err;
  }
  return { status: 200, json: { fileId: data.id, webViewLink: data.webViewLink } };
}
