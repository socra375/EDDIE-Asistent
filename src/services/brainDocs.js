// Documents for the two brains (a .md dropped on the Memoria orb or on the
// second brain). The file is read here, in the browser; the analysis and the
// sorting happen on the server (api/_lib/brain/), nothing here sees an API key.
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

export const MAX_FILE_BYTES = 150 * 1024;
const NAME_RE = /\.(md|markdown|txt)$/i;

// null when the file can go in, otherwise what to tell the user.
export function fileProblem(file) {
  if (!file) return 'No recibí ningún archivo.';
  if (!NAME_RE.test(file.name || '')) return 'Por ahora solo entiendo documentos Markdown (.md).';
  if (!file.size) return 'El archivo está vacío.';
  if (file.size > MAX_FILE_BYTES) return `El archivo pesa demasiado (máximo ${Math.round(MAX_FILE_BYTES / 1024)} KB).`;
  return null;
}

// The first file of a drop or of a file picker.
export const firstFile = (list) => (list && list.length ? list[0] : null);

// Reads, sends and returns the server's answer (throws an Error with the reason).
// target: 'memory' (first brain) | 'knowledge' (second brain)
export async function ingestDocument(file, target) {
  const problem = fileProblem(file);
  if (problem) throw new Error(problem);
  const text = await file.text();
  let res;
  try {
    res = await fetch(`${API_BASE}/api/connectors/brain/document`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, text, target, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    });
  } catch {
    throw new Error('No se pudo contactar al servidor de Eddie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `No se pudo completar (${res.status}).`);
  return data || {};
}
