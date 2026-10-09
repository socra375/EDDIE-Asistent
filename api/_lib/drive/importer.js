// Drive → third brain: reads the Docs and Sheets of a connected folder and sorts what
// they say into Negocios (clients, businesses, prices, how the user talks, context, how
// he works). Runs in short batches (a serverless function lives 60 s): each call reads as
// many pending files as fit, and the caller (the hub's button, or Eddie in a chat) calls
// again until nothing is pending. A file that did not change since it was imported is not
// read again; a file that changed has its old notes replaced, not repeated.
//
// What an import never does: overwrite what the user already wrote (summaries, statuses
// and amounts of existing things only get gaps filled), keep a secret, or change Drive.
// And all of it can be undone, folder by folder.
import { getValidAccessToken } from '../googleCredentials.js';
import { isFolderMime, listChildren, DriveError } from './folders.js';
import { readFileText } from './content.js';
import { AnalyzeError, MIN_TEXT_CHARS, analyzeForBusiness } from './analyze.js';
import { clearFolder, folderCounts, importedFiles, markFile, nextPending, upsertListing } from './importStore.js';
import { saveBusiness, undoImportedNotes } from '../business/store.js';
import { clip } from '../connectors/http.js';

const MAX_FILES = 120; // per folder
const MAX_LIST_REQUESTS = 25;
const MAX_DEPTH = 3;
const BATCH_MS = 25000; // no new file is started after this
const ANALYZE_MS = 22000;
const SAME_FAILURES = 3; // reading failed this many files in a row: stop and say why
const SHOWN_ITEMS = 25;

// Where an import's notes are tagged, so they can be replaced or undone file by file.
export const sourceOf = (file) => `Drive · ${clip(file.name, 60)} · ${String(file.file_id ?? file.fileId).slice(0, 8)}`;

const READABLE = new Set(['documento', 'hoja']);
const KIND = { 'application/vnd.google-apps.document': 'documento', 'application/vnd.google-apps.spreadsheet': 'hoja' };

// The Docs and Sheets in a folder and the folders inside it (a few levels down).
// → { files: [{ id, name, kind, path, modified }], ignored, truncated }
export async function listReadable(token, folder, list = listChildren) {
  const files = [];
  const queue = [{ id: folder.folderId, path: folder.name, depth: 0 }];
  let requests = 0;
  let ignored = 0;
  let truncated = false;
  while (queue.length) {
    if (requests >= MAX_LIST_REQUESTS) {
      truncated = true;
      break;
    }
    const { id, path, depth } = queue.shift();
    requests += 1;
    const { files: children, more } = await list(token, id, { pages: 2 });
    if (more) truncated = true;
    for (const f of children) {
      if (isFolderMime(f.mimeType)) {
        if (depth + 1 < MAX_DEPTH) queue.push({ id: f.id, path: `${path} / ${f.name}`, depth: depth + 1 });
        else truncated = true;
        continue;
      }
      const kind = KIND[f.mimeType];
      if (!kind || !READABLE.has(kind)) {
        ignored += 1;
        continue;
      }
      if (files.length >= MAX_FILES) {
        truncated = true;
        continue;
      }
      files.push({ id: f.id, name: clip(f.name, 120) || 'Sin título', kind, path: clip(path, 200), modified: f.modifiedTime || null });
    }
  }
  return { files, ignored, truncated };
}

const mergeTouched = (previous, current) => {
  const byId = new Map();
  for (const t of [...previous, ...current]) byId.set(t.id, { id: t.id, created: Boolean(byId.get(t.id)?.created || t.created) });
  return [...byId.values()];
};

// → { remaining, processed, created, updated, empty, failed, items, stopped, listing }
//   `start`: look at the folder again first (new and changed files become pending).
export async function importFolder(userId, folder, { start = false, deps = {} } = {}) {
  const t0 = Date.now();
  const { readText = readFileText, analyze = analyzeForBusiness, save = saveBusiness, list = listChildren, complete } = deps;
  const out = { processed: 0, created: 0, updated: 0, empty: 0, failed: 0, items: [], stopped: null, listing: null, remaining: 0 };

  const token = await getValidAccessToken(userId);
  if (start) {
    const found = await listReadable(token, folder, list);
    await upsertListing(userId, folder.id, found.files);
    out.listing = { found: found.files.length, ignored: found.ignored, truncated: found.truncated };
  }

  let streak = 0;
  while (!out.stopped && Date.now() - t0 < BATCH_MS) {
    const [file] = await nextPending(userId, folder.id, 1);
    if (!file) break;
    const source = sourceOf(file);
    const previous = Array.isArray(file.touched) ? file.touched : [];

    let text;
    try {
      text = (await readText(token, { id: file.file_id, kind: file.kind })).text;
    } catch (err) {
      streak += 1;
      out.failed += 1;
      out.processed += 1;
      await markFile(userId, file.id, { status: 'failed', error: clip(err.message || 'No se pudo leer el archivo.', 200), touched: previous });
      if (streak >= SAME_FAILURES) out.stopped = clip(err.message || 'No se pudieron leer los archivos.', 240);
      continue;
    }

    let found = [];
    if (text.trim().length >= MIN_TEXT_CHARS) {
      try {
        found = await analyze({ name: file.name, kind: file.kind, path: file.path, text, folderName: folder.name, purpose: folder.purpose }, { timeoutMs: ANALYZE_MS, ...(complete ? { complete } : {}) });
      } catch (err) {
        if (!(err instanceof AnalyzeError)) throw err;
        if (err.code === 'PROVIDER_UNAVAILABLE') {
          out.stopped = err.message; // nothing can be read without an AI: the file stays pending
          break;
        }
        streak += 1;
        out.failed += 1;
        out.processed += 1;
        await markFile(userId, file.id, { status: 'failed', error: clip(err.message, 200), touched: previous });
        if (streak >= SAME_FAILURES) out.stopped = clip(err.message, 240);
        continue;
      }
    }

    streak = 0;
    const saved = [];
    let full = null;
    for (const item of found) {
      const result = await save(userId, { ...item, source, fillOnly: true, replaceSource: source });
      if (result.error) {
        full = result.error;
        break;
      }
      saved.push({ id: result.node.id, created: result.created });
      if (result.created) out.created += 1;
      else out.updated += 1;
      if (out.items.length < SHOWN_ITEMS) out.items.push({ area: item.area, title: result.node.title, created: result.created, file: file.name });
    }
    // Things an earlier read of this file left that it no longer says: take its notes back.
    const savedIds = new Set(saved.map((t) => t.id));
    if (!full) {
      for (const p of previous) if (!savedIds.has(p.id)) await undoImportedNotes(userId, p.id, source, { created: Boolean(p.created) });
    }
    const touched = mergeTouched(full ? previous : previous.filter((p) => savedIds.has(p.id)), saved);

    out.processed += 1;
    if (full) {
      await markFile(userId, file.id, { status: 'failed', error: clip(full, 200), touched });
      out.failed += 1;
      out.stopped = full;
    } else if (!found.length) {
      out.empty += 1;
      await markFile(userId, file.id, { status: 'empty', touched });
    } else {
      await markFile(userId, file.id, { status: 'done', touched });
    }
  }

  const counts = await folderCounts(userId, folder.id);
  out.remaining = counts.pending;
  return out;
}

// Takes back everything the import of a folder put in the brain. → { files, deleted, cleaned }
export async function undoImport(userId, folder) {
  const files = await importedFiles(userId, folder.id);
  let deleted = 0;
  let cleaned = 0;
  for (const file of files) {
    for (const t of file.touched) {
      const result = await undoImportedNotes(userId, t.id, sourceOf({ name: file.name, fileId: file.fileId }), { created: Boolean(t.created) });
      if (result === 'deleted') deleted += 1;
      else if (result === 'cleaned') cleaned += 1;
    }
  }
  await clearFolder(userId, folder.id);
  return { files: files.length, deleted, cleaned };
}

export { DriveError };
