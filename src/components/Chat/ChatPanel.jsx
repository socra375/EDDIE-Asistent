import { useEffect, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useSettings } from '../../context/SettingsContext';
import { useVoice } from '../../context/VoiceContext';
import { MODES, DEFAULT_MODE } from '../../services/personality';
import { SKILLS, getSkill, buildSkillRequest } from '../../services/skills';
import { MAX_IMAGES, prepareImage } from '../../services/images';
import { useProbeConfig } from '../../services/probe';
import EddieCore from '../Core/EddieCore';
import Icon from '../../layout/Icon';
import RichText from '../Shared/RichText';
import MessageActions from './MessageActions';
import ConfirmCard from './ConfirmCard';
import StepTrace from './StepTrace';
import './Chat.css';

const PROVIDER_NAMES = { gemini: 'Gemini', claude: 'Claude', groq: 'Groq', openrouter: 'OpenRouter', probe: 'Sonda local' };

// The local probe on the user's computer, as one more skill in the chat (only
// when it is switched on in Conectores → Sonda local).
const PROBE_SKILL = { id: 'probe', label: 'Sonda', icon: 'monitor', placeholder: 'Pregúntale a tu equipo: ¿cuánto disco libre tengo?' };

// Quick starts on an empty chat: some ask right away, others open a skill.
const QUICK_STARTS = [
  { label: 'Planear mi día', icon: 'check', prompt: 'Ayúdame a planear mi día teniendo en cuenta mis tareas pendientes.' },
  { label: 'Clima de hoy', icon: 'home', prompt: '¿Qué tiempo hace hoy donde estoy?' },
  { label: 'Estudiar un tema', icon: 'book', skill: 'study' },
  { label: 'Revisar código', icon: 'code', skill: 'code' },
  { label: 'Redactar un correo', icon: 'doc', skill: 'documents', action: 'correo' },
];

export default function ChatPanel({ showCore = true }) {
  const { messages, status, sendMessage, resetConversation, activity, liveSteps, resolveConfirmation } = useChat();
  const { rememberFact } = useSettings();
  const { sttSupported, listening, transcribing, transcript, interimTranscript, start, stop, sttError, reset } = useVoice();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState(DEFAULT_MODE);
  const [skillId, setSkillId] = useState('general');
  const [actionId, setActionId] = useState('');
  const [option, setOption] = useState('');
  // Pictures waiting to be sent with the next message.
  const [attachments, setAttachments] = useState([]);
  const [attachError, setAttachError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);
  const canUseCamera = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const probeConfig = useProbeConfig();
  const skill = skillId === 'probe' && probeConfig.enabled ? PROBE_SKILL : getSkill(skillId === 'probe' ? 'general' : skillId);
  const skills = probeConfig.enabled ? [...SKILLS, PROBE_SKILL] : SKILLS;
  const busy = status === 'processing';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, status]);

  // Only a listen started from this panel's mic fills its input (the ring
  // on Inicio sends its own). With Whisper the text arrives once, right as
  // `listening` drops, so the last transcript is copied after it ends too.
  const ownsMicRef = useRef(false);
  const wasListeningRef = useRef(false);
  useEffect(() => {
    const ended = wasListeningRef.current && !listening;
    wasListeningRef.current = listening;
    if (!ownsMicRef.current) return;
    const text = `${transcript}${interimTranscript}`;
    if (listening || (ended && text)) setInput(text);
    if (ended) ownsMicRef.current = false;
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
    if (id === 'probe') {
      setSkillId('probe');
      setActionId('');
      setOption('');
      inputRef.current?.focus();
      return;
    }
    const next = getSkill(id);
    setSkillId(next.id);
    setActionId(action || next.actions?.[0].id || '');
    setOption(next.option?.initial || '');
    inputRef.current?.focus();
  }

  // Shrinks and adds pictures (picked, pasted or dropped), up to MAX_IMAGES.
  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => String(f.type).startsWith('image/'));
    if (!files.length) {
      if ((fileList || []).length) setAttachError('Eso no es una imagen.');
      return;
    }
    setAttachError('');
    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) {
      setAttachError(`Máximo ${MAX_IMAGES} imágenes por mensaje.`);
      return;
    }
    setPreparing(true);
    const added = [];
    for (const file of files.slice(0, room)) {
      try {
        added.push(await prepareImage(file));
      } catch (err) {
        setAttachError(err.message);
      }
    }
    if (files.length > room) setAttachError(`Máximo ${MAX_IMAGES} imágenes por mensaje: agregué las primeras.`);
    setAttachments((prev) => [...prev, ...added].slice(0, MAX_IMAGES));
    setPreparing(false);
  }

  function handlePaste(e) {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer?.files);
  }

  async function submit() {
    const text = input.trim();
    if ((!text && !attachments.length) || busy || preparing) return;
    if (skill.id === 'probe' && (attachments.length || !text)) {
      setAttachError('La sonda local no ve imágenes: escríbele tu pregunta, o cambia a General para enviar la imagen.');
      return;
    }
    if (listening) stop();
    const images = attachments;
    setInput('');
    setAttachments([]);
    setAttachError('');
    reset();

    if (skill.id === 'probe') {
      sendMessage(text, { probe: true });
      return;
    }
    if (skill.id === 'general' || !text) {
      sendMessage(text, { mode, images });
      return;
    }
    const request = buildSkillRequest(skill.id, actionId, text, option);
    const reply = await sendMessage(request.prompt, {
      mode: request.mode,
      display: text,
      tag: request.tag,
      skill: skill.id,
      title: request.title,
      images,
    });
    if (reply && skill.id === 'study') {
      rememberFact({ category: 'profile', key: 'nivel académico', text: option });
      rememberFact({ category: 'context', text: `Estudió: ${text.slice(0, 80)}`, days: 14 });
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
    if (transcribing) return;
    if (listening) {
      stop();
      return;
    }
    ownsMicRef.current = true;
    start();
  }

  return (
    <section className="chat-panel">
      {showCore && (
        <div className="chat-panel__core">
          <EddieCore state={listening ? 'listening' : status} compact />
        </div>
      )}

      <div
        className={`chat-panel__body glass-panel ${dragging ? 'chat-panel__body--drop' : ''}`}
        onDragOver={(e) => {
          if ([...(e.dataTransfer?.types || [])].includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={handleDrop}
      >
        <div className="chat-panel__toolbar">
          <div className="skills" role="group" aria-label="Habilidades">
            {skills.map((s) => (
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
          {skill.id === 'probe' ? (
            <p className="chat-panel__hint">Tus preguntas van a la Sonda local de este equipo ({probeConfig.url}), no a la nube.</p>
          ) : skill.actions ? (
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
                {m.provider === 'probe' && <span className="bubble__tag">Sonda local</span>}
                {m.fallbackFrom && (
                  <span className="bubble__tag bubble__tag--fallback" title={`${m.fallbackFrom} falló; respondió el respaldo`}>
                    vía {PROVIDER_NAMES[m.provider] || 'respaldo'}
                  </span>
                )}
              </span>
              {m.role === 'assistant' && <StepTrace steps={m.steps} />}
              {m.images?.length > 0 && (
                <div className="bubble__images" aria-label="Imágenes adjuntas">
                  {m.images.map((img, i) => (
                    <img key={i} src={img.thumb} alt={img.name || 'Imagen adjunta'} />
                  ))}
                </div>
              )}
              <div className="bubble__text">
                <RichText text={m.display || m.content} />
              </div>
              {m.confirmations?.map((card) => (
                <ConfirmCard key={card.id} card={card} onResolve={(decision, args) => resolveConfirmation(m.id, card.id, decision, args)} />
              ))}
              {m.taskChanges?.length > 0 && (
                <ul className="bubble__changes" aria-label="Cambios en tus tareas">
                  {m.taskChanges.map((change) => (
                    <li key={change}>
                      <Icon name="check" size={13} /> {change}
                    </li>
                  ))}
                </ul>
              )}
              {m.links?.length > 0 && (
                <ul className="bubble__changes bubble__links" aria-label="Enlaces que abrió Eddie">
                  {m.links.map((link) => (
                    <li key={link.url}>
                      <Icon name="play" size={13} />{' '}
                      <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.played ? 'Se reproduce en el reproductor de Eddie; pulsa para abrirlo en YouTube' : link.opened ? 'Se abrió en una pestaña nueva' : 'Tu navegador bloqueó la ventana: pulsa para abrirla'}>
                        {link.played ? 'Reproduciendo' : link.opened ? 'Abierto' : 'Abrir'} {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              {m.memoryChanges?.length > 0 && (
                <ul className="bubble__changes" aria-label="Cambios en tu memoria">
                  {m.memoryChanges.map((change) => (
                    <li key={change}>
                      <Icon name="memory" size={13} /> {change}
                    </li>
                  ))}
                </ul>
              )}
              {m.role === 'assistant' && !m.isError && m.content && m.provider && <MessageActions message={m} />}
            </div>
          ))}

          {status === 'processing' && (
            <div className="bubble bubble--assistant bubble--pending">
              <span className="bubble__author">Eddie</span>
              <StepTrace steps={liveSteps} live />
              <p className="bubble__text">{activity || 'Analizando tu solicitud…'}</p>
            </div>
          )}
        </div>

        {transcribing ? (
          <p className="chat-panel__hint">Transcribiendo tu voz…</p>
        ) : (
          sttError && <p className="chat-panel__hint chat-panel__hint--error">{sttError}</p>
        )}

        {(attachments.length > 0 || preparing || attachError) && (
          <div className="chat-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="chat-attachment">
                <img src={a.thumb} alt={a.name} />
                <button type="button" className="chat-attachment__remove" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            {preparing && <span className="chat-panel__hint">Preparando imagen…</span>}
            {attachError && <span className="chat-panel__hint chat-panel__hint--error" role="alert">{attachError}</span>}
          </div>
        )}

        <form className="chat-panel__input" onSubmit={handleSubmit}>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          {canUseCamera && <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />}
          <button
            type="button"
            className="btn mic-btn"
            onClick={() => fileRef.current?.click()}
            disabled={busy || attachments.length >= MAX_IMAGES || skill.id === 'probe'}
            title="Adjuntar una imagen (también puedes pegarla o arrastrarla)"
            aria-label="Adjuntar imagen"
          >
            <Icon name="image" size={18} />
          </button>
          {canUseCamera && (
            <button type="button" className="btn mic-btn" onClick={() => cameraRef.current?.click()} disabled={busy || attachments.length >= MAX_IMAGES} title="Tomar una foto" aria-label="Tomar una foto">
              <Icon name="camera" size={18} />
            </button>
          )}
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
            onPaste={handlePaste}
            placeholder={attachments.length ? 'Pregunta algo sobre la imagen (o envíala sola)…' : skill.placeholder}
            aria-label="Mensaje para Eddie"
          />
          <button type="submit" className="btn btn-primary chat-send" disabled={(!input.trim() && !attachments.length) || busy || preparing} aria-label="Enviar">
            <Icon name="send" size={16} />
            <span className="chat-send__label">Enviar</span>
          </button>
        </form>
      </div>
    </section>
  );
}
