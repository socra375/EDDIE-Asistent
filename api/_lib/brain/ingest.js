// Where what Eddie analysed goes (see analyze.js and src/services/brainKinds.js):
//
//  - a document dropped on the SECOND brain becomes a topic (a summary plus its
//    essential notes, with vectors, so Eddie finds them by meaning);
//  - a document dropped on MEMORIA (the first brain) is split into memory items
//    (profile, preferences, projects, decisions, knowledge, context), returned
//    as the same actions Eddie's memory tools emit — the app applies them to
//    the user's memory, which syncs with the account;
//  - what a conversation taught (its skills) goes to the second brain, as
//    notes added to the skill's topic.
import { embedText } from '../episodes/embed.js';
import { cleanTopic, titleOf } from '../knowledge/learn.js';
import { MAX_TOPICS, appendNotes, countTopics, findTopic, replaceNotes, upsertTopic } from '../knowledge/store.js';
import { BrainError, analyzeDocument } from './analyze.js';
import { countsLabel, itemsToActions } from '../../../src/services/brainKinds.js';

const embedder = (title) => (text) => embedText(`${title}: ${text}`, { taskType: 'RETRIEVAL_DOCUMENT' }).catch(() => null);

const stripExtension = (name) => String(name || '').replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim();

// One topic per skill title, notes added (never replaced). Best effort: a skill
// that cannot be kept never fails what called this.
export async function keepSkills(userId, skills, { embed = (title) => embedder(title), sourceTitle = null } = {}) {
  const byTitle = new Map();
  for (const s of skills) {
    const title = titleOf(cleanTopic(s.title));
    if (title.length < 2) continue;
    const group = byTitle.get(title.toLowerCase()) || { title, category: s.category, notes: [] };
    group.notes.push(s.text);
    byTitle.set(title.toLowerCase(), group);
  }
  const kept = [];
  for (const group of byTitle.values()) {
    try {
      const existing = await findTopic(userId, group.title);
      if (!existing && (await countTopics(userId)) >= MAX_TOPICS) continue;
      const topic = await upsertTopic(userId, { title: group.title, summary: existing?.summary || group.notes[0].slice(0, 500), kind: 'habilidad', category: group.category, sourceCount: 1 });
      const embedNote = embed(group.title);
      const notes = await Promise.all(group.notes.map(async (content) => ({ content, sourceUrl: null, sourceTitle, embedding: await embedNote(content) })));
      const added = await appendNotes(userId, topic.id, notes);
      kept.push({ id: topic.id, title: topic.title, added, created: !existing });
    } catch (err) {
      console.error('[brain] keeping a skill failed:', err.message);
    }
  }
  return kept;
}

// → what the screen shows after a document. `target`: 'knowledge' | 'memory'.
export async function ingestDocument({ userId, name, text, target }, deps = {}) {
  const { analyze = analyzeDocument, embed = embedder } = deps;
  const analysis = await analyze({ name, text });
  const { actions, counts } = itemsToActions(analysis.items, { skillsToMemory: target === 'memory' });
  const base = { target, name: String(name || ''), title: analysis.title, kind: analysis.kind, category: analysis.category, summary: analysis.summary, counts, truncated: analysis.truncated };

  if (target === 'memory') {
    if (!actions.length) throw new BrainError('Leí el documento pero no encontré datos, preferencias, proyectos ni decisiones que guardar en la memoria. Pruébalo en el segundo cerebro.', 'NOTHING_USEFUL');
    return { ...base, actions, label: countsLabel(counts) };
  }

  const title = titleOf(cleanTopic(analysis.title || stripExtension(name)));
  // The notes of the document; when it gave none, the knowledge and skills it listed stand in.
  const noteTexts = analysis.notes.length >= 2 ? analysis.notes : [...analysis.items.filter((i) => i.kind === 'conocimiento' || i.kind === 'habilidad').map((i) => i.text), ...analysis.notes];
  if (title.length < 2 || noteTexts.length < 2 || !analysis.summary) throw new BrainError('Leí el documento pero no saqué información clara y útil para el segundo cerebro. Pruébalo en Memoria.', 'NOTHING_USEFUL');
  const existing = await findTopic(userId, title);
  if (!existing && (await countTopics(userId)) >= MAX_TOPICS) throw new BrainError(`Ya hay ${MAX_TOPICS} temas en el segundo cerebro: olvida alguno para guardar este documento.`, 'FULL');
  const sourceTitle = String(name || '').slice(0, 140) || null;
  const embedNote = embed(title);
  const notes = await Promise.all(noteTexts.slice(0, 14).map(async (content) => ({ content, sourceUrl: null, sourceTitle, embedding: await embedNote(content) })));
  const topic = await upsertTopic(userId, { title, summary: analysis.summary, kind: analysis.kind, category: analysis.category, sourceCount: 1 });
  await replaceNotes(userId, topic.id, notes);
  const { counts: other } = itemsToActions(analysis.items.filter((i) => ['dato', 'preferencia', 'proyecto', 'decision', 'contexto'].includes(i.kind)));
  return { ...base, topic: { id: topic.id, title: topic.title, kind: topic.kind, category: topic.category }, noteCount: notes.length, updated: Boolean(existing), personal: countsLabel(other) };
}
