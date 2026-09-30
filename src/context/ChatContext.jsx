import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { sendChatMessage, confirmAction, EddieApiError } from '../services/api';
import { buildSystemPrompt, DEFAULT_MODE } from '../services/personality';
import { getLocalAnswer } from '../services/localAnswers';
import {
  getConversations,
  saveConversations,
  getActiveConversationId,
  setActiveConversationId,
  conversationTitle,
  getTasks,
} from '../utils/storage';
import { useSettings } from './SettingsContext';
import { useLocation } from './LocationContext';
import { useAuth } from './AuthContext';
import { applyTaskActions, tasksForContext } from '../services/taskActions';

const ChatContext = createContext(null);

const MAX_HISTORY_SENT = 16;

// Spoken or typed answers to a pending confirmation card ("sí" / "no").
const YES_RE = /^(si|sip|claro|dale|ok|okey|vale|de acuerdo|adelante|hazlo|procede|confirmo|confirmado|confirmalo|confirma|borrala|borralo|envialo|enviala|si por favor|si hazlo|si dale|si confirmo)$/;
const NO_RE = /^(no|nop|cancela|cancelar|cancelalo|cancelala|dejalo|dejala|mejor no|olvidalo|no gracias|no lo hagas|para)$/;

function normalizeReply(text) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(eddie )+|( eddie)+$/g, '');
}

// The card a "sí"/"no" would answer: a pending one on Eddie's latest reply.
function latestPendingConfirmation(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'assistant');
  const card = last?.confirmations?.find((c) => c.state === 'pending');
  return card ? { messageId: last.id, card } : null;
}
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

export function ChatProvider({ children }) {
  const { settings, memory } = useSettings();
  const { location } = useLocation();
  const { user } = useAuth();
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
  // What Eddie is doing right now while it works ("Buscando en internet…").
  const [activity, setActivity] = useState('');
  // Latest messages for callbacks that run later (a card being confirmed).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  // A short message from Eddie itself (no AI call), e.g. after a card is
  // confirmed; it's spoken like any reply when voice is on.
  const addEddieMessage = useCallback((content) => {
    const message = { id: nextId(), role: 'assistant', content, timestamp: Date.now(), provider: 'eddie' };
    setMessages((prev) => [...prev, message]);
    setLastReply(message);
  }, []);

  const updateConfirmation = useCallback((messageId, confirmationId, patch) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, confirmations: m.confirmations.map((c) => (c.id === confirmationId ? { ...c, ...patch } : c)) } : m,
      ),
    );
  }, []);

  // The user's answer to a confirmation card: "cancel", or "confirm" with
  // the card's arguments (possibly edited). Only a pending card can be
  // answered, and only once.
  const resolveConfirmation = useCallback(
    async (messageId, confirmationId, decision, editedArgs) => {
      const message = messagesRef.current.find((m) => m.id === messageId);
      const card = message?.confirmations?.find((c) => c.id === confirmationId);
      if (!card || card.state !== 'pending') return;

      if (decision !== 'confirm') {
        updateConfirmation(messageId, confirmationId, { state: 'cancelled' });
        addEddieMessage('Cancelado, no hice nada.');
        return;
      }

      const args = editedArgs || card.args;
      updateConfirmation(messageId, confirmationId, { state: 'running', args });
      try {
        const { result, actions } = await confirmAction({
          tool: card.tool,
          args,
          context: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks: tasksForContext() },
          disabledConnectors: settings.disabledConnectors || [],
        });
        if (actions.length) await applyTaskActions(actions, { signedIn: Boolean(user) });
        const summary = result.summary || 'Listo, hecho.';
        updateConfirmation(messageId, confirmationId, { state: 'done', result: summary });
        addEddieMessage(summary);
      } catch (err) {
        const reason = err instanceof EddieApiError ? err.message : 'No se pudo completar la acción.';
        updateConfirmation(messageId, confirmationId, { state: 'error', result: reason });
        addEddieMessage(`No pude hacerlo: ${reason}`);
      }
    },
    [settings, user, updateConfirmation, addEddieMessage],
  );

  const sendMessage = useCallback(
    // `display` and `tag` let a chat skill send a full template to the AI
    // while the bubble shows only what the user typed; `skill` and `title`
    // ride along on the reply so it can be exported as a document.
    async (text, { mode = DEFAULT_MODE, silent = false, display, tag, skill, title } = {}) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const userMessage = { id: nextId(), role: 'user', content: trimmed, timestamp: Date.now() };
      if (display) userMessage.display = display;
      if (tag) userMessage.tag = tag;
      const replyMeta = {};
      if (skill) replyMeta.skill = skill;
      if (title) replyMeta.title = title;
      setMessages((prev) => (silent ? prev : [...prev, userMessage]));
      setErrorMessage('');

      // "Sí" / "no" right after Eddie asked to confirm something answers the
      // card instead of starting a new request (voice-friendly).
      const pending = !tag && latestPendingConfirmation(messages);
      if (pending) {
        const reply = normalizeReply(trimmed);
        const decision = YES_RE.test(reply) ? 'confirm' : NO_RE.test(reply) ? 'cancel' : null;
        if (decision) {
          resolveConfirmation(pending.messageId, pending.card.id, decision);
          return null;
        }
      }

      // Small talk and self-referential trivia (how are you, what day is
      // it) are answered by Eddie itself — no AI provider involved, so
      // these never fail even if Gemini/Claude is down or rate-limited.
      const localAnswer = !tag && getLocalAnswer(trimmed, {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: settings.language,
      });
      if (localAnswer) {
        const assistantMessage = { id: nextId(), role: 'assistant', content: localAnswer, timestamp: Date.now(), provider: 'eddie' };
        setMessages((prev) => [...prev, assistantMessage]);
        setLastReply(assistantMessage);
        return assistantMessage;
      }

      setStatus('processing');

      const history = [...messages, userMessage].slice(-MAX_HISTORY_SENT);
      const system = buildSystemPrompt({
        mode,
        language: settings.language,
        memory: settings.memoryEnabled ? memory : {},
        tasks: getTasks(),
        disabledConnectors: settings.disabledConnectors || [],
      });

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
            tasks: tasksForContext(),
          },
          disabledConnectors: settings.disabledConnectors || [],
          onActivity: (label) => setActivity(label || ''),
          onChunk: (fullTextSoFar) => {
            if (!responseStarted) {
              setActivity('');
              responseStarted = true;
              setStatus('responding');
              setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: fullTextSoFar, timestamp: Date.now(), ...replyMeta }]);
            } else {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullTextSoFar } : m)));
            }
          },
        });

        const assistantMessage = { id: assistantId, role: 'assistant', content: result.content, timestamp: Date.now(), provider: result.provider, ...replyMeta };
        if (result.fallbackFrom) assistantMessage.fallbackFrom = result.fallbackFrom;
        setActivity('');
        // Actions waiting for the user's OK, shown as cards under the reply.
        if (result.confirmations?.length) {
          assistantMessage.confirmations = result.confirmations.map((c) => ({ ...c, state: 'pending' }));
        }
        // Tasks Eddie created or completed while answering: applied to the
        // Tareas list, and noted on the bubble so the change is visible.
        if (result.actions?.length) {
          applyTaskActions(result.actions, { signedIn: Boolean(user) });
          assistantMessage.taskChanges = result.actions
            .map((a) => (a.type === 'create_task' ? `Tarea creada: ${a.task?.title}` : a.type === 'complete_task' ? `Tarea hecha: ${a.title}` : null))
            .filter(Boolean);
        }
        setMessages((prev) => (responseStarted ? prev.map((m) => (m.id === assistantId ? assistantMessage : m)) : [...prev, assistantMessage]));
        setLastReply(assistantMessage);
        window.setTimeout(() => setStatus((s) => (s === 'responding' ? 'idle' : s)), 600);
        return assistantMessage;
      } catch (err) {
        setActivity('');
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
    [messages, settings, memory, location, user, resolveConfirmation],
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
      activity,
      resolveConfirmation,
      setStatus,
      conversations,
      conversationId,
      loadConversation,
      deleteConversation,
      clearAllConversations,
    }),
    [messages, status, errorMessage, sendMessage, resetConversation, lastReply, activity, resolveConfirmation, conversations, conversationId, loadConversation, deleteConversation, clearAllConversations],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
