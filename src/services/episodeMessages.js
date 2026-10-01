// Pure helper for conversation memory (no browser APIs, so it is easy to test).
// What of a conversation still has to be kept: the messages after the ones
// already summarized, without Eddie's own notices (provider "eddie").
export function freshMessages(messages, savedCount = 0) {
  return (Array.isArray(messages) ? messages : [])
    .slice(Math.max(0, savedCount))
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.provider !== 'eddie' && typeof m.content === 'string' && m.content.trim());
}
