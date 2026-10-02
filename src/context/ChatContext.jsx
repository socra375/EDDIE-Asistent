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
import { applyMemoryActions } from '../services/memoryActions';
import { applyBrowserActions } from '../services/browserActions';
import { isSleepCommand } from '../services/wakeWord';
import { isSeeQuestion, parseHudCommand, parseVigilanceCommand } from '../services/commands';
import { HUD_EVENT } from '../services/hudBridge';
import { VIGILANCE_EVENT, visionBridge } from '../services/visionBridge';
import { useEpisodeSaver } from '../hooks/useEpisodeSaver';
import { IMAGE_PROMPT } from '../services/images';
import { askProbe, looksLikeSystemQuestion, PROBE_AUTO_TIMEOUT_MS, stepsFromTools } from '../services/probeCore';
import { autoDetectReady, getProbeConfig } from '../services/probe';
import { markVoice } from '../services/voiceTiming';
import { getMemory } from '../utils/storage';
import { memoryForContext } from '../services/memory';

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
// With memory switched off in Configuración, Eddie neither sees nor writes it.
function disabledFor(settings) {
  const off = settings.disabledConnectors || [];
  if (settings.memoryEnabled !== false) return off;
  // Without memory, Eddie also neither keeps nor consults conversation notes.
  return [...new Set([...off, 'memory', 'conversations'])];
}
function memoryContext(settings) {
  return settings.memoryEnabled === false ? [] : memoryForContext(getMemory());
}
// The full pictures of recent messages, kept in memory only: the saved
// conversation keeps just a thumbnail, so after a reload Eddie can still be
// asked about a picture seen in this session but not about an older one.
const fullImages = new Map();

// What goes to the server for each message: the full pictures of the last two
// messages that have them (when still in memory), a note for the rest.
function withImages(history) {
  const recent = new Set(history.filter((m) => m.images?.length && fullImages.has(m.id)).slice(-2).map((m) => m.id));
  return history.map(({ id, role, content, images }) => {
    if (!images?.length) return { role, content };
    if (recent.has(id)) return { role, content, images: fullImages.get(id) };
    return { role, content: `${content}\n[Adjuntó ${images.length === 1 ? 'una imagen que ya no está disponible' : `${images.length} imágenes que ya no están disponibles`}.]` };
  });
}

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `${Date.now()}-${idCounter}`;
}

export function ChatProvider({ children }) {
  const { settings, memory, updateWakeSettings } = useSettings();
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
  // The steps (tool calls) of the request in flight, before its reply bubble
  // exists; once it does they live on the message as `steps`.
  const [liveSteps, setLiveSteps] = useState([]);
  // What Eddie is doing right now, for the one-line status ("Buscando en internet…").
  const activity = useMemo(() => [...liveSteps].reverse().find((s) => s.status === 'running')?.activity || '', [liveSteps]);
  // Latest messages for callbacks that run later (a card being confirmed).
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    setActiveConversationId(conversationId);
  }, [conversationId]);

  // Conversation memory: each finished conversation leaves a short note on
  // the server (only when signed in and memory / the connector are on).
  useEpisodeSaver({
    conversationId,
    messages,
    enabled: Boolean(user) && settings.memoryEnabled !== false && !(settings.disabledConnectors || []).includes('conversations'),
  });

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

  // A line in the conversation that is not read aloud (the briefing says it
  // piece by piece itself).
  const addNote = useCallback((content) => {
    setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content, timestamp: Date.now(), provider: 'eddie' }]);
  }, []);

  const updateConfirmation = useCallback((messageId, confirmationId, patch) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, confirmations: m.confirmations.map((c) => (c.id === confirmationId ? { ...c, ...patch } : c)) } : m,
      ),
    );
  }, []);

  // A card's step on the same message (card.stepId) follows the card.
  const updateStep = useCallback((messageId, stepId, patch) => {
    if (!stepId) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId && m.steps ? { ...m, steps: m.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : m)),
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
        updateStep(messageId, card.stepId, { status: 'cancelled', summary: 'Lo cancelaste.' });
        addEddieMessage('Cancelado, no hice nada.');
        return;
      }

      const args = editedArgs || card.args;
      updateConfirmation(messageId, confirmationId, { state: 'running', args });
      updateStep(messageId, card.stepId, { status: 'running', summary: 'Haciéndolo…' });
      try {
        const { result, actions } = await confirmAction({
          tool: card.tool,
          args,
          context: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks: tasksForContext(), memory: memoryContext(settings) },
          disabledConnectors: disabledFor(settings),
        });
        if (actions.length) await applyTaskActions(actions, { signedIn: Boolean(user) });
        if (actions.length) applyMemoryActions(actions);
        const summary = result.summary || 'Listo, hecho.';
        updateConfirmation(messageId, confirmationId, { state: 'done', result: summary });
        updateStep(messageId, card.stepId, { status: 'done', summary, verified: result.verified ?? null });
        addEddieMessage(summary);
      } catch (err) {
        const reason = err instanceof EddieApiError ? err.message : 'No se pudo completar la acción.';
        updateConfirmation(messageId, confirmationId, { state: 'error', result: reason });
        updateStep(messageId, card.stepId, { status: 'error', summary: reason });
        addEddieMessage(`No pude hacerlo: ${reason}`);
      }
    },
    [settings, user, updateConfirmation, updateStep, addEddieMessage],
  );

  const sendMessage = useCallback(
    // `display` and `tag` let a chat skill send a full template to the AI
    // while the bubble shows only what the user typed; `skill` and `title`
    // ride along on the reply so it can be exported as a document.
    async (text, { mode = DEFAULT_MODE, silent = false, display, tag, skill, title, images = [], probe = false } = {}) => {
      const trimmed = text.trim() || (images.length ? IMAGE_PROMPT : '');
      if (!trimmed) return;
      markVoice('send');

      // "¿Qué ves?" while Modo Vigilancia has the camera on: the current
      // picture travels with the question, like any attached image.
      const seeing = !tag && !probe && !images.length && isSeeQuestion(trimmed, settings.wake?.word);
      if (seeing && visionBridge.isActive()) {
        const frame = await visionBridge.getFrame();
        if (frame) images = [frame];
      }

      // The local probe (Sonda Local) on the user's computer answers only when
      // the chat panel's «Sonda local» switch is on (`probe: true`, typed
      // messages only — the voice ring and the wake word never use it), or,
      // if the user turned that on, for clear questions about the machine's
      // hardware (and then the cloud answers if the probe doesn't in time).
      const probeConfig = getProbeConfig();
      const forcedProbe = probe && !tag && !images.length;
      const autoProbe = !forcedProbe && !tag && !images.length && autoDetectReady(probeConfig) && looksLikeSystemQuestion(trimmed);
      const viaProbe = forcedProbe || autoProbe;

      const userMessage = { id: nextId(), role: 'user', content: trimmed, timestamp: Date.now() };
      // Talks with the probe are kept out of the conversation memory (the notes saved on the server).
      if (viaProbe) userMessage.local = true;
      if (images.length) {
        userMessage.images = images.map(({ thumb, name }) => ({ thumb, name }));
        fullImages.set(userMessage.id, images.map(({ mimeType, data }) => ({ mimeType, data })));
      }
      if (display) userMessage.display = display;
      if (tag) userMessage.tag = tag;
      const replyMeta = {};
      if (skill) replyMeta.skill = skill;
      if (title) replyMeta.title = title;
      setMessages((prev) => (silent ? prev : [...prev, userMessage]));
      setErrorMessage('');

      // "Modo Vigilancia" / "desactiva el modo vigilancia": the camera (see
      // context/VisionContext.jsx) switches on or off; Eddie answers by himself.
      const vigilance = !tag && !images.length && parseVigilanceCommand(trimmed, settings.wake?.word);
      if (vigilance) {
        const wasActive = visionBridge.isActive();
        window.dispatchEvent(new CustomEvent(VIGILANCE_EVENT, { detail: { action: vigilance } }));
        if (vigilance === 'on') {
          addEddieMessage(
            !visionBridge.isSupported()
              ? 'Este navegador no permite usar la cámara.'
              : wasActive
                ? 'El modo vigilancia ya estaba activado.'
                : !visionBridge.hasConsent()
                  ? 'Para activar el modo vigilancia necesito tu permiso para usar la cámara. Pulsa «Permitir y encender» en el panel Cámara de Inicio.'
                  : 'Modo vigilancia activado. Estoy observando.',
          );
        } else {
          addEddieMessage(wasActive ? 'Vigilancia desactivada. Apagué la cámara.' : 'La vigilancia ya estaba apagada.');
        }
        return null;
      }

      // "Activa sistema" / "Desactiva sistema" / "Dame los datos de hoy": the
      // info panels of the home screen (context/HudContext.jsx). The briefing
      // is spoken by the home screen (it has the weather and the system), so
      // Eddie answers by himself only to the other two.
      const hud = !tag && !images.length && parseHudCommand(trimmed, settings.wake?.word);
      if (hud) {
        window.dispatchEvent(new CustomEvent(HUD_EVENT, { detail: { action: hud } }));
        if (hud === 'show') addEddieMessage('Sistema activado. Dejo los paneles a la vista hasta que digas «desactiva sistema».');
        else if (hud === 'hide') addEddieMessage('Sistema desactivado. Paneles ocultos.');
        return null;
      }

      // "¿Qué ves?" with nothing to look at.
      if (seeing && !images.length) {
        addEddieMessage(
          visionBridge.isActive()
            ? 'Todavía no tengo imagen de la cámara. Inténtalo en unos segundos.'
            : 'La cámara está apagada. Di «Modo Vigilancia» para encenderla y luego pregúntame qué veo.',
        );
        return null;
      }

      // "Eddie, suspéndete" / "apágate": switches the microphone (the wake word
      // listener) off, by voice or by typing. Turning it back on is up to the
      // user, in Memoria — with the microphone off Eddie can't hear them.
      if (!tag && isSleepCommand(trimmed, settings.wake?.word)) {
        const wasOn = Boolean(settings.wake?.enabled);
        updateWakeSettings({ enabled: false });
        addEddieMessage(
          wasOn
            ? 'Me suspendo: apagué el micrófono y ya no escucho la palabra clave. Cuando quieras, actívame otra vez en Memoria.'
            : 'El micrófono de la palabra clave ya estaba apagado. Puedes activarlo en Memoria.',
        );
        return null;
      }

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

      if (viaProbe) {
        setStatus('processing');
        setLiveSteps([{ id: 'p0', tool: 'probe', label: 'Sonda local', activity: 'Consultando la sonda de tu equipo…', status: 'running' }]);
        try {
          const { response, tools } = await askProbe({ url: probeConfig.url, key: probeConfig.key, message: trimmed, ...(autoProbe ? { timeoutMs: PROBE_AUTO_TIMEOUT_MS } : {}) });
          markVoice('firstToken');
          const steps = stepsFromTools(tools);
          const assistantMessage = { id: nextId(), role: 'assistant', content: response, timestamp: Date.now(), provider: 'probe', local: true, ...(steps.length ? { steps } : {}) };
          setLiveSteps([]);
          setMessages((prev) => [...prev, assistantMessage]);
          setLastReply(assistantMessage);
          setStatus('idle');
          return assistantMessage;
        } catch (err) {
          setLiveSteps([]);
          if (!autoProbe) {
            const message = err?.message || 'No pude hablar con la sonda local.';
            setStatus('error');
            setErrorMessage(message);
            setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', content: message, timestamp: Date.now(), isError: true, provider: 'probe', local: true }]);
            window.setTimeout(() => setStatus((st) => (st === 'error' ? 'idle' : st)), 2500);
            return null;
          }
          // Detected automatically and the probe isn't there: Eddie answers as usual.
          setMessages((prev) => prev.map((m) => (m.id === userMessage.id ? { ...m, local: undefined } : m)));
          userMessage.local = undefined;
        }
      }

      // Small talk and self-referential trivia (how are you, what day is
      // it) are answered by Eddie itself — no AI provider involved, so
      // these never fail even if Gemini/Claude is down or rate-limited.
      const localAnswer = !tag && !images.length && getLocalAnswer(trimmed, {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: settings.language,
      });
      if (localAnswer) {
        markVoice('firstToken');
        const assistantMessage = { id: nextId(), role: 'assistant', content: localAnswer, timestamp: Date.now(), provider: 'eddie' };
        setMessages((prev) => [...prev, assistantMessage]);
        setLastReply(assistantMessage);
        return assistantMessage;
      }

      setStatus('processing');

      // What was said with the local probe stays out of what the cloud sees:
      // its answers ("no puedo, pero puedo revisar el disco duro") would be imitated.
      const history = [...messages, userMessage].filter((m) => !m.local).slice(-MAX_HISTORY_SENT);
      const system = buildSystemPrompt({
        mode,
        language: settings.language,
        memory: settings.memoryEnabled ? memory : null,
        query: trimmed,
        tasks: getTasks(),
        disabledConnectors: settings.disabledConnectors || [],
        spoken: Boolean(settings.voice?.autoRead),
      });

      // Filled in as soon as the first chunk arrives, so the bubble appears
      // and grows live instead of popping in all at once at the end.
      const assistantId = nextId();
      let responseStarted = false;
      // Steps seen so far, merged by id (a step arrives once as it starts and
      // again as it ends).
      let steps = [];
      const mergeSteps = (list, step) => {
        const i = list.findIndex((s) => s.id === step.id);
        return i === -1 ? [...list, step] : list.map((s, j) => (j === i ? { ...s, ...step } : s));
      };
      setLiveSteps([]);

      try {
        const result = await sendChatMessage({
          provider: settings.provider,
          model: settings.model || undefined,
          system,
          messages: withImages(history),
          context: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            location: location || undefined,
            tasks: tasksForContext(),
            memory: memoryContext(settings),
          },
          disabledConnectors: disabledFor(settings),
          onStep: (step) => {
            steps = mergeSteps(steps, step);
            if (responseStarted) setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, steps } : m)));
            else setLiveSteps(steps);
          },
          onChunk: (fullTextSoFar) => {
            if (!responseStarted) {
              markVoice('firstToken');
              setLiveSteps([]);
              responseStarted = true;
              setStatus('responding');
              setMessages((prev) => [
                ...prev,
                { id: assistantId, role: 'assistant', content: fullTextSoFar, timestamp: Date.now(), ...(steps.length ? { steps } : {}), ...replyMeta },
              ]);
            } else {
              setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: fullTextSoFar } : m)));
            }
          },
        });

        const assistantMessage = { id: assistantId, role: 'assistant', content: result.content, timestamp: Date.now(), provider: result.provider, ...replyMeta };
        if (result.fallbackFrom) assistantMessage.fallbackFrom = result.fallbackFrom;
        setLiveSteps([]);
        // The server's list is the final word on the receipt.
        const finalSteps = result.steps?.length ? result.steps : steps;
        if (finalSteps.length) assistantMessage.steps = finalSteps;
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
        // Pages Eddie opened (YouTube): those the browser blocked stay as buttons.
        if (result.actions?.length) {
          const links = applyBrowserActions(result.actions);
          if (links.length) assistantMessage.links = links;
        }
        // Things Eddie saved to (or removed from) the memory while answering.
        if (result.actions?.length) {
          const remembered = applyMemoryActions(result.actions);
          if (remembered.length) assistantMessage.memoryChanges = remembered;
        }
        setMessages((prev) => (responseStarted ? prev.map((m) => (m.id === assistantId ? assistantMessage : m)) : [...prev, assistantMessage]));
        setLastReply(assistantMessage);
        window.setTimeout(() => setStatus((s) => (s === 'responding' ? 'idle' : s)), 600);
        return assistantMessage;
      } catch (err) {
        setLiveSteps([]);
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
            { id: nextId(), role: 'assistant', content: `No pude completar la solicitud: ${message}`, timestamp: Date.now(), isError: true, ...(steps.length ? { steps } : {}) },
          ]);
        }
        window.setTimeout(() => setStatus((s) => (s === 'error' ? 'idle' : s)), 2500);
        return null;
      }
    },
    [messages, settings, memory, location, user, resolveConfirmation, updateWakeSettings, addEddieMessage],
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
      addNote,
      resetConversation,
      lastReply,
      activity,
      liveSteps,
      resolveConfirmation,
      setStatus,
      conversations,
      conversationId,
      loadConversation,
      deleteConversation,
      clearAllConversations,
    }),
    [messages, status, errorMessage, sendMessage, addNote, resetConversation, lastReply, activity, liveSteps, resolveConfirmation, conversations, conversationId, loadConversation, deleteConversation, clearAllConversations],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat debe usarse dentro de <ChatProvider>');
  return ctx;
}
