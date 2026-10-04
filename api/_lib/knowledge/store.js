// Database side of the second brain (see db/migrations/0013_knowledge.sql).
import { getDb } from '../db.js';
import { toVector } from '../episodes/embed.js';
import { cleanCategory } from '../../../src/services/knowledgeCategories.js';

// Past these, Eddie must forget something first: this is a notebook, not an archive.
export const MAX_TOPICS = 60;
// Researching costs searches and AI calls: a runaway client can't burn the quota.
export const MAX_LEARNS_PER_HOUR = 6;

const topicShape = (row) => ({
  id: String(row.id),
  title: row.title,
  summary: row.summary,
  kind: row.kind === 'habilidad' ? 'habilidad' : 'tema',
  category: cleanCategory(row.category),
  sourceCount: Number(row.source_count || 0),
  noteCount: Number(row.note_count ?? 0),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const noteShape = (row) => ({
  id: String(row.id),
  topicId: String(row.topic_id),
  ...(row.title ? { topic: row.title } : {}),
  content: row.content,
  sourceUrl: row.source_url || null,
  sourceTitle: row.source_title || null,
  ...(row.similarity != null ? { similarity: Number(row.similarity) } : {}),
});

export async function recentLearnCount(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from knowledge_topics where user_id = ${userId} and updated_at > now() - interval '1 hour'`;
  return Number(rows[0]?.n || 0);
}

export async function countTopics(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from knowledge_topics where user_id = ${userId}`;
  return Number(rows[0]?.n || 0);
}

export async function countNotes(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from knowledge_notes where user_id = ${userId}`;
  return Number(rows[0]?.n || 0);
}

export async function findTopic(userId, title) {
  const sql = getDb();
  const rows = await sql`
    select id, title, summary, kind, category, source_count, created_at, updated_at, 0 as note_count
    from knowledge_topics where user_id = ${userId} and lower(title) = lower(${title}) limit 1
  `;
  return rows[0] ? topicShape(rows[0]) : null;
}

// Creates the topic, or refreshes it (new summary, same id) when the user asks again.
export async function upsertTopic(userId, { title, summary, kind, category, sourceCount }) {
  const sql = getDb();
  const rows = await sql`
    insert into knowledge_topics (user_id, title, summary, kind, category, source_count)
    values (${userId}, ${title}, ${summary}, ${kind}, ${cleanCategory(category)}, ${sourceCount})
    on conflict (user_id, lower(title)) do update
      set summary = excluded.summary, kind = excluded.kind, source_count = excluded.source_count, updated_at = now()
    returning id, title, summary, kind, category, source_count, created_at, updated_at, 0 as note_count
  `;
  return topicShape(rows[0]);
}

// Re-learning keeps the category (the user may have changed it); this changes it on purpose.
export async function setCategory(userId, id, category) {
  const sql = getDb();
  const rows = await sql`update knowledge_topics set category = ${cleanCategory(category)} where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

// Learning again replaces what was known about the topic.
export async function replaceNotes(userId, topicId, notes) {
  const sql = getDb();
  await sql`delete from knowledge_notes where topic_id = ${topicId} and user_id = ${userId}`;
  for (const n of notes) {
    await sql`
      insert into knowledge_notes (topic_id, user_id, content, source_url, source_title, embedding)
      values (${topicId}, ${userId}, ${n.content}, ${n.sourceUrl || null}, ${n.sourceTitle || null}, ${n.embedding ? toVector(n.embedding) : null}::vector)
    `;
  }
  return notes.length;
}

export async function listTopics(userId) {
  const sql = getDb();
  const rows = await sql`
    select t.id, t.title, t.summary, t.kind, t.category, t.source_count, t.created_at, t.updated_at,
      (select count(*) from knowledge_notes n where n.topic_id = t.id) as note_count
    from knowledge_topics t where t.user_id = ${userId} order by t.updated_at desc
  `;
  return rows.map(topicShape);
}

export async function getTopic(userId, id) {
  const sql = getDb();
  const topics = await sql`
    select id, title, summary, kind, category, source_count, created_at, updated_at, 0 as note_count
    from knowledge_topics where id = ${id} and user_id = ${userId}
  `;
  if (!topics[0]) return null;
  const notes = await sql`
    select id, topic_id, content, source_url, source_title from knowledge_notes
    where topic_id = ${id} and user_id = ${userId} order by created_at asc
  `;
  return { ...topicShape(topics[0]), noteCount: notes.length, notes: notes.map(noteShape) };
}

// The notes closest in meaning to `embedding` (cosine), best first (1 = identical).
export async function searchNotes(userId, embedding, { limit = 4, minSimilarity = 0 } = {}) {
  const sql = getDb();
  const v = toVector(embedding);
  const rows = await sql`
    select n.id, n.topic_id, t.title, n.content, n.source_url, n.source_title, 1 - (n.embedding <=> ${v}::vector) as similarity
    from knowledge_notes n join knowledge_topics t on t.id = n.topic_id
    where n.user_id = ${userId} and n.embedding is not null
    order by n.embedding <=> ${v}::vector asc limit ${limit}
  `;
  return rows.map(noteShape).filter((n) => n.similarity >= minSimilarity);
}

// Without a usable embedding: notes (or topics) that mention any of the words
// (one case-insensitive regex, so there is a single plain-text parameter).
export async function searchNotesByWords(userId, words, { limit = 5 } = {}) {
  const pattern = words
    .slice(0, 6)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((w) => w.length >= 3)
    .join('|');
  if (!pattern) return [];
  const sql = getDb();
  const rows = await sql`
    select n.id, n.topic_id, t.title, n.content, n.source_url, n.source_title
    from knowledge_notes n join knowledge_topics t on t.id = n.topic_id
    where n.user_id = ${userId} and (n.content ~* ${pattern} or t.title ~* ${pattern})
    order by n.created_at desc limit ${limit}
  `;
  return rows.map(noteShape);
}

export async function deleteTopic(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from knowledge_topics where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function deleteNote(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from knowledge_notes where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function deleteAllTopics(userId) {
  const sql = getDb();
  const rows = await sql`delete from knowledge_topics where user_id = ${userId} returning id`;
  return rows.length;
}
