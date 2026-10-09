// Database side of the third brain (see db/migrations/0018_business.sql). Notes
// are kept as a jsonb list, newest last, capped at MAX_NOTES.
import { getDb } from '../db.js';
import { MAX_NODES, MAX_NOTES, cleanNote, cleanRelated, cleanStatus, cleanSummary, cleanTitle, cleanValue, cleanAmount, sameName } from '../../../src/services/business.js';

const shape = (row) => ({
  id: String(row.id),
  area: row.area,
  title: row.title,
  summary: row.summary || '',
  status: row.status || null,
  value: row.value || null,
  amount: row.amount == null ? null : Number(row.amount),
  related: row.related || '',
  notes: Array.isArray(row.notes) ? row.notes : [],
  updatedAt: new Date(row.updated_at).toISOString(),
});

export async function countBusiness(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from business_nodes where user_id = ${userId}`;
  return Number(rows[0]?.n || 0);
}

export async function listBusiness(userId, { limit = MAX_NODES } = {}) {
  const sql = getDb();
  const rows = await sql`
    select id, area, title, summary, status, value, amount, related, notes, updated_at
    from business_nodes where user_id = ${userId} order by updated_at desc limit ${limit}
  `;
  return rows.map(shape);
}

export async function getBusiness(userId, id) {
  const sql = getDb();
  const rows = await sql`select id, area, title, summary, status, value, amount, related, notes, updated_at from business_nodes where id = ${id} and user_id = ${userId}`;
  return rows[0] ? shape(rows[0]) : null;
}

// Adds what is known about a thing (creates it, or updates the fields that came) and its notes.
// → { node, created } or { error } when the brain is full.
//
// What an import from Drive may do differently (see api/_lib/drive/importer.js):
//   notes          several notes at once (besides `note`)
//   fillOnly       a thing that exists keeps what it already says: the summary, status, value,
//                  amount and "related" only fill the gaps, so nothing the user wrote is overwritten
//   replaceSource  the notes a previous import of the same file left are replaced, not repeated
export async function saveBusiness(userId, { area, title, summary, status, value, amount, related, note, notes: moreNotes = [], source = 'chat', fillOnly = false, replaceSource = null }) {
  const sql = getDb();
  const name = cleanTitle(title);
  // The name is compared in the app (case and accents do not matter: "Ana Pérez" is "ana perez").
  const sameArea = await sql`select id, title, notes from business_nodes where user_id = ${userId} and area = ${area}`;
  const existing = sameArea.filter((r) => sameName(r.title, name));
  if (!existing[0] && (await countBusiness(userId)) >= MAX_NODES) return { error: `Ya tienes ${MAX_NODES} cosas guardadas en tu tercer cerebro: borra alguna antes de añadir otra.` };
  const at = new Date().toISOString();
  const texts = [...new Set([...(Array.isArray(moreNotes) ? moreNotes : []), note].map(cleanNote).filter(Boolean))];
  const added = texts.map((text) => ({ text, at, source }));
  let id;
  let created = false;
  if (existing[0]) {
    id = existing[0].id;
    const before = (Array.isArray(existing[0].notes) ? existing[0].notes : []).filter((n) => !(replaceSource && n?.source === replaceSource));
    const kept = [...before, ...added].slice(-MAX_NOTES);
    if (fillOnly) {
      // What is already there wins; the import only fills what is empty.
      await sql`
        update business_nodes set
          summary = case when summary = '' then ${cleanSummary(summary)} else summary end,
          status = coalesce(status, ${cleanStatus(area, status)}),
          value = coalesce(value, ${cleanValue(value)}),
          amount = coalesce(amount, ${cleanAmount(amount)}),
          related = case when related = '' then ${cleanRelated(related)} else related end,
          notes = ${JSON.stringify(kept)}::jsonb,
          updated_at = now()
        where id = ${id} and user_id = ${userId}
      `;
    } else {
      await sql`
        update business_nodes set
          summary = case when ${cleanSummary(summary)} = '' then summary else ${cleanSummary(summary)} end,
          status = coalesce(${cleanStatus(area, status)}, status),
          value = coalesce(${cleanValue(value)}, value),
          amount = coalesce(${cleanAmount(amount)}, amount),
          related = case when ${cleanRelated(related)} = '' then related else ${cleanRelated(related)} end,
          notes = ${JSON.stringify(kept)}::jsonb,
          updated_at = now()
        where id = ${id} and user_id = ${userId}
      `;
    }
  } else {
    created = true;
    const rows = await sql`
      insert into business_nodes (user_id, area, title, summary, status, value, amount, related, notes)
      values (${userId}, ${area}, ${name}, ${cleanSummary(summary)}, ${cleanStatus(area, status)}, ${cleanValue(value)}, ${cleanAmount(amount)}, ${cleanRelated(related)}, ${JSON.stringify(added)}::jsonb)
      returning id
    `;
    id = rows[0].id;
  }
  return { node: await getBusiness(userId, id), created };
}

export async function deleteBusiness(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from business_nodes where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

// The notes of a thing can be cleaned up by hand (one line at a time).
export async function removeNote(userId, id, index) {
  const sql = getDb();
  const rows = await sql`select notes from business_nodes where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) return false;
  const notes = Array.isArray(rows[0].notes) ? rows[0].notes : [];
  if (!(index >= 0 && index < notes.length)) return false;
  notes.splice(index, 1);
  await sql`update business_nodes set notes = ${JSON.stringify(notes)}::jsonb, updated_at = now() where id = ${id} and user_id = ${userId}`;
  return true;
}

// Undoing an import: takes out the notes one source left on a thing. A thing the import
// created is deleted when no note is left (the user never wrote on it); otherwise it stays.
// → 'deleted' | 'cleaned' | 'missing'
export async function undoImportedNotes(userId, id, source, { created = false } = {}) {
  const sql = getDb();
  const rows = await sql`select notes from business_nodes where id = ${id} and user_id = ${userId}`;
  if (!rows[0]) return 'missing';
  const left = (Array.isArray(rows[0].notes) ? rows[0].notes : []).filter((n) => n?.source !== source);
  if (created && left.length === 0) {
    await sql`delete from business_nodes where id = ${id} and user_id = ${userId}`;
    return 'deleted';
  }
  await sql`update business_nodes set notes = ${JSON.stringify(left)}::jsonb, updated_at = now() where id = ${id} and user_id = ${userId}`;
  return 'cleaned';
}
