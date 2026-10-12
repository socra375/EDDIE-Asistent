import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChat } from '../context/ChatContext';
import { useNotes } from '../context/notesState';
import { useSettings } from '../context/SettingsContext';
import { useVoice } from '../context/VoiceContext';
import Icon from '../layout/Icon';
import { callBridge } from '../services/callState';
import { clientPrompt, parseCallCommand } from '../services/callCommands';
import './Call.css';

const MAX_LINES = 40;
const RESTART_MS = 450;
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// Llamar a Eddie: a phone-call screen. Eddie listens all the time (live text on
// screen), answers out loud and listens again; «Colgar» ends it. Besides talking
// to him you can say «toma nota de…» (it goes to Notas), «responde esta llamada del
// cliente con los datos» (he answers whoever is talking with what he has in
// Contactos, Negocios and his memory, without inventing) and «ya está» to take
// over again. Nothing here identifies who is speaking: the microphone's own
// echo and noise cancelling is all that filters the sound around.
// `incoming` shows «Eddie te llama» with Contestar / Rechazar (Eddie calling the user).
export default function CallScreen({ incoming = false, onClose }) {
  const { status, sendMessage, lastReply } = useChat();
  const { settings } = useSettings();
  const { createNote, updateNote } = useNotes();
  const { sttSupported, sttEngine, listening, transcribing, transcript, interimTranscript, start, stop, reset, speaking, stopSpeaking, sttError, speakWithSettings } = useVoice();
  const [phase, setPhase] = useState(incoming ? 'ringing' : 'ready'); // ringing | ready | live
  const [muted, setMuted] = useState(false);
  const [clientMode, setClientMode] = useState(false);
  const [lines, setLines] = useState([]);
  const [seconds, setSeconds] = useState(0);
  const [blocked, setBlocked] = useState('');
  const live = phase === 'live';
  const emptyListens = useRef(0);
  const wasListening = useRef(false);
  const lastReplyId = useRef(lastReply?.id);
  const logRef = useRef(null);
  const word = settings.wake?.word;
  const silenceMs = Math.round((Number(settings.voice?.silence) || 1.5) * 1000);
  const heard = `${transcript} ${interimTranscript}`.trim();

  const log = useCallback((who, text) => setLines((prev) => [...prev, { id: `${Date.now()}${Math.random()}`, who, text }].slice(-MAX_LINES)), []);

  const hangUp = useCallback(() => {
    stop();
    reset();
    stopSpeaking();
    callBridge.set(false);
    onClose?.();
  }, [stop, reset, stopSpeaking, onClose]);

  const answer = () => {
    callBridge.set(true);
    setBlocked('');
    setPhase('live');
  };

  // The clock of the call.
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  // Leaving the screen any other way still frees the microphone and the voice.
  useEffect(() => () => callBridge.set(false), []);

  // What Eddie says goes on the log.
  useEffect(() => {
    if (!live || !lastReply || lastReply.id === lastReplyId.current) return;
    lastReplyId.current = lastReply.id;
    if (!lastReply.isError) queueMicrotask(() => log('eddie', lastReply.content));
  }, [live, lastReply, log]);

  const handleUtterance = useCallback(
    (text) => {
      const command = parseCallCommand(text, word);
      if (command?.action === 'hangup') {
        speakWithSettings('Hasta luego.', hangUp);
        log('tú', text);
        return;
      }
      if (command?.action === 'note') {
        const note = createNote();
        updateNote(note.id, { title: command.text.slice(0, 60), body: command.text });
        log('nota', command.text);
        speakWithSettings('Anotado.');
        return;
      }
      if (command?.action === 'answer') {
        setClientMode(true);
        log('tú', text);
        speakWithSettings('Vale, atiendo yo. Dime cuando termines con «ya está».');
        return;
      }
      if (command?.action === 'back' && clientMode) {
        setClientMode(false);
        log('tú', text);
        speakWithSettings('Listo, sigues tú.');
        return;
      }
      if (clientMode) {
        log('cliente', text);
        sendMessage(clientPrompt(text), { display: text, silent: false });
        return;
      }
      log('tú', text);
      sendMessage(text);
    },
    [word, clientMode, createNote, updateNote, sendMessage, speakWithSettings, hangUp, log],
  );

  // The end of a listen: what was heard is the next thing said.
  useEffect(() => {
    if (wasListening.current && !listening && live) {
      if (heard) {
        emptyListens.current = 0;
        handleUtterance(heard);
      } else emptyListens.current += 1;
      queueMicrotask(reset);
    }
    wasListening.current = listening;
  }, [listening, heard, live, handleUtterance, reset]);

  // With the browser's own recognizer a listen never ends by itself: a pause after speaking ends it.
  useEffect(() => {
    if (!live || sttEngine !== 'browser' || !listening || !heard) return undefined;
    const timer = window.setTimeout(stop, silenceMs);
    return () => window.clearTimeout(timer);
  }, [live, sttEngine, listening, heard, silenceMs, stop]);

  // Listen whenever nobody is talking: not while Eddie works or speaks, not while muted.
  const idle = live && !muted && !listening && !transcribing && !speaking && status === 'idle';
  useEffect(() => {
    if (!idle || sttError) return undefined;
    const timer = window.setTimeout(() => start(), RESTART_MS * Math.min(5, 1 + emptyListens.current));
    return () => window.clearTimeout(timer);
  }, [idle, sttError, start]);

  useEffect(() => {
    if (sttError && live) window.setTimeout(() => setBlocked(sttError), 0);
  }, [sttError, live]);

  useEffect(() => {
    logRef.current?.scrollTo?.({ top: logRef.current.scrollHeight });
  }, [lines, heard]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && hangUp();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hangUp]);

  let state = 'En espera';
  if (muted) state = 'Micrófono silenciado';
  else if (speaking) state = 'Eddie habla';
  else if (status === 'processing' || status === 'responding') state = 'Eddie piensa…';
  else if (transcribing) state = 'Transcribiendo…';
  else if (listening) state = clientMode ? 'Escuchando al cliente' : 'Te escucho';

  // On the body, outside the app shell (whose children are all made `position: relative`).
  return createPortal(
    <div className="call" role="dialog" aria-modal="true" aria-label="Llamada con Eddie">
      <div className="call__top">
        <div className={`call__avatar ${speaking ? 'call__avatar--speaking' : ''} ${phase === 'ringing' ? 'call__avatar--ring' : ''}`} aria-hidden="true">E</div>
        <h2>Eddie</h2>
        <p className="call__state" role="status">
          {phase === 'ringing' ? 'Eddie te llama…' : phase === 'ready' ? 'Listo para llamar' : `${fmtTime(seconds)} · ${state}`}
        </p>
        {clientMode && live && <p className="call__badge">Atendiendo al cliente con tus datos · di «ya está» para volver</p>}
      </div>

      {live && (
        <div className="call__log" ref={logRef} aria-live="polite">
          {lines.map((l) => (
            <p key={l.id} className={`call__line call__line--${l.who}`}>
              <span>{l.who === 'tú' ? 'Tú' : l.who === 'eddie' ? 'Eddie' : l.who === 'cliente' ? 'Cliente' : 'Nota guardada'}</span> {l.text}
            </p>
          ))}
          {heard && listening && <p className="call__line call__line--live">{heard}</p>}
          {lines.length === 0 && !heard && <p className="call__hint">Habla con normalidad. Prueba: «toma nota de…» o «responde esta llamada del cliente con los datos».</p>}
        </div>
      )}

      {!sttSupported && <p className="call__error">Este navegador no puede escucharte. Usa Chrome o Edge (o Safari reciente) para llamar a Eddie.</p>}
      {blocked && live && (
        <p className="call__error">
          {blocked}{' '}
          <button type="button" className="call__link" onClick={() => { setBlocked(''); reset(); start(); }}>Reintentar</button>
        </p>
      )}

      <div className="call__controls">
        {phase === 'live' ? (
          <>
            <button type="button" className={`call__btn ${muted ? 'call__btn--on' : ''}`} onClick={() => { setMuted((m) => !m); if (!muted) { stop(); reset(); } }} aria-pressed={muted}>
              <Icon name="mic" size={22} />
              <span>{muted ? 'Activar mic' : 'Silenciar'}</span>
            </button>
            <button type="button" className="call__btn call__btn--hang" onClick={hangUp}>
              <Icon name="phone" size={26} />
              <span>Colgar</span>
            </button>
            <button type="button" className="call__btn" onClick={stopSpeaking} disabled={!speaking}>
              <Icon name="close" size={22} />
              <span>Callar a Eddie</span>
            </button>
          </>
        ) : (
          <>
            <button type="button" className="call__btn call__btn--hang" onClick={hangUp}>
              <Icon name="phone" size={26} />
              <span>{phase === 'ringing' ? 'Rechazar' : 'Cancelar'}</span>
            </button>
            <button type="button" className="call__btn call__btn--answer" onClick={answer} disabled={!sttSupported}>
              <Icon name="phone" size={26} />
              <span>{phase === 'ringing' ? 'Contestar' : 'Llamar a Eddie'}</span>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
