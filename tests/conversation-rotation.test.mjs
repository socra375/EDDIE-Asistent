// Una conversación nueva cada 24 horas, y el chat del panel del navegador aparte del de Eddie.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';

// The app's modules import each other without «.js» (Vite adds it); Node needs it said.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (/^\\.{1,2}\\//.test(specifier) && !/\\.[a-z]+$/.test(specifier)) {
    try { return await next(specifier + '.js', context); } catch { /* fall through */ }
  }
  return next(specifier, context);
}`));

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const R = await import(`${root}/src/services/conversationRotation.js`);
const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0);
const msgs = (hoursAgo) => [{ id: 'a', role: 'user', content: 'hola', timestamp: NOW - hoursAgo * HOUR }, { id: 'b', role: 'assistant', content: 'hola', timestamp: NOW - 1000 }];

test('a conversation is stale once it began 24 hours ago, measured from its first message', () => {
  assert.equal(R.isStale(msgs(23.9), NOW), false);
  assert.equal(R.isStale(msgs(24), NOW), true);
  assert.equal(R.isStale(msgs(70), NOW), true);
  assert.equal(R.isStale(msgs(0.1), NOW), false);
});

test('empty, malformed or from the future: never rotated', () => {
  assert.equal(R.isStale([], NOW), false);
  assert.equal(R.isStale(undefined, NOW), false);
  assert.equal(R.isStale([{ role: 'user', content: 'x' }], NOW), false, 'no timestamp');
  assert.equal(R.isStale([{ timestamp: NOW + 5 * HOUR }], NOW), false, 'a clock set back');
});

test('opening Eddie: the fresh conversation continues, the day-old one gives way to a blank one', () => {
  let n = 0;
  const newId = () => `new${(n += 1)}`;
  const conversations = [{ id: 'fresh', messages: msgs(5) }, { id: 'old', messages: msgs(30) }];
  assert.deepEqual(R.restoreActive({ activeId: 'fresh', conversations, now: NOW, newId }), { id: 'fresh', messages: msgs(5), rotated: false });
  const rotated = R.restoreActive({ activeId: 'old', conversations, now: NOW, newId });
  assert.deepEqual(rotated, { id: 'new1', messages: [], rotated: true });
  assert.equal(conversations.length, 2, 'the old one stays in the history');
  assert.deepEqual(R.restoreActive({ activeId: null, conversations, now: NOW, newId }), { id: 'new2', messages: [], rotated: false });
  assert.deepEqual(R.restoreActive({ activeId: 'gone', conversations, now: NOW, newId }), { id: 'new3', messages: [], rotated: false });
});

// ---- the panel keeps its own chats ----
function fakeBrowser(search) {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.window = { location: { search } };
  return store;
}

test('the browser panel and Eddie\'s own window never share a conversation', async () => {
  const store = fakeBrowser('');
  const S = await import(`${root}/src/utils/storage.js`);
  S.saveConversations([{ id: 'dia', title: 'Mi día', messages: msgs(2) }]);
  S.setActiveConversationId('dia');
  assert.ok(store.has('eddie.conversations') && store.has('eddie.activeConversationId'));
  // the same page opened as the extension's panel
  globalThis.window = { location: { search: '?panel=1' } };
  assert.deepEqual(S.getConversations(), [], 'the panel starts with its own, empty history');
  assert.equal(S.getActiveConversationId(), null);
  S.saveConversations([{ id: 'web', title: 'Sobre esta página', messages: msgs(1) }]);
  S.setActiveConversationId('web');
  assert.ok(store.has('eddie.conversations.panel') && store.has('eddie.activeConversationId.panel'));
  assert.equal(S.getActiveConversationId(), 'web');
  // and Eddie's window still has only its own
  globalThis.window = { location: { search: '' } };
  assert.equal(S.getConversations().length, 1);
  assert.equal(S.getConversations()[0].id, 'dia');
  assert.equal(S.getActiveConversationId(), 'dia');
});
