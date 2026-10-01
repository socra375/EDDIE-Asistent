import { useCallback, useEffect, useRef } from 'react';
import { saveEpisode } from '../services/episodes';
import { freshMessages } from '../services/episodeMessages';

// Eddie keeps a short note of each conversation (conversation memory). A
// conversation is closed — summarized on the server and remembered — when:
//  - nobody has written for IDLE_MS,
//  - the user moves to another conversation, or
//  - the page is closed.
// Only the messages after the last note are sent, and only when there are
// enough of them to be worth remembering.
const IDLE_MS = 5 * 60 * 1000;
const MIN_FRESH = 4;
const PROGRESS_KEY = 'eddie.episodes.progress';
const MAX_TRACKED = 60;

function readProgress() {
  try {
    const value = JSON.parse(localStorage.getItem(PROGRESS_KEY));
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

function writeProgress(map) {
  try {
    const entries = Object.entries(map).slice(-MAX_TRACKED);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage is a convenience: without it a conversation may be summarized twice at worst.
  }
}

export function useEpisodeSaver({ conversationId, messages, enabled }) {
  const latest = useRef({});
  const inflight = useRef(new Set());
  const enabledRef = useRef(enabled);
  const currentId = useRef(conversationId);

  useEffect(() => {
    enabledRef.current = enabled;
    currentId.current = conversationId;
    latest.current[conversationId] = messages;
  }, [enabled, conversationId, messages]);

  const flush = useCallback(async (id, { keepalive = false } = {}) => {
    if (!enabledRef.current || inflight.current.has(id)) return;
    const all = latest.current[id];
    if (!all?.length) return;
    const progress = readProgress();
    const fresh = freshMessages(all, progress[id] || 0);
    if (fresh.length < MIN_FRESH) return;
    inflight.current.add(id);
    try {
      await saveEpisode({ conversationId: id, messages: fresh.map(({ role, content }) => ({ role, content })), keepalive });
      const next = readProgress();
      delete next[id]; // re-insert last, so the oldest entries are the ones dropped
      next[id] = all.length;
      writeProgress(next);
    } catch {
      // Offline, signed out or the provider is busy: the next trigger tries again.
    } finally {
      inflight.current.delete(id);
    }
  }, []);

  // Quiet for a while.
  useEffect(() => {
    if (!enabled || messages.length === 0) return undefined;
    const timer = window.setTimeout(() => flush(conversationId), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [enabled, messages, conversationId, flush]);

  // Moving to another conversation (or starting a new one).
  useEffect(() => {
    const id = conversationId;
    return () => {
      flush(id);
    };
  }, [conversationId, flush]);

  // Closing the page.
  useEffect(() => {
    const onHide = () => flush(currentId.current, { keepalive: true });
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);
}
