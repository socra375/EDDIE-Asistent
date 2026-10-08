// Google Docs and Google Sheets: Eddie writes a document or a spreadsheet in
// the user's Drive and gives the link. A spreadsheet is a table (bold, frozen
// header row); a document is text with, optionally, one table at the end. The
// permissions ("documents" and "spreadsheets") are granted from the hub
// ("Conectar Google Docs y Sheets"); they create and edit those files and
// nothing else. Creating a file is easy to undo (the user can trash it), so
// it runs at once, without a confirmation card.
import { getValidAccessToken, hasDocsAccess } from '../../googleCredentials.js';
import { fetchJson } from '../http.js';

const DOCS_API = 'https://docs.googleapis.com/v1/documents';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const MAX_ROWS = 100;
const MAX_COLUMNS = 10;
const MAX_TITLE_CHARS = 150;
const MAX_CELL_CHARS = 300;
const MAX_TEXT_CHARS = 20000;

class OfficeError extends Error {}

// The user's valid access token, or an OfficeError explaining what's missing.
async function officeToken(context) {
  const user = await context.getUser?.();
  if (!user) throw new OfficeError('Para crear documentos y hojas, inicia sesión con Google y pulsa "Conectar Google Docs y Sheets" en Conectores.');
  if (!(await hasDocsAccess(user.id))) throw new OfficeError('Google Docs y Sheets no está conectado: pulsa "Conectar Google Docs y Sheets" en el módulo Conectores.');
  try {
    return await getValidAccessToken(user.id);
  } catch (err) {
    throw new OfficeError(err.message || 'No se pudo acceder a tu cuenta de Google. Vuelve a conectar Google Docs y Sheets.');
  }
}

async function google(token, url, options = {}) {
  const { ok, status, data } = await fetchJson(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    timeoutMs: 8000,
  });
  if (ok) return data;
  if (status === 401) throw new OfficeError('Google rechazó el acceso. Vuelve a pulsar "Conectar Google Docs y Sheets" en Conectores.');
  if (status === 403) throw new OfficeError('Google no lo permitió: revisa que la "Google Docs API" y la "Google Sheets API" estén habilitadas en tu proyecto de Google Cloud y que aceptaste los permisos.');
  if (status === 404) throw new OfficeError('No encuentro ese archivo.');
  if (status === 429) throw new OfficeError('Google está limitando las solicitudes; inténtalo en un momento.');
  throw new OfficeError(data?.error?.message || 'Google no respondió en este momento.');
}

// Wraps a tool body so an OfficeError becomes a readable { error }.
function guarded(fn) {
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
const line = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// A spreadsheet cell: plain numbers stay numbers (so they can be summed), the
// rest is text. Written as RAW, so nothing the model sends is read as a formula.
function cellOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = line(value, MAX_CELL_CHARS);
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
}

// { headers, rows } from what the model sent → every row as wide as the headers.
// Returns null when there is no table at all; throws when it is unusable.
export function cleanTable(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new OfficeError('La tabla debe tener encabezados (headers) y filas (rows).');
  const headers = (Array.isArray(raw.headers) ? raw.headers : []).slice(0, MAX_COLUMNS).map((h) => line(h, MAX_CELL_CHARS));
  if (!headers.length || headers.every((h) => !h)) throw new OfficeError('La tabla necesita encabezados: el nombre de cada columna.');
  const rows = (Array.isArray(raw.rows) ? raw.rows : [])
    .filter(Array.isArray)
    .slice(0, MAX_ROWS)
    .map((row) => headers.map((_, i) => cellOf(row[i])));
  return { headers, rows };
}

// ---- Google Sheets ----

const columnLetter = (count) => {
  let n = count;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
};

async function createSpreadsheet(args, context) {
  const title = line(args.title, MAX_TITLE_CHARS);
  if (!title) return { error: 'La hoja necesita un título.' };
  const table = cleanTable({ headers: args.headers, rows: args.rows });
  const token = await officeToken(context);

  const created = await google(token, SHEETS_API, { method: 'POST', body: JSON.stringify({ properties: { title } }) });
  const id = created?.spreadsheetId;
  if (!id) throw new OfficeError('Google Sheets no devolvió la hoja.');
  const url = created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const sheetId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  const grid = [table.headers, ...table.rows];

  try {
    await google(token, `${SHEETS_API}/${encodeURIComponent(id)}/values/A1?valueInputOption=RAW`, {
      method: 'PUT',
      body: JSON.stringify({ range: 'A1', majorDimension: 'ROWS', values: grid }),
    });
    // The header row in bold and frozen, so it stays in view when scrolling.
    await google(token, `${SHEETS_API}/${encodeURIComponent(id)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
          { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
        ],
      }),
    });
  } catch (err) {
    // The file exists already: say where it is, so the user isn't left guessing.
    return { error: `Creé «${title}» en tu Drive, pero no pude escribir la tabla (${err.message}). Quedó vacía: ${url}` };
  }

  // "Comprueba": reads the table back and checks its size and its first header.
  let verified = null;
  try {
    const back = await google(token, `${SHEETS_API}/${encodeURIComponent(id)}/values/A1:${columnLetter(table.headers.length)}${grid.length}`);
    verified = (back?.values?.length ?? 0) === grid.length && String(back.values[0]?.[0] ?? '') === String(table.headers[0]);
  } catch {
    // The writes went through; only the check failed.
  }

  const size = `${table.rows.length} fila${table.rows.length === 1 ? '' : 's'} y ${table.headers.length} columna${table.headers.length === 1 ? '' : 's'}`;
  const base = `Creé la hoja «${title}» con ${size} en tu Drive.`;
  const summary = `${base}${verified === true ? ' Comprobado: la tabla está completa.' : verified === false ? ' No pude comprobar la tabla: revísala.' : ''} Enlace: ${url}`;
  return { created: true, kind: 'spreadsheet', id, url, title, rows: table.rows.length, columns: table.headers.length, verified, summary };
}

// ---- Google Docs ----

const cellText = (cell) =>
  (cell?.content || [])
    .flatMap((block) => block.paragraph?.elements || [])
    .map((el) => el.textRun?.content || '')
    .join('')
    .replace(/\n$/, '');

const lastTable = (doc) => [...(doc?.body?.content || [])].reverse().find((el) => el.table)?.table || null;

// The requests that fill the cells of a table already in the document. Cells
// are filled from the last to the first, so writing one never moves the
// position of the ones still to be written; the header row goes in bold.
export function fillRequests(table, grid) {
  const requests = [];
  const cells = [];
  (table.tableRows || []).forEach((row, r) => (row.tableCells || []).forEach((cell, c) => cells.push({ r, c, start: cell.content?.[0]?.startIndex })));
  for (const { r, c, start } of cells.reverse()) {
    const text = String(grid[r]?.[c] ?? '');
    if (!text || !Number.isInteger(start)) continue;
    requests.push({ insertText: { location: { index: start }, text } });
    if (r === 0) requests.push({ updateTextStyle: { range: { startIndex: start, endIndex: start + text.length }, textStyle: { bold: true }, fields: 'bold' } });
  }
  return requests;
}

async function createDocument(args, context) {
  const title = line(args.title, MAX_TITLE_CHARS);
  if (!title) return { error: 'El documento necesita un título.' };
  const text = String(args.text ?? '').replace(/\r/g, '').trim().slice(0, MAX_TEXT_CHARS);
  const table = cleanTable(args.table);
  if (!text && !table) return { error: 'Dime qué va en el documento: un texto, una tabla o las dos cosas.' };
  const token = await officeToken(context);

  const created = await google(token, DOCS_API, { method: 'POST', body: JSON.stringify({ title }) });
  const id = created?.documentId;
  if (!id) throw new OfficeError('Google Docs no devolvió el documento.');
  const url = `https://docs.google.com/document/d/${id}/edit`;
  const grid = table ? [table.headers, ...table.rows].map((row) => row.map((cell) => String(cell))) : [];
  const docUrl = `${DOCS_API}/${encodeURIComponent(id)}`;

  try {
    // The text goes in first; the table lands right after it, at the start of
    // the paragraph that follows (the empty document has one, at index 1).
    const body = text ? `${text}\n` : '';
    const first = [];
    if (body) first.push({ insertText: { location: { index: 1 }, text: body } });
    if (table) first.push({ insertTable: { rows: grid.length, columns: table.headers.length, location: { index: 1 + body.length } } });
    await google(token, `${docUrl}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: first }) });

    if (table) {
      // The cells' positions are known only once the table exists: read them.
      const placed = lastTable(await google(token, docUrl));
      if (!placed) throw new OfficeError('Google no creó la tabla.');
      const fill = fillRequests(placed, grid);
      if (fill.length) await google(token, `${docUrl}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: fill }) });
    }
  } catch (err) {
    return { error: `Creé «${title}» en tu Drive, pero no pude escribir todo su contenido (${err.message}). Revísalo: ${url}` };
  }

  // "Comprueba": the table must be there with its size and its first header.
  let verified = null;
  if (table) {
    try {
      const back = lastTable(await google(token, docUrl));
      verified = Boolean(back) && back.rows === grid.length && back.columns === table.headers.length && cellText(back.tableRows?.[0]?.tableCells?.[0]) === grid[0][0];
    } catch {
      // The writes went through; only the check failed.
    }
  }

  const base = `Creé el documento «${title}»${table ? ` con una tabla de ${table.rows.length} fila${table.rows.length === 1 ? '' : 's'} y ${table.headers.length} columna${table.headers.length === 1 ? '' : 's'}` : ''} en tu Drive.`;
  const summary = `${base}${verified === true ? ' Comprobado: la tabla está completa.' : verified === false ? ' No pude comprobar la tabla: revísala.' : ''} Enlace: ${url}`;
  return { created: true, kind: 'document', id, url, title, table: Boolean(table), verified, summary };
}

const TABLE_ROWS = { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } };

export default {
  id: 'docs',
  name: 'Google Docs y Sheets',
  description: 'Eddie crea documentos de Google Docs y hojas de Google Sheets con tablas en tu Drive, y te da el enlace para editarlos.',
  icon: 'doc',
  category: 'productividad',
  // Offered to the model only when the conversation touches the topic.
  route: /google docs|google sheets|hoja de c[aá]lculo|spreadsheet|\bdocs?\b|\bsheets?\b|\bword\b|excel|tabla|documento/i,
  auth: {
    type: 'google-login',
    scope: 'docs',
    isConnected: (user) => hasDocsAccess(user.id),
  },
  requiredEnv: ['DATABASE_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'CONNECTOR_SECRET'],
  note: 'Eddie crea archivos nuevos en tu Drive; no abre, edita ni borra los que ya tienes.',
  tools: [
    {
      label: 'Crear hoja de cálculo',
      activity: 'Creando la hoja…',
      summarize: (result) => `Hoja con ${result.rows} fila${result.rows === 1 ? '' : 's'}`,
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'create_spreadsheet',
        description: `Crea una hoja de cálculo nueva en el Google Sheets del usuario (en su Drive) con una tabla y devuelve el enlace. Úsala cuando pida una tabla, una hoja, un Excel o un listado con columnas. Tú escribes la tabla: los encabezados (hasta ${MAX_COLUMNS}) y las filas (hasta ${MAX_ROWS}), cada fila con un valor por columna. Los números van sin símbolos (15000, no "$15,000"). Después dile el enlace.`,
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Nombre del archivo.' },
            headers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'El nombre de cada columna.' },
            rows: { ...TABLE_ROWS, description: 'Las filas: cada una es una lista de valores, uno por columna y en el mismo orden.' },
          },
          required: ['title', 'headers'],
        },
      },
      run: guarded(createSpreadsheet),
    },
    {
      label: 'Crear documento',
      activity: 'Creando el documento…',
      summarize: (result) => (result.table ? 'Documento con tabla' : 'Documento creado'),
      risk: 'write',
      sensitive: false,
      declaration: {
        name: 'create_document',
        description:
          'Crea un documento nuevo en el Google Docs del usuario (en su Drive) y devuelve el enlace. Úsala para informes, propuestas, cartas, actas, planes o cualquier texto que quiera tener como documento (también si pide un "Word"). Escribe el texto completo, con los párrafos separados por saltos de línea, y, si hace falta, una tabla al final (encabezados y filas). Después dile el enlace.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Nombre del archivo.' },
            text: { type: 'STRING', description: 'El texto del documento, en texto plano; un párrafo por línea.' },
            table: {
              type: 'OBJECT',
              description: 'Una tabla opcional, que va después del texto.',
              properties: {
                headers: { type: 'ARRAY', items: { type: 'STRING' }, description: 'El nombre de cada columna.' },
                rows: { ...TABLE_ROWS, description: 'Las filas: cada una es una lista de valores, uno por columna.' },
              },
              required: ['headers'],
            },
          },
          required: ['title'],
        },
      },
      run: guarded(createDocument),
    },
  ],
  webhook: null,
};
