import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { sendChatMessage, EddieApiError } from '../services/api';
import { buildSystemPrompt } from '../services/personality';
import { getConversation, saveConversation, clearConversation } from '../utils/storage';
import { useSettings } from './SettingsContext';

const ChatContext = createContext(null);

const MAX_HISTORY_SENT = 16;
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

export function ChatProvider({ children }) {
  const { settings, memory } = useSettings();
  const [messages, setMessages] = useState(() => getConversation());
  const [status, setStatus] = useState('idle'); // idle | processing | responding | error
  const [errorMessage, setErrorMessage] = useState('');
  const [lastReply, setLastReply] = useState(null);

  useEffect(() => {
    saveConversation(messages);
  }, [messages]);

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

      try {
        const result = await sendChatMessage({
          provider: settings.provider,
          model: settings.model || undefined,
          system,
          messages: history.map(({ role, content }) => ({ role, content })),
        });

        setStatus('responding');
        const assistantMessage = {
          id: nextId(),
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          provider: result.provider,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setLastReply(assistantMessage);
        window.setTimeout(() => setStatus((s) => (s === 'responding' ? 'idle' : s)), 600);
        return assistantMessage;
      } catch (err) {
        setStatus('error');
        const message = err instanceof EddieApiError ? err.message : 'Ocurrió un error inesperado.';
        setErrorMessage(message);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: 'assistant', content: `No pude completar la solicitud: ${message}`, timestamp: Date.now(), isError: true },
        ]);
        window.setTimeout(() => setStatus((s) => (s === 'error' ? 'idle' : s)), 2500);
        return null;
      }
    },
    [messages, settings, memory],
  );

  const resetConversation = useCallback(() => {
    clearConversation();
    setMessages([]);
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const value = useMemo(
    () => ({ messages, status, errorMessage, sendMessage, resetConversation, lastReply, setStatus }),
    [messages, status, errorMessage, sendMessage, resetConversation, lastReply],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
