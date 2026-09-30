import { useEffect, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useSettings } from '../../context/SettingsContext';
import { useVoice } from '../../context/VoiceContext';
import { MODES, DEFAULT_MODE } from '../../services/personality';
import { SKILLS, getSkill, buildSkillRequest } from '../../services/skills';
import EddieCore from '../Core/EddieCore';
import Icon from '../../layout/Icon';
import RichText from '../Shared/RichText';
import MessageActions from './MessageActions';
import './Chat.css';

// Quick starts on an empty chat: some ask right away, others open a skill.
const QUICK_STARTS = [
  { label: 'Planear mi día', icon: 'check', prompt: 'Ayúdame a planear mi día teniendo en cuenta mis tareas pendientes.' },
  { label: 'Clima de hoy', icon: 'home', prompt: '¿Qué tiempo hace hoy donde estoy?' },
  { label: 'Estudiar un tema', icon: 'book', skill: 'study' },
  { label: 'Revisar código', icon: 'code', skill: 'code' },
  { label: 'Redactar un correo', icon: 'doc', skill: 'documents', action: 'correo' },
];

export default function ChatPanel({ showCore = true }) {
  const { messages, status, sendMessage, resetConversation } = useChat();
  const { rememberFact } = useSettings();
  const { sttSupported, listening, transcript, interimTranscript, start, stop, sttError, reset } = useVoice();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [skillId, setSkillId] = useState('general');
  const [actionId, setActionId] = useState('');
  const [option, setOption] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const skill = getSkill(skillId);
  const busy = status === 'processing';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => {
    if (listening) setInput(`${transcript}${interimTranscript}`);
  }, [transcript, interimTranscript, listening]);

  // The input grows with its content (wrapped lines included) up to the
  // CSS max-height, then scrolls.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [input]);

  function selectSkill(id, action) {
    const next = getSkill(id);
    setSkillId(next.id);
    setActionId(action || next.actions?.[0].id || '');
    setOption(next.option?.initial || '');
    inputRef.current?.focus();
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    if (listening) stop();
    setInput('');
    reset();

    if (skill.id === 'general') {
      sendMessage(text, { mode });
      return;
    }
    const request = buildSkillRequest(skill.id, actionId, text, option);
    const reply = await sendMessage(request.prompt, {
      mode: request.mode,
      display: text,
      tag: request.tag,
      skill: skill.id,
      title: request.title,
    });
    if (reply && skill.id === 'study') {
      rememberFact('nivel_academico', option);
      rememberFact('ultimo_tema_estudiado', text.slice(0, 80));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    submit();
  }

  // Enter sends; Shift+Enter adds a line (needed for pasting code).
  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  function toggleMic() {
    if (listening) stop();
    else start();
  }

  return (
    <section className="chat-panel">
      {showCore && (
        <div className="chat-panel__core">
          <EddieCore state={listening ? 'listening' : status} compact />
        </div>
      )}

      <div className="chat-panel__body glass-panel">
        <div className="chat-panel__toolbar">
          <div className="skills" role="group" aria-label="Habilidades">
            {SKILLS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`skill ${s.id === skill.id ? 'skill--active' : ''}`}
                aria-pressed={s.id === skill.id}
                onClick={() => selectSkill(s.id)}
              >
                <Icon name={s.icon} size={14} />
                {s.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn chat-new"
            onClick={resetConversation}
            disabled={!messages.length}
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <Icon name="plus" size={14} />
            <span className="chat-new__label">Nueva</span>
          </button>
        </div>

        <div className="chat-panel__options">
          {skill.actions ? (
            <label className="chat-option">
              <span className="field-label">Qué necesitas</span>
              <select className="select" value={actionId} onChange={(e) => setActionId(e.target.value)}>
                {skill.actions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="chat-option">
              <span className="field-label">Estilo</span>
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
                {Object.entries(MODES).map(([key, m]) => (
                  <option key={key} value={key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {skill.option && (
            <label className="chat-option">
              <span className="field-label">{skill.option.label}</span>
              <select className="select" value={option} onChange={(e) => setOption(e.target.value)}>
                {skill.option.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="chat-panel__messages" ref={listRef}>
          {messages.length === 0 && (
            <div className="chat-empty">
              <p className="chat-empty__greeting">Hola. ¿En qué te ayudo?</p>
              <div className="chat-empty__quick">
                {QUICK_STARTS.map((q) => (
                  <button
                    key={q.label}
                    type="button"
                    className="btn quick-chip"
                    onClick={() => (q.skill ? selectSkill(q.skill, q.action) : sendMessage(q.prompt, { mode }))}
                  >
                    <Icon name={q.icon} size={14} /> {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={`bubble bubble--${m.role} ${m.isError ? 'bubble--error' : ''}`}>
              <span className="bubble__author">
                {m.role === 'user' ? 'Tú' : 'Eddie'}
                {m.tag && <span className="bubble__tag">{m.tag}</span>}
                {m.fallbackFrom && (
                  <span className="bubble__tag bubble__tag--fallback" title={`${m.fallbackFrom} falló; respondió el respaldo`}>
                    vía Groq
                  </span>
                )}
              </span>
              <div className="bubble__text">
                <RichText text={m.display || m.content} />
              </div>
              {m.role === 'assistant' && !m.isError && m.content && m.provider && <MessageActions message={m} />}
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
            aria-label="Usar micrófono"
          >
            <Icon name="mic" size={18} />
          </button>
          <textarea
            ref={inputRef}
            className="input chat-panel__textarea"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={skill.placeholder}
            aria-label="Mensaje para Eddie"
          />
          <button type="submit" className="btn btn-primary chat-send" disabled={!input.trim() || busy} aria-label="Enviar">
            <Icon name="send" size={16} />
            <span className="chat-send__label">Enviar</span>
          </button>
        </form>
      </div>
    </section>
  );
}
