// The text of a Google Doc or Sheet, for Eddie to read. Uses the Docs and Sheets
// permissions (the Docs and Sheets connector); the Drive folder permission only
// ever saw names. A long file is cut: one AI call has to be able to read it.
import { DOCS_API, SHEETS_API, google } from '../connectors/docs/shared.js';
import { documentText } from '../connectors/docs/existing.js';

export const MAX_FILE_CHARS = 12000;
const SHEET_TABS = 3;
const SHEET_ROWS = 150;
const SHEET_COLUMNS = 12;
const CELL_CHARS = 200;

const cell = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, CELL_CHARS);

async function readSheet(token, id) {
  const meta = await google(token, `${SHEETS_API}/${encodeURIComponent(id)}?fields=properties.title,sheets.properties(title)`);
  const tabs = (meta?.sheets || []).map((s) => s.properties?.title).filter(Boolean).slice(0, SHEET_TABS);
  const parts = [`Hoja de cálculo: ${cell(meta?.properties?.title)}`];
  for (const tab of tabs) {
    const range = `'${tab.replace(/'/g, "''")}'!A1:L${SHEET_ROWS}`;
    const data = await google(token, `${SHEETS_API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`);
    const rows = (data?.values || [])
      .map((row) => (Array.isArray(row) ? row.slice(0, SHEET_COLUMNS).map(cell).join(' | ') : ''))
      .filter((line) => line.replace(/[\s|]/g, ''));
    if (rows.length) parts.push(`## Pestaña: ${cell(tab)}`, ...rows);
  }
  return parts.join('\n');
}

// → { text, truncated }. `kind` is what the folder listing says: 'documento' or 'hoja'.
export async function readFileText(token, { id, kind }) {
  const full = kind === 'hoja' ? await readSheet(token, id) : documentText(await google(token, `${DOCS_API}/${encodeURIComponent(id)}`));
  return { text: full.slice(0, MAX_FILE_CHARS), truncated: full.length > MAX_FILE_CHARS };
}
