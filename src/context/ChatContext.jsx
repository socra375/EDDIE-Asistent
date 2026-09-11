import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sendChatMessage, EddieApiError } from '../services/api';
import { buildSystemPrompt } from '../services/personality';
import {
  getConversations,
  saveConversations,
  getActiveConversationId,
  setActiveConversationId,
  conversationTitle,
} from '../utils/storage';
import { useSettings } from './SettingsContext';
import { useLocation } from './LocationContext';

const ChatContext = createContext(null);

const MAX_HISTORY_SENT = 16;
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

export function ChatProvider({ children }) {
  const { settings, memory } = useSettings();
  const { location } = useLocation();
  const [conversations, setConversations] = useState(() => getConversations());
  const [conversationId, setConversationId] = useState(() => {
    const activeId = getActiveConversationId();
    return activeId || nextId();
  });
  const [messages, setMessages] = useState(() => {
    const activeId = getActiveConversationId();
    const found = activeId && getConversations().find((c) => c.id === activeId);
    return found ? found.messages : [];
  });
  const [status, setStatus] = useState('idle'); // idle | processing | responding | error
  const [errorMessage, setErrorMessage] = useState('');
  const [lastReply, setLastReply] = useState(null);

  useEffect(() => {
    setActiveConversationId(conversationId);
  }, [conversationId]);

  // Persists the active conversation into the saved list as it grows. A
  // conversation with no messages yet is never written, so starting a new
  // one (or just opening the app) doesn't clutter the history with empties.
  useEffect(() => {
    if (messages.length === 0) return;
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === conversationId);
      const updatedAt = messages[messages.length - 1]?.timestamp || Date.now();
      const next = [...prev];
      if (idx === -1) {
        next.push({ id: conversationId, title: conversationTitle(messages), messages, createdAt: messages[0]?.timestamp || Date.now(), updatedAt });
      } else {
        next[idx] = { ...next[idx], title: conversationTitle(messages), messages, updatedAt };
      }
      saveConversations(next);
      return next;
    });
  }, [messages, conversationId]);

  const sendMessage = useCallback(
    async (text, { mode = 'explicativo', silent = false } = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMessage = { id: nextId(), role: 'user', content: trimmed, timestamp: Date.now() };
      setMessages((prev) => (silent ? prev : [...prev, userMessage]));
      setStatus('processing');
      setErrorMessage('');

      const history = [...messages, userMessage].slice(-MAX_HISTORY_SENT);
      const system = buildSystemPrompt({ mode, language: settings.language, memory: settings.memoryEnabled ? memory : {} });

      // Filled in as soon as the first chunk arrives, so the bubble appears
      // and grows live instead of popping in all at once at the end.
      const assistantId = nextId();
      let responseStarted = false;

      try {
        const result = await sendChatMessage({
          provider: settings.provider,
          model: settings.model || undefined,
          system,
          messages: history.map(({ role, content }) => ({ role, content })),
          context: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: location || undefined,
          },
          onChunk: (fullTextSoFar) => {
            if (!responseStarted) {
              responseStarted = true;
              setStatus('responding');
              setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: fullTextSoFar, timestamp: Date.now() }]);
            } else {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullTextSoFar } : m)));
            }
          },
        });

        const assistantMessage = { id: assistantId, role: 'assistant', content: result.content, timestamp: Date.now(), provider: result.provider };
        setMessages((prev) => (responseStarted ? prev.map((m) => (m.id === assistantId ? assistantMessage : m)) : [...prev, assistantMessage]));
        setLastReply(assistantMessage);
        window.setTimeout(() => setStatus((s) => (s === 'responding' ? 'idle' : s)), 600);
        return assistantMessage;
      } catch (err) {
        setStatus('error');
        const message = err instanceof EddieApiError ? err.message : 'Ocurrió un error inesperado.';
        setErrorMessage(message);
        if (responseStarted) {
          // Some of the answer already streamed in — keep it visible and
          // annotate it, instead of hiding it behind a separate error bubble.
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: `${m.content}\n\n[No se pudo completar: ${message}]`, isError: true } : m)),
          );
        } else {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'assistant', content: `No pude completar la solicitud: ${message}`, timestamp: Date.now(), isError: true },
          ]);
        }
        window.setTimeout(() => setStatus((s) => (s === 'error' ? 'idle' : s)), 2500);
        return null;
      }
    },
    [messages, settings, memory, location],
  );

  // Starts a fresh, empty conversation. The one being left behind is
  // already saved (see the effect above), so it stays in the history.
  const resetConversation = useCallback(() => {
    setConversationId(nextId());
    setMessages([]);
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const loadConversation = useCallback(
    (id) => {
      const target = conversations.find((c) => c.id === id);
      if (!target) return;
      setConversationId(id);
      setMessages(target.messages);
      setStatus('idle');
      setErrorMessage('');
    },
    [conversations],
  );

  const deleteConversation = useCallback(
    (id) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== id);
        saveConversations(next);
        return next;
      });
      if (id === conversationId) {
        setConversationId(nextId());
        setMessages([]);
      }
    },
    [conversationId],
  );

  const clearAllConversations = useCallback(() => {
    saveConversations([]);
    setConversations([]);
    setConversationId(nextId());
    setMessages([]);
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const value = useMemo(
    () => ({
      messages,
      status,
      errorMessage,
      sendMessage,
      resetConversation,
      lastReply,
      setStatus,
      conversations,
      conversationId,
      loadConversation,
      deleteConversation,
      clearAllConversations,
    }),
    [messages, status, errorMessage, sendMessage, resetConversation, lastReply, conversations, conversationId, loadConversation, deleteConversation, clearAllConversations],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
