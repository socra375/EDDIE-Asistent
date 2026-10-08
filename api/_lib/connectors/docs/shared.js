// What the Google Docs / Sheets tools have in common: the user's token, the
// calls to Google (with readable errors), and how model-written text is cleaned.
import { getValidAccessToken, hasDocsAccess } from '../../googleCredentials.js';
import { fetchJson } from '../http.js';

export const DOCS_API = 'https://docs.googleapis.com/v1/documents';
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
export const MAX_ROWS = 100;
export const MAX_COLUMNS = 10;
export const MAX_TITLE_CHARS = 150;
export const MAX_CELL_CHARS = 300;
export const MAX_TEXT_CHARS = 20000;

export class OfficeError extends Error {}

// The user's valid access token, or an OfficeError explaining what's missing.
export async function officeToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new OfficeError('Para usar documentos y hojas, inicia sesión con Google y pulsa "Conectar Google Docs y Sheets" en Conectores.');
  if (!(await hasDocsAccess(user.id))) throw new OfficeError('Google Docs y Sheets no está conectado: pulsa "Conectar Google Docs y Sheets" en el módulo Conectores.');
  try {
    return await getValidAccessToken(user.id);
  } catch (err) {
    throw new OfficeError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a conectar Google Docs y Sheets.');
  }
}

export async function google(token, url, options = {}) {
  const { ok, status, data } = await fetchJson(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new OfficeError('Google rechazó el acceso. Vuelve a pulsar "Conectar Google Docs y Sheets" en Conectores.');
  if (status === 403) throw new OfficeError('Google no lo permitió: revisa que la "Google Docs API" y la "Google Sheets API" estén habilitadas en tu proyecto de Google Cloud, que aceptaste los permisos y que tu cuenta puede abrir ese archivo.');
  if (status === 404) throw new OfficeError('No encuentro ese archivo (revisa el enlace y que tu cuenta tenga acceso).');
  if (status === 429) throw new OfficeError('Google está limitando las solicitudes; inténtalo en un momento.');
  throw new OfficeError(data?.error?.message || 'Google no respondió en este momento.');
}

// Wraps a tool body so an OfficeError becomes a readable { error }.
export function guarded(fn) {
  return async (args, context) => {
    try {
      return await fn(args, context);
    } catch (err) {
      if (err instanceof OfficeError) return { error: err.message };
      throw err;
    }
  };
}

// One line of text: model output is data, so it is cleaned and cut.
export const line = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// A spreadsheet cell: plain numbers stay numbers (so they can be summed), the
// rest is text. Written as RAW, so nothing the model sends is read as a formula.
export function cellOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = line(value, MAX_CELL_CHARS);
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}
