// The 3D brain (see api/_lib/construction3d/): the calls the Construction 3D
// screen makes to /api/connectors/construction3d. A model never goes through
// Eddie's server: it is uploaded to, and read from, the private bucket with
// short-lived URLs the server mints.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function call(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/construction3d${path}`, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data || {};
}

export const listProjects = () => call('');
export const updateProject = (id, fields) => call('/update', { method: 'POST', body: { id, ...fields } });
export const deleteProject = (id) => call('/delete', { method: 'POST', body: { id } });
export const projectUrl = (id) => call(`/url?id=${encodeURIComponent(id)}`);

// The file goes straight to the bucket; XMLHttpRequest because fetch cannot report upload progress.
function putFile(url, file, headers, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [name, value] of Object.entries(headers || {})) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`El almacenamiento rechazó el archivo (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error('No pude subir el archivo. Revisa tu conexión; si es la primera vez, puede ser la configuración del almacenamiento.'));
    xhr.send(file);
  });
}

// → { item, limits }. Asks for a slot, uploads, then has the server check what arrived.
export async function uploadProject(file, { onProgress } = {}) {
  const slot = await call('/upload', { method: 'POST', body: { name: file.name, bytes: file.size } });
  try {
    await putFile(slot.uploadUrl, file, slot.headers, onProgress);
  } catch (err) {
    await deleteProject(slot.id).catch(() => {});
    throw err;
  }
  return call('/complete', { method: 'POST', body: { id: slot.id } });
}

export const fmtBytes = (bytes) => {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  return `${(bytes / 1048576).toFixed(bytes >= 10485760 ? 0 : 1)} MB`;
};
