import { useEffect, useRef, useState } from 'react';
import { useChat } from '../context/ChatContext';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import { useWakeWord } from '../context/wakeWordState';
import { useVision } from '../context/visionState';
import { exportTxt } from '../utils/export';
import ChatPanel from '../components/Chat/ChatPanel';
import Icon from '../layout/Icon';
import ConfirmCard from '../components/Chat/ConfirmCard';
import StepTrace from '../components/Chat/StepTrace';
import EddieOrb from './EddieOrb';
import HudLayer from './HudLayer';
import { useHudDirector } from './useHudDirector';
import './Home.css';

const LABELS = {
  idle: 'EN ESPERA',
  listening: 'ESCUCHANDO',
  transcribing: 'TRANSCRIBIENDO',
  processing: 'PROCESANDO',
  responding: 'RESPONDIENDO',
  speaking: 'HABLANDO',
  disabled: 'DESACTIVADO',
  error: 'ERROR',
};

// Visual states that reuse another state's orb animation.
const RING_STATE = { responding: 'speaking', transcribing: 'processing' };

const PREVIEW_CHARS = 220;

// Why the browser's speech recognizer keeps failing, for the orb's tooltip.
const WAKE_REASONS = {
  network: 'El navegador no logra conectarse a su servicio de voz (¿sin internet, o bloqueado por quien administra el equipo?). Eddie sigue intentándolo.',
  'service-not-allowed': 'El navegador no deja usar su servicio de voz en este equipo.',
  'language-not-supported': 'El navegador no admite el idioma elegido para escuchar.',
  quick: 'El reconocimiento de voz del navegador se corta apenas empieza (la conexión o el micrófono fallan). Eddie sigue intentándolo.',
};
const WAKE_ANNOUNCE_MS = 2000;
const CHAT_KEY = 'eddie.home.chat';
const WIDE_QUERY = '(min-width: 1101px)';

// Whether the conversation starts open: what the user chose last time, else
// open on a wide window and closed (a drawer) on a narrow one.
function initialChatOpen() {
  try {
    const saved = localStorage.getItem(CHAT_KEY);
    if (saved === 'open' || saved === 'closed') return saved === 'open';
  } catch {
    // Without storage the default applies.
  }
  return window.matchMedia?.(WIDE_QUERY).matches ?? true;
}

export default function HomePanel({ onOpenTasks, focusOrb = false }) {
  const { status, sendMessage, lastReply, errorMessage, messages, activity, liveSteps, resolveConfirmation, resetConversation } = useChat();
  const wake = useWakeWord();
  const vision = useVision();
  const { settings, updateVoiceSettings } = useSettings();
  const { sttSupported, listening, transcribing, transcript, interimTranscript, start, stop, reset, speaking, stopSpeaking, sttError } =
    useVoice();
  const [chatOpen, setChatOpen] = useState(initialChatOpen);
  useHudDirector();
  // «Escuchando la palabra clave» is said for two seconds when you come in
  // (once the microphone is really listening), then the orb goes back to its
  // plain «En espera».
  const [announceWake, setAnnounceWake] = useState(false);
  const announcedWake = useRef(false);
  const announceTimers = useRef([]);
  useEffect(() => {
    if (wake.status !== 'listening' || announcedWake.current) return;
    announcedWake.current = true;
    const on = window.setTimeout(() => {
      setAnnounceWake(true);
      announceTimers.current.push(window.setTimeout(() => setAnnounceWake(false), WAKE_ANNOUNCE_MS));
    }, 0);
    announceTimers.current.push(on);
  }, [wake.status]);
  useEffect(() => {
    const timers = announceTimers.current;
    return () => timers.forEach(window.clearTimeout);
  }, []);

  // The "Hablar con Eddie" shortcut: the orb is ready, a tap (or Enter) starts listening.
  // (A page can't open the microphone or play sound before the user touches it.)
  useEffect(() => {
    if (focusOrb) document.querySelector('.eddie-orb__hit')?.focus();
  }, [focusOrb]);
  const [expanded, setExpanded] = useState(false);
  const voiceOn = settings.voice.autoRead;

  // Only a listen started from the ring auto-sends when it stops, so the
  // chat panel's own mic button (which fills its input instead) isn't
  // double-submitted.
  const ringListenRef = useRef(false);
  const wasListeningRef = useRef(false);
  useEffect(() => {
    if (wasListeningRef.current && !listening && ringListenRef.current) {
      ringListenRef.current = false;
      const text = `${transcript} ${interimTranscript}`.trim();
      if (text) {
        sendMessage(text);
        wake.noteVoiceSend?.(); // with the wake word on, the answer is followed by the open microphone window
      }
      reset();
    }
    wasListeningRef.current = listening;
  }, [listening, transcript, interimTranscript, sendMessage, reset, wake]);

  let visual = 'idle';
  if (transcribing) visual = 'transcribing';
  else if (listening) visual = 'listening';
  else if (status === 'processing') visual = 'processing';
  else if (status === 'responding') visual = 'responding';
  else if (speaking) visual = 'speaking';
  else if (status === 'error') visual = 'error';
  // A leftover mic error shouldn't outrank the user switching voice off.
  else if (!voiceOn || !sttSupported) visual = 'disabled';
  else if (sttError) visual = 'error';

  const errorText = status === 'error' ? errorMessage : sttError;
  let label = visual === 'error' ? `ERROR · ${(errorText || '').toUpperCase()}` : LABELS[visual];
  // At rest with the wake word on, say what it is doing — including when it is
  // not working, instead of quietly going back to "EN ESPERA".
  let labelTitle;
  let labelAction;
  if (visual === 'idle' && wake.enabled) {
    if (wake.status === 'listening') {
      if (announceWake) label = `ESCUCHANDO LA PALABRA CLAVE · «${wake.word.toUpperCase()}»`;
    }
    else if (wake.status === 'retrying') {
      label = 'PALABRA CLAVE SIN SEÑAL · REINTENTANDO';
      labelTitle = WAKE_REASONS[wake.reason] || WAKE_REASONS.quick;
    } else if (wake.status === 'denied') {
      label = 'MICRÓFONO BLOQUEADO · PULSA PARA REINTENTAR';
      labelTitle = 'El navegador bloqueó el micrófono: permítelo en el candado de la barra de direcciones y pulsa aquí.';
      labelAction = wake.retry;
    } else if (wake.status === 'error') {
      label = 'PALABRA CLAVE DETENIDA · PULSA PARA REINTENTAR';
      labelTitle = 'No se pudo usar el micrófono (¿otra app lo tiene ocupado?). Pulsa para reintentar.';
      labelAction = wake.retry;
    } else if (wake.status === 'unsupported') label = 'ESTE NAVEGADOR NO ESCUCHA LA PALABRA CLAVE';
  }

  function activate() {
    if (transcribing) return;
    if (listening) {
      stop();
      return;
    }
    if (speaking) {
      stopSpeaking();
      return;
    }
    if (status === 'processing' || status === 'responding') return;
    if (!sttSupported) {
      setChatOpen(true);
      return;
    }
    if (!voiceOn) updateVoiceSettings({ autoRead: true });
    ringListenRef.current = true;
    start();
  }

  // The conversation opens and closes: a column on a wide window (the orb takes
  // the room when it is closed), a drawer over the content on a narrow one. The
  // choice is remembered; Escape closes the drawer.
  function toggleChat(open = !chatOpen) {
    setChatOpen(open);
    try {
      localStorage.setItem(CHAT_KEY, open ? 'open' : 'closed');
    } catch {
      // The choice just isn't remembered.
    }
    if (open) window.setTimeout(() => document.querySelector('.home__conversation .chat-panel__textarea')?.focus(), 50);
  }

  useEffect(() => {
    if (!chatOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !window.matchMedia(WIDE_QUERY).matches) setChatOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chatOpen]);

  function exportConversation() {
    const lines = messages
      .filter((m) => !m.local && m.content)
      .map((m) => `${m.role === 'user' ? 'Tú' : 'Eddie'}: ${m.content}`)
      .join('\n\n');
    if (lines) exportTxt('conversacion-eddie.txt', lines);
  }

  const actionLabel = transcribing
    ? 'Transcribiendo tu voz'
    : listening
      ? 'Dejar de escuchar y enviar'
      : speaking
        ? 'Detener la voz de Eddie'
        : sttSupported
          ? 'Hablar con Eddie'
          : 'Escribirle a Eddie';

  const live = listening ? `${transcript} ${interimTranscript}`.trim() : '';
  const reply = lastReply?.content || '';
  // A card waiting for "sí"/"no" on Eddie's latest reply, shown under it.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const pendingCards = (lastAssistant?.confirmations || []).filter((c) => c.state === 'pending' || c.state === 'running');
  const replyPreview = expanded || reply.length <= PREVIEW_CHARS ? reply : `${reply.slice(0, PREVIEW_CHARS)}…`;

  return (
    <section className={`home ${chatOpen ? '' : 'home--chat-closed'}`}>
      <HudLayer onOpenTasks={onOpenTasks} />

      <div className="home__center">
        <EddieOrb state={RING_STATE[visual] || visual} label={label} labelTitle={labelTitle} onLabelClick={labelAction} onActivate={activate} actionLabel={actionLabel} />
        <div className="home__transcript" aria-live="polite">
          {live ? (
            <p className="home__live">“{live}”</p>
          ) : status === 'processing' && (activity || liveSteps.length > 0) ? (
            <>
              <StepTrace steps={liveSteps} live />
              {activity && <p className="home__activity">{activity}</p>}
            </>
          ) : reply ? (
            <>
              <StepTrace steps={lastAssistant?.steps} />
              <p className="home__reply">{replyPreview}</p>
              {reply.length > PREVIEW_CHARS && (
                <button type="button" className="home__more" onClick={() => setExpanded((v) => !v)}>
                  {expanded ? 'Ver menos' : 'Ver más'}
                </button>
              )}
              {lastAssistant?.links?.length > 0 && (
                <div className="home__links">
                  {lastAssistant.links.map((link) => (
                    <a key={link.url} className="btn" href={link.url} target="_blank" rel="noopener noreferrer">
                      <Icon name="play" size={14} /> {link.played ? 'Reproduciendo' : link.opened ? 'Abierto' : 'Abrir'} {link.label}
                    </a>
                  ))}
                </div>
              )}
              {pendingCards.map((card) => (
                <ConfirmCard
                  key={card.id}
                  card={card}
                  compact
                  onResolve={(decision, args) => resolveConfirmation(lastAssistant.id, card.id, decision, args)}
                />
              ))}
            </>
          ) : visual === 'processing' || sttSupported ? null : (
            <p className="home__hint">ESCRÍBELE A EDDIE EN LA CONVERSACIÓN</p>
          )}
        </div>

        <div className="home__actions">
          <button
            type="button"
            className={`home__fab ${vision.busy ? 'home__fab--live' : ''}`}
            onClick={vision.toggle}
            aria-label={vision.busy ? 'Apagar la cámara' : 'Encender la cámara (Modo Vigilancia)'}
            aria-pressed={vision.busy}
            title={vision.busy ? 'Apagar la cámara' : 'Encender la cámara (Modo Vigilancia)'}
          >
            <Icon name="camera" />
          </button>
          {sttSupported && (
            <button
              type="button"
              className={`home__fab ${listening ? 'home__fab--live' : ''}`}
              onClick={activate}
              aria-label={actionLabel}
              title={actionLabel}
            >
              <Icon name="mic" />
            </button>
          )}
          <button
            type="button"
            className={`home__fab ${chatOpen ? 'home__fab--live' : ''}`}
            onClick={() => toggleChat()}
            aria-label={chatOpen ? 'Cerrar la conversación' : 'Abrir la conversación y escribirle a Eddie'}
            aria-expanded={chatOpen}
            title={chatOpen ? 'Cerrar la conversación' : 'Abrir la conversación y escribirle a Eddie'}
          >
            <Icon name="chat" />
          </button>
        </div>
      </div>

      <aside className={`home__conversation ${chatOpen ? 'home__conversation--open' : ''}`} aria-label="Conversación con Eddie">
        <div className="home__conversation-head">
          <h2>Conversación</h2>
          <div className="home__conversation-tools">
            <button type="button" className="btn" onClick={resetConversation} disabled={!messages.length}>
              Limpiar
            </button>
            <button type="button" className="btn" onClick={exportConversation} disabled={!messages.length}>
              Exportar
            </button>
            <button type="button" className="btn home__conversation-close" onClick={() => toggleChat(false)} aria-label="Cerrar la conversación" title="Cerrar la conversación">
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
        <ChatPanel showCore={false} embedded />
      </aside>
    </section>
  );
}
