// Database side of conversation memory (see db/migrations/0004_episodes.sql).
import { getDb } from '../db.js';
import { toVector } from './embed.js';

// Past this many, the oldest are dropped: this is a notebook, not an archive.
export const MAX_EPISODES = 300;
// A runaway client can't turn the AI quota into summaries.
const MAX_SAVES_PER_HOUR = 20;

const shape = (row) => ({
  id: String(row.id),
  summary: row.summary,
  source: row.source,
  messageCount: Number(row.message_count || 0),
  createdAt: new Date(row.created_at).toISOString(),
  ...(row.similarity != null ? { similarity: Number(row.similarity) } : {}),
});

export async function recentSaveCount(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from episodes where user_id = ${userId} and created_at > now() - interval '1 hour'`;
  return Number(rows[0]?.n || 0);
}

export const saveLimitReached = async (userId) => (await recentSaveCount(userId)) >= MAX_SAVES_PER_HOUR;

export async function addEpisode(userId, { summary, embedding, conversationId = null, source = 'web', messageCount = 0 }) {
  const sql = getDb();
  const rows = await sql`
    insert into episodes (user_id, source, conversation_id, summary, message_count, embedding)
    values (${userId}, ${source}, ${conversationId}, ${summary}, ${messageCount}, ${toVector(embedding)}::vector)
    returning id, summary, source, message_count, created_at
  `;
  await sql`
    delete from episodes where user_id = ${userId} and id in (
      select id from episodes where user_id = ${userId} order by created_at desc offset ${MAX_EPISODES}
    )
  `;
  return shape(rows[0]);
}

// The closest episodes to `embedding` (cosine), best first, with their similarity (1 = identical).
export async function searchEpisodes(userId, embedding, { limit = 3, minSimilarity = 0 } = {}) {
  const sql = getDb();
  const v = toVector(embedding);
  const rows = await sql`
    select id, summary, source, message_count, created_at, 1 - (embedding <=> ${v}::vector) as similarity
    from episodes where user_id = ${userId}
    order by embedding <=> ${v}::vector asc limit ${limit}
  `;
  return rows.map(shape).filter((e) => e.similarity >= minSimilarity);
}

export async function listEpisodes(userId, limit = 100) {
  const sql = getDb();
  const rows = await sql`select id, summary, source, message_count, created_at from episodes where user_id = ${userId} order by created_at desc limit ${limit}`;
  return rows.map(shape);
}

export async function countEpisodes(userId) {
  const sql = getDb();
  const rows = await sql`select count(*)::int as n from episodes where user_id = ${userId}`;
  return Number(rows[0]?.n || 0);
}

export async function deleteEpisode(userId, id) {
  const sql = getDb();
  const rows = await sql`delete from episodes where id = ${id} and user_id = ${userId} returning id`;
  return rows.length > 0;
}

export async function deleteAllEpisodes(userId) {
  const sql = getDb();
  const rows = await sql`delete from episodes where user_id = ${userId} returning id`;
  return rows.length;
}
