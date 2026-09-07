import { useEffect, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useVoice } from '../../context/VoiceContext';
import { MODES } from '../../services/personality';
import EddieCore from '../Core/EddieCore';
import RichText from '../Shared/RichText';
import './Chat.css';

const QUICK_PROMPTS = [
  { icon: '📚', label: 'Estudiar', prompt: 'Ayúdame a estudiar un tema. Pregúntame cuál antes de continuar.' },
  { icon: '💻', label: 'Programar', prompt: 'Necesito ayuda con un problema de programación. Pregúntame el lenguaje y el error.' },
  { icon: '📝', label: 'Crear documento', prompt: 'Ayúdame a crear un documento de estudio. Pregúntame el tema y el formato.' },
  { icon: '📅', label: 'Organizar tareas', prompt: 'Ayúdame a organizar mis tareas y prioridades para esta semana.' },
];

export default function ChatPanel() {
  const { messages, status, sendMessage, resetConversation } = useChat();
  const { supported: sttSupported, listening, transcript, interimTranscript, start, stop, error: sttError, reset } = useVoice();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('explicativo');
  const listRef = useRef(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => {
    if (listening) setInput(`${transcript}${interimTranscript}`);
  }, [transcript, interimTranscript, listening]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim() || status === 'processing') return;
    if (listening) stop();
    sendMessage(input, { mode });
    setInput('');
    reset();
  }

  function toggleMic() {
    if (listening) stop();
    else start();
  }

  return (
    <section className="chat-panel">
      <div className="chat-panel__core">
        <EddieCore state={listening ? 'listening' : status} compact />
      </div>

      <div className="chat-panel__body glass-panel">
        <div className="chat-panel__toolbar">
          <label className="chat-mode">
            <span className="field-label">Modo</span>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              {Object.entries(MODES).map(([key, m]) => (
                <option key={key} value={key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn" onClick={resetConversation} disabled={!messages.length}>
            🗑️ Nueva conversación
          </button>
        </div>

        <div className="chat-panel__messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty__greeting">Hola. ¿Qué vamos a resolver hoy?</p>
              <div className="chat-empty__quick">
                {QUICK_PROMPTS.map((q) => (
                  <button key={q.label} type="button" className="btn quick-chip" onClick={() => sendMessage(q.prompt, { mode })}>
                    <span aria-hidden="true">{q.icon}</span> {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`bubble bubble--${m.role} ${m.isError ? 'bubble--error' : ''}`}>
              <span className="bubble__author">{m.role === 'user' ? 'Tú' : 'Eddie'}</span>
              <div className="bubble__text">
                <RichText text={m.content} />
              </div>
            </div>
          ))}

          {status === 'processing' && (
            <div className="bubble bubble--assistant bubble--pending">
              <span className="bubble__author">Eddie</span>
              <p className="bubble__text">Analizando tu solicitud…</p>
            </div>
          )}
        </div>

        {sttError && <p className="chat-panel__hint chat-panel__hint--error">{sttError}</p>}

        <form className="chat-panel__input" onSubmit={handleSubmit}>
          <button
            type="button"
            className={`btn mic-btn ${listening ? 'mic-btn--active' : ''}`}
            onClick={toggleMic}
            disabled={!sttSupported}
            title={sttSupported ? 'Usar micrófono' : 'Micrófono no compatible con este navegador'}
          >
            🎙️
          </button>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pregúntale algo a Eddie…"
          />
          <button type="submit" className="btn btn-primary" disabled={!input.trim() || status === 'processing'}>
            Enviar
          </button>
        </form>
      </div>
    </section>
  );
}
