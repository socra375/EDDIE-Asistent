// A new conversation every 24 hours. A chat that goes on for days drags yesterday's topics into today's answers, so
// once the conversation in front of the user is a day old it is left in the history (it is already saved there) and
// an empty one takes its place. Pure, so it is tested without a browser. The browser panel (/?panel=1) keeps its own
// conversations apart from the ones in Eddie's own window (see utils/storage.js), each with this same rule.
export const ROTATE_AFTER_MS = 24 * 60 * 60 * 1000;
export const CHECK_EVERY_MS = 60 * 1000;

// When the conversation began: its first message. null for an empty one (nothing to rotate).
export function startedAt(messages) {
  const first = Array.isArray(messages) ? messages[0] : null;
  const t = Number(first?.timestamp);
  return Number.isFinite(t) && t > 0 ? t : null;
}

// True once the conversation is 24 hours old. A clock set back (a start in the future) never counts as old.
export function isStale(messages, now = Date.now(), after = ROTATE_AFTER_MS) {
  const t = startedAt(messages);
  return t != null && now - t >= after;
}

// What to open when Eddie starts: the active conversation if it is still fresh, otherwise a blank one.
// → { id, messages, rotated }  (`newId` makes the id of a blank conversation)
export function restoreActive({ activeId, conversations, now = Date.now(), newId }) {
  const found = activeId ? (conversations || []).find((c) => c.id === activeId) : null;
  if (found && !isStale(found.messages, now)) return { id: found.id, messages: found.messages, rotated: false };
  return { id: newId(), messages: [], rotated: Boolean(found) };
}
